from __future__ import annotations

from rest_framework.decorators import action
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet

from .models import Helpdesk, HelpdeskMembership
from .serializers import (
    HelpdeskMembershipSerializer,
    HelpdeskSerializer,
    HelpdeskWriteSerializer,
)
from .services import accessible_helpdesk_ids_cached


class HelpdeskViewSet(ItsmModelViewSet):
    """Workspaces/departments. Managed by Supervisors; an Agent only sees the
    helpdesks they are a member of (so the admin list mirrors Home access)."""

    queryset = Helpdesk.objects.filter(is_deleted=False)
    module_code = "itsm.admin.helpdesks"
    search_fields = ["name", "key", "description"]
    filterset_fields = ["status"]
    lookup_field = "pk"

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return HelpdeskWriteSerializer
        return HelpdeskSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        accessible = accessible_helpdesk_ids_cached(self.request)
        if accessible is not None:
            qs = qs.filter(pk__in=accessible)
        return qs

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        serializer.save(created_by=user)

    @action(detail=True, methods=["get"])
    def members(self, request, pk=None):
        helpdesk = self.get_object()
        rows = helpdesk.memberships.filter(is_active=True, is_deleted=False).select_related("user")
        return Response(HelpdeskMembershipSerializer(rows, many=True).data)

    @action(detail=True, methods=["post"])
    def add_member(self, request, pk=None):
        helpdesk = self.get_object()
        membership, _ = HelpdeskMembership.objects.update_or_create(
            helpdesk=helpdesk, user_id=request.data["user"],
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
