from __future__ import annotations

from django.db import transaction
from django.db.models import Max
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet
from apps.itsm_rbac.services import check_permission

from .models import Helpdesk, HelpdeskMembership
from .serializers import (
    HelpdeskMembershipSerializer,
    HelpdeskSerializer,
    HelpdeskWriteSerializer,
)
from .services import accessible_helpdesk_ids_cached


class HelpdeskViewSet(ItsmModelViewSet):
    """Workspaces/departments. Managed by Supervisors; an Agent only sees (read-only)
    the helpdesks they are a member of (so the agent list mirrors Home access)."""

    queryset = Helpdesk.objects.filter(is_deleted=False)
    module_code = "itsm.admin.helpdesks"
    search_fields = ["name", "key", "description"]
    filterset_fields = ["status"]
    ordering_fields = ["order", "name"]
    lookup_field = "pk"

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return HelpdeskWriteSerializer
        return HelpdeskSerializer

    def _is_manager(self):
        user = self.request.user
        return getattr(user, "is_superuser", False) or check_permission(
            user, self.module_code, "update"
        )

    def get_queryset(self):
        qs = super().get_queryset()
        # Managers (supervisors/superusers) administer ALL helpdesks — including
        # disabled/archived ones, so they can be re-enabled. Agents stay read-only
        # and clamped to their active memberships (mirrors Home access).
        if self._is_manager():
            return qs
        accessible = accessible_helpdesk_ids_cached(self.request)
        if accessible is not None:
            qs = qs.filter(pk__in=accessible)
        return qs

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        # New helpdesks append to the end of the Home ordering.
        next_order = (Helpdesk.objects.aggregate(m=Max("order"))["m"] or 0) + 1
        serializer.save(created_by=user, order=next_order)

    @action(detail=False, methods=["post"], url_path="reorder")
    def reorder(self, request):
        """Persist the global Home-card order. Body: `{"order": [id, id, …]}` —
        each helpdesk's `order` becomes its index in the list."""
        ids = request.data.get("order", [])
        with transaction.atomic():
            for index, hid in enumerate(ids):
                Helpdesk.objects.filter(pk=hid, is_deleted=False).update(order=index)
        return Response(status=204)

    @action(detail=True, methods=["get"])
    def members(self, request, pk=None):
        helpdesk = self.get_object()
        rows = helpdesk.memberships.filter(is_active=True, is_deleted=False).select_related("user")
        return Response(HelpdeskMembershipSerializer(rows, many=True).data)

    @action(detail=True, methods=["post"])
    def add_member(self, request, pk=None):
        from django.contrib.auth import get_user_model

        from apps.itsm_rbac.services import is_requestor

        helpdesk = self.get_object()
        # Only active helpdesks accept members (mirrors the active-only UI picker).
        if helpdesk.status != "active":
            return Response(
                {"detail": "Members can only be assigned to an active helpdesk."}, status=400
            )
        # Requestors are portal-only end-users and must never hold membership.
        target = get_user_model().objects.filter(pk=request.data.get("user")).first()
        if target is None:
            return Response({"detail": "Unknown user."}, status=400)
        if is_requestor(target):
            return Response(
                {"detail": "Requestors cannot be assigned to a helpdesk."}, status=400
            )
        membership, _ = HelpdeskMembership.objects.update_or_create(
            helpdesk=helpdesk, user=target,
            defaults={"role_in_helpdesk": request.data.get("role_in_helpdesk", "member"),
                      "is_active": True, "is_deleted": False},
        )
        return Response(HelpdeskMembershipSerializer(membership).data, status=201)

    @action(detail=True, methods=["post"])
    def remove_member(self, request, pk=None):
        helpdesk = self.get_object()
        HelpdeskMembership.objects.filter(helpdesk=helpdesk, user_id=request.data["user"]).update(
            is_active=False
        )
        return Response(status=204)


class HelpdeskMembershipViewSet(ItsmModelViewSet):
    queryset = HelpdeskMembership.objects.filter(is_deleted=False).select_related("user", "helpdesk")
    serializer_class = HelpdeskMembershipSerializer
    module_code = "itsm.admin.helpdesks"
    filterset_fields = ["helpdesk", "user", "is_active"]
