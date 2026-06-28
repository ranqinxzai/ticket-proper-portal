from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django_tenants.utils import schema_context
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Client
from .permissions import IsPlatformAdmin
from .serializers import (
    AdminPasswordResetSerializer,
    OrgCreateSerializer,
    OrgSerializer,
    OrgUserCreateSerializer,
    OrgUserUpdateSerializer,
    PlatformTokenObtainPairSerializer,
)
from .services import deprovision_org, provision_org, rename_org


def _user_payload(u) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "full_name": u.full_name,
        "email": u.email,
        "is_superuser": u.is_superuser,
        "is_active": u.is_active,
    }


class PlatformLoginView(TokenObtainPairView):
    """POST {username, password} → {access, refresh, user} for platform admins."""

    serializer_class = PlatformTokenObtainPairSerializer
    permission_classes = [AllowAny]


class OrgViewSet(viewsets.ModelViewSet):
    """Platform-admin CRUD over organisations (the provisioning console API)."""

    queryset = Client.objects.all().order_by("name")
    serializer_class = OrgSerializer
    permission_classes = [IsPlatformAdmin]
    lookup_field = "schema_name"
    lookup_value_regex = "[a-z][a-z0-9_-]+"
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def partial_update(self, request, *args, **kwargs):
        """Edit an org: name, is_active, and (optionally) its slug.

        A `slug` different from the current one renames the org's Postgres schema
        (and its URL). name/is_active are applied normally.
        """
        instance = self.get_object()
        new_slug = (request.data.get("slug") or "").strip()
        if new_slug and new_slug != instance.schema_name:
            try:
                instance = rename_org(instance.schema_name, new_slug)
            except DjangoValidationError as exc:
                return Response({"slug": exc.messages}, status=status.HTTP_400_BAD_REQUEST)
        data = {k: request.data[k] for k in ("name", "is_active") if k in request.data}
        ser = self.get_serializer(instance, data=data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(self.get_serializer(instance).data)

    def create(self, request, *args, **kwargs):
        ser = OrgCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        v = ser.validated_data
        try:
            client = provision_org(
                name=v["name"],
                slug=v["slug"],
                admin_username=v["admin_username"],
                admin_password=v["admin_password"],
                admin_email=v.get("admin_email", ""),
                admin_full_name=v.get("admin_full_name", ""),
            )
        except DjangoValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(OrgSerializer(client).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        # Drops the schema and ALL its data — platform-admin-only, irreversible.
        deprovision_org(instance.schema_name, drop_schema=True)

    @action(detail=True, methods=["get", "post"], url_path="users")
    def users(self, request, schema_name=None):
        """GET: list users in an org's schema. POST: create a user there."""
        org = self.get_object()
        with schema_context(org.schema_name):
            User = get_user_model()
            if request.method == "POST":
                ser = OrgUserCreateSerializer(data=request.data)
                ser.is_valid(raise_exception=True)
                v = ser.validated_data
                if User.objects.filter(username=v["username"]).exists():
                    return Response(
                        {"username": ["A user with that username already exists."]},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                factory = User.objects.create_superuser if v["is_admin"] else User.objects.create_user
                user = factory(
                    username=v["username"], email=v.get("email", ""), password=v["password"]
                )
                user.full_name = v.get("full_name", "") or v["username"]
                user.save()
                return Response(_user_payload(user), status=status.HTTP_201_CREATED)

            rows = [
                _user_payload(u)
                for u in User.objects.order_by("-is_superuser", "username")
            ]
        return Response(rows)

    @action(detail=True, methods=["patch", "delete"], url_path=r"users/(?P<username>[\w.@+-]+)")
    def user_detail(self, request, schema_name=None, username=None):
        """Edit (PATCH) or delete (DELETE) one user inside an org's schema."""
        org = self.get_object()
        system_user = getattr(settings, "EMAIL_SYSTEM_ACTOR_USERNAME", "email-bot")
        with schema_context(org.schema_name):
            User = get_user_model()
            try:
                user = User.objects.get(username=username)
            except User.DoesNotExist:
                return Response({"detail": "No such user."}, status=status.HTTP_404_NOT_FOUND)

            if request.method == "DELETE":
                if user.username == system_user:
                    return Response(
                        {"detail": "The email system account cannot be deleted."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if user.is_superuser and User.objects.filter(is_superuser=True).count() <= 1:
                    return Response(
                        {"detail": "Cannot delete the organisation's only administrator."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                user.delete()
                return Response(status=status.HTTP_204_NO_CONTENT)

            ser = OrgUserUpdateSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            v = ser.validated_data
            if "email" in v:
                user.email = v["email"] or ""
            if "full_name" in v:
                user.full_name = v["full_name"] or user.username
            if "is_active" in v:
                user.is_active = v["is_active"]
            if "is_admin" in v:
                # Don't allow demoting the last admin.
                if (
                    not v["is_admin"]
                    and user.is_superuser
                    and User.objects.filter(is_superuser=True).count() <= 1
                ):
                    return Response(
                        {"detail": "Cannot remove admin from the organisation's only administrator."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                user.is_superuser = v["is_admin"]
                user.is_staff = v["is_admin"]
            if v.get("password"):
                user.set_password(v["password"])
            user.save()
            return Response(_user_payload(user))

    @action(detail=True, methods=["post"], url_path="reset-admin-password")
    def reset_admin_password(self, request, schema_name=None):
        """Reset a user's password inside the org's own schema."""
        org = self.get_object()
        ser = AdminPasswordResetSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with schema_context(org.schema_name):
            User = get_user_model()
            try:
                user = User.objects.get(username=ser.validated_data["username"])
            except User.DoesNotExist:
                return Response(
                    {"detail": "No such user in this organisation."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            user.set_password(ser.validated_data["new_password"])
            user.save(update_fields=["password"])
        return Response({"detail": "Password reset."}, status=status.HTTP_200_OK)
