from __future__ import annotations

import logging
import secrets
import string

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import connection, transaction
from django.shortcuts import redirect
from django.utils.crypto import constant_time_compare
from django_tenants.utils import get_public_schema_name
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from . import sso
from .models import Module, RoleAssignment, RoleModulePermission, SystemRole, TenantSSOConfig
from .permissions import HasModulePermission, ItsmModelViewSet
from .serializers import (
    ItsmTokenObtainPairSerializer,
    ItsmUserSerializer,
    MemberSerializer,
    ModuleSerializer,
    RoleAssignmentSerializer,
    RoleModulePermissionSerializer,
    SystemRoleSerializer,
    TenantSSOConfigSerializer,
)
from .services import invalidate_permission_cache

logger = logging.getLogger("itsm")


def _generate_temp_password(length: int = 14) -> str:
    """A reasonably strong temporary password the admin shares once."""
    alphabet = string.ascii_letters + string.digits
    return "Oh-" + "".join(secrets.choice(alphabet) for _ in range(length))


class ItsmLoginView(TokenObtainPairView):
    """POST {username, password} → {access, refresh, user}."""

    serializer_class = ItsmTokenObtainPairSerializer


class MeView(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        return Response(ItsmUserSerializer(request.user).data)


class ModuleViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only catalogue of permission modules (drives the admin role editor)."""

    queryset = Module.objects.filter(is_active=True)
    serializer_class = ModuleSerializer
    permission_classes = [HasModulePermission]
    module_code = "itsm.admin.roles"
    pagination_class = None


class SystemRoleViewSet(ItsmModelViewSet):
    queryset = SystemRole.objects.filter(is_deleted=False).prefetch_related("permissions__module")
    serializer_class = SystemRoleSerializer
    module_code = "itsm.admin.roles"
    search_fields = ["name", "code"]

    def perform_create(self, serializer):
        serializer.save()
        invalidate_permission_cache()

    def perform_update(self, serializer):
        serializer.save()
        invalidate_permission_cache()

    @action(detail=True, methods=["put"])
    def permissions(self, request, pk=None):
        """Bulk-set a role's module grants. Body: [{module, can_read, ...}]."""
        role = self.get_object()
        for row in request.data:
            RoleModulePermission.objects.update_or_create(
                role=role,
                module_id=row["module"],
                defaults={
                    "can_read": row.get("can_read", False),
                    "can_create": row.get("can_create", False),
                    "can_update": row.get("can_update", False),
                    "can_delete": row.get("can_delete", False),
                },
            )
        invalidate_permission_cache()
        return Response(SystemRoleSerializer(role).data)


class RoleModulePermissionViewSet(ItsmModelViewSet):
    queryset = RoleModulePermission.objects.filter(is_deleted=False).select_related("module", "role")
    serializer_class = RoleModulePermissionSerializer
    module_code = "itsm.admin.roles"
    filterset_fields = ["role", "module"]

    def perform_update(self, serializer):
        serializer.save()
        invalidate_permission_cache()


class RoleAssignmentViewSet(ItsmModelViewSet):
    queryset = RoleAssignment.objects.filter(is_deleted=False).select_related("role", "user")
    serializer_class = RoleAssignmentSerializer
    module_code = "itsm.admin.roles"
    filterset_fields = ["role", "user"]

    def perform_create(self, serializer):
        serializer.save()
        invalidate_permission_cache()

    def perform_update(self, serializer):
        serializer.save()
        invalidate_permission_cache()


class MemberViewSet(viewsets.ReadOnlyModelViewSet):
    """Org roster: every user with their ITSM role + helpdesk membership.

    Read-only list/retrieve gated by ``itsm.admin.roles`` (Supervisors and
    superusers), plus a ``create_user`` collection action that provisions a new
    user with a generated temporary password and, optionally, an ITSM role and
    helpdesk memberships in one shot.
    """

    serializer_class = MemberSerializer
    permission_classes = [HasModulePermission]
    module_code = "itsm.admin.roles"
    search_fields = ["username", "full_name", "email"]
    filterset_fields = ["is_active"]

    def get_queryset(self):
        return (
            get_user_model()
            .objects.select_related("itsm_role_assignment__role")
            .prefetch_related(
                "itsm_helpdesk_memberships__helpdesk",
                "itsm_project_memberships__project__helpdesk",
            )
            .order_by("username")
        )

    @action(detail=False, methods=["post"])
    def create_user(self, request):
        """Provision a user (temp password) + optional ITSM role & helpdesks.

        Body: {username, email?, full_name?, is_active?, role_code?,
        helpdesks?: [{id, role_in_helpdesk?}], projects?: [{id}]}. Returns the
        member row plus a one-time ``temp_password`` for the admin to share.
        """
        from apps.accounts.serializers import UserSerializer
        from apps.itsm_helpdesks.models import Helpdesk, HelpdeskMembership

        data = request.data

        # Validate the ITSM role up front (consistent with set_role; no orphan
        # user gets created if the code is bad).
        role = None
        role_code = (data.get("role_code") or "").strip()
        if role_code:
            role = SystemRole.objects.filter(
                code=role_code, is_active=True, is_deleted=False
            ).first()
            if role is None:
                return Response({"detail": "Unknown role."}, status=400)

        # Validate helpdesk memberships up front (reject non-list / bad ids
        # rather than letting the ORM raise a 500 mid-transaction).
        raw_helpdesks = data.get("helpdesks") or []
        if not isinstance(raw_helpdesks, list):
            return Response({"helpdesks": "Expected a list."}, status=400)
        requested = []  # [(helpdesk_id, role_in_helpdesk)]
        for hd in raw_helpdesks:
            hd_id = hd.get("id") if isinstance(hd, dict) else hd
            if not hd_id:
                continue
            role_in = (hd.get("role_in_helpdesk") if isinstance(hd, dict) else None) or "member"
            requested.append((hd_id, role_in))
        if requested:
            try:
                valid_ids = {
                    str(v)
                    for v in Helpdesk.objects.filter(
                        id__in=[hid for hid, _ in requested], is_deleted=False
                    ).values_list("id", flat=True)
                }
            except (DjangoValidationError, ValueError, TypeError):
                return Response({"helpdesks": "Invalid helpdesk id(s)."}, status=400)
            if any(str(hid) not in valid_ids for hid, _ in requested):
                return Response({"helpdesks": "Unknown helpdesk id(s)."}, status=400)

        # Validate per-user project assignments (optional). Each must be an active
        # project whose helpdesk is among the requested helpdesks — otherwise it's
        # dead data under the strict-whitelist clamp.
        raw_projects = data.get("projects") or []
        if not isinstance(raw_projects, list):
            return Response({"projects": "Expected a list."}, status=400)
        requested_projects = []  # [project_id]
        for pr in raw_projects:
            pid = pr.get("id") if isinstance(pr, dict) else pr
            if pid:
                requested_projects.append(pid)
        if requested_projects:
            from apps.itsm_projects.models import Project
            try:
                rows = list(
                    Project.objects.filter(
                        id__in=requested_projects, is_deleted=False, status="active",
                    ).values_list("id", "helpdesk_id")
                )
            except (DjangoValidationError, ValueError, TypeError):
                return Response({"projects": "Invalid project id(s)."}, status=400)
            valid_proj = {str(pid): str(hid) for pid, hid in rows}
            if any(str(pid) not in valid_proj for pid in requested_projects):
                return Response(
                    {"projects": "Unknown or inactive project id(s)."}, status=400
                )
            requested_hd_ids = {str(hid) for hid, _ in requested}
            if any(valid_proj[str(pid)] not in requested_hd_ids for pid in requested_projects):
                return Response(
                    {"projects": "Each project's helpdesk must be assigned too."}, status=400
                )

        # Requestors are portal-only end-users — no helpdesk OR project membership.
        if role is not None and role.code == "requestor" and (requested or requested_projects):
            return Response(
                {"detail": "Requestors cannot be assigned helpdesks or projects."}, status=400
            )

        # Sign-in method (per-user SSO). Microsoft users authenticate via Entra —
        # no local password is set or shared, and an email is required to match
        # the directory account on sign-in.
        auth_method = (data.get("auth_method") or "password").strip().lower()
        if auth_method not in ("password", "microsoft"):
            return Response({"auth_method": "Must be 'password' or 'microsoft'."}, status=400)
        is_sso = auth_method == "microsoft"
        if is_sso and not (data.get("email") or "").strip():
            return Response(
                {"email": "Email is required for a Microsoft sign-in user."}, status=400
            )

        temp_password = None if is_sso else (
            (data.get("password") or "").strip() or _generate_temp_password()
        )
        user_payload = {
            "username": data.get("username"),
            "email": data.get("email", ""),
            "full_name": data.get("full_name", ""),
            "is_active": data.get("is_active", True),
            "app_access": [],
            "auth_method": auth_method,
        }
        if not is_sso:
            user_payload["password"] = temp_password
        user_ser = UserSerializer(data=user_payload)
        user_ser.is_valid(raise_exception=True)

        with transaction.atomic():
            user = user_ser.save()
            if role is not None:
                RoleAssignment.all_objects.update_or_create(
                    user=user, defaults={"role": role, "is_deleted": False}
                )
            for hd_id, role_in in requested:
                HelpdeskMembership.objects.update_or_create(
                    helpdesk_id=hd_id,
                    user=user,
                    defaults={
                        "role_in_helpdesk": role_in,
                        "is_active": True,
                        "is_deleted": False,
                    },
                )
            if requested_projects:
                from apps.itsm_projects.models import ProjectMembership
                for pid in requested_projects:
                    ProjectMembership.objects.update_or_create(
                        project_id=pid, user=user,
                        defaults={"is_active": True, "is_deleted": False},
                    )

        invalidate_permission_cache()
        payload = MemberSerializer(self.get_queryset().get(pk=user.pk)).data
        if temp_password:
            payload["temp_password"] = temp_password
        return Response(payload, status=201)

    @action(detail=True, methods=["post"])
    def set_active(self, request, pk=None):
        """Activate / deactivate a user. Body: {is_active: bool}."""
        user = self.get_object()
        if str(user.pk) == str(request.user.pk):
            return Response(
                {"detail": "You cannot deactivate your own account."}, status=400
            )
        user.is_active = bool(request.data.get("is_active", True))
        user.save(update_fields=["is_active"])
        return Response(MemberSerializer(user).data)

    @action(detail=True, methods=["post"])
    def set_role(self, request, pk=None):
        """(Re)assign or clear a user's single ITSM role. Body: {role_code}.

        Uses the all-rows manager so it revives a previously cleared assignment
        (the OneToOne row physically survives a soft-delete) rather than
        colliding with the unique constraint on re-assign.
        """
        user = self.get_object()
        role_code = (request.data.get("role_code") or "").strip()
        is_self = str(user.pk) == str(request.user.pk)
        if not role_code:
            if is_self and not request.user.is_superuser:
                return Response(
                    {"detail": "You cannot clear your own role."}, status=400
                )
            RoleAssignment.all_objects.filter(user=user).update(is_deleted=True)
            invalidate_permission_cache()
            return Response(MemberSerializer(self.get_queryset().get(pk=user.pk)).data)
        role = SystemRole.objects.filter(
            code=role_code, is_active=True, is_deleted=False
        ).first()
        if role is None:
            return Response({"detail": "Unknown role."}, status=400)
        with transaction.atomic():
            RoleAssignment.all_objects.update_or_create(
                user=user, defaults={"role": role, "is_deleted": False}
            )
            if role.code == "requestor":
                # Demoting to requestor strips agent access immediately: a requestor
                # is portal-only and must hold no helpdesk/project membership.
                from apps.itsm_helpdesks.models import HelpdeskMembership
                from apps.itsm_projects.models import ProjectMembership

                HelpdeskMembership.objects.filter(user=user, is_active=True).update(
                    is_active=False
                )
                ProjectMembership.objects.filter(user=user, is_active=True).update(
                    is_active=False
                )
        invalidate_permission_cache()
        return Response(MemberSerializer(self.get_queryset().get(pk=user.pk)).data)

    @action(detail=True, methods=["post"])
    def reset_password(self, request, pk=None):
        """Reset a user's password. Body: {password?} — generated if omitted.

        Returns the new one-time ``temp_password`` for the admin to share.
        Resetting a superuser's password requires the caller to be a superuser
        (so a Supervisor can't take over an admin account).
        """
        user = self.get_object()
        if user.is_superuser and not request.user.is_superuser:
            return Response(
                {"detail": "Only a superuser can reset a superuser's password."},
                status=403,
            )
        provided = (request.data.get("password") or "").strip()
        if provided and len(provided) < 8:
            return Response(
                {"password": "Password must be at least 8 characters."}, status=400
            )
        new_password = provided or _generate_temp_password()
        user.set_password(new_password)
        user.save(update_fields=["password"])
        payload = MemberSerializer(user).data
        payload["temp_password"] = new_password
        return Response(payload)


# ── Single Sign-On (Microsoft Entra) ────────────────────────────────────────


class SsoConfigAdminView(APIView):
    """Tenant admin CRUD for the per-org SSO config (one row per schema).

    GET returns the current settings (secret never read back; the Redirect URI to
    register in Entra is surfaced). PUT upserts. Gated by ``itsm.admin.sso``."""

    permission_classes = [HasModulePermission]
    module_code = "itsm.admin.sso"

    def get(self, request):
        # A transient default when none exists yet → never writes on a read.
        config = TenantSSOConfig.current() or TenantSSOConfig()
        return Response(TenantSSOConfigSerializer(config).data)

    def put(self, request):
        config = TenantSSOConfig.current()
        if config is None:
            config = TenantSSOConfig.objects.create()
        ser = TenantSSOConfigSerializer(config, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)


class SsoPublicConfigView(APIView):
    """Unauthenticated: tells the login page whether to show the Microsoft button."""

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(exclude=True)
    def get(self, request):
        # Reachable without a /t/<org>/ prefix (public schema) where the tenant
        # table doesn't exist — answer "off" instead of a 500.
        if connection.schema_name == get_public_schema_name():
            return Response({"microsoft_enabled": False})
        config = TenantSSOConfig.current()
        return Response({"microsoft_enabled": bool(config and config.microsoft_enabled)})


@extend_schema(exclude=True)
class MicrosoftSsoStartView(APIView):
    """Begin sign-in: redirect the browser to the org's Entra authorize endpoint.

    Sets a short-lived, HttpOnly cookie carrying the flow nonce; the callback
    requires it back, which binds the OIDC response to THIS browser (login-CSRF)."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        if connection.schema_name == get_public_schema_name():
            return redirect(sso.login_page_url("error", detail="Unknown organisation."))
        try:
            config = sso.get_microsoft_config()
            url, nonce = sso.authorize_url(config)
        except sso.SsoError as exc:
            return redirect(sso.login_page_url("error", detail=str(exc)))
        resp = redirect(url)
        resp.set_cookie(
            sso.STATE_COOKIE, nonce, max_age=600,
            httponly=True, secure=request.is_secure(), samesite="Lax", path="/",
        )
        return resp


@extend_schema(exclude=True)
class MicrosoftSsoCallbackView(APIView):
    """Entra redirect target. Validates the response, resolves/creates the local
    user, then bounces to the SPA login page with a one-time handoff code."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        dest = self._resolve(request)
        resp = redirect(dest)
        # The flow cookie is single-use — clear it however the flow ended.
        resp.delete_cookie(sso.STATE_COOKIE, path="/")
        return resp

    def _resolve(self, request) -> str:
        error = request.query_params.get("error")
        if error:
            detail = request.query_params.get("error_description") or error
            return sso.login_page_url("error", detail=detail)

        try:
            org, nonce = sso.parse_state(request.query_params.get("state", ""))
        except Exception:  # noqa: BLE001 — bad/expired/forged state
            return sso.login_page_url("error", detail="Sign-in expired. Please try again.")

        # The path-middleware already set the schema; refuse a state/path mismatch.
        if org and connection.schema_name != org:
            return sso.login_page_url("error", detail="Organisation mismatch.")

        # Login-CSRF guard: the state's nonce must match the cookie set when THIS
        # browser started the flow. Stops an attacker force-logging a victim into
        # the attacker's account with a captured (state, code) pair.
        cookie_nonce = request.COOKIES.get(sso.STATE_COOKIE, "")
        if not cookie_nonce or not constant_time_compare(cookie_nonce, nonce):
            return sso.login_page_url("error", detail="Sign-in could not be verified. Please start again.")

        try:
            config = sso.get_microsoft_config()
            payload = sso.exchange_code(config, request.query_params.get("code", ""))
            claims = sso.decode_id_token(payload["id_token"])
            sso.validate_claims(claims, config, nonce)
            user = sso.resolve_or_create_user(claims, config)
            handoff = sso.make_handoff_code(user)
        except sso.SsoError as exc:
            return sso.login_page_url("error", detail=str(exc))
        except Exception as exc:  # noqa: BLE001
            logger.warning("SSO callback failure (org=%s): %s", connection.schema_name, exc)
            return sso.login_page_url("error", detail="Sign-in failed. Please try again.")

        return sso.login_page_url("success", code=handoff)


class MicrosoftSsoExchangeView(APIView):
    """Swap the one-time handoff code for the standard ITSM JWT pair."""

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(exclude=True)
    def post(self, request):
        code = (request.data.get("code") or "").strip()
        if not code:
            return Response({"detail": "Missing sign-in code."}, status=400)
        try:
            user = sso.redeem_handoff_code(code)
            return Response(sso.issue_tokens(user))
        except sso.SsoError as exc:
            return Response({"detail": str(exc)}, status=400)
