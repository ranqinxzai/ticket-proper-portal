from __future__ import annotations

from django.db.models import Q
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet

from .models import Group, GroupMembership, RoutingRule
from .serializers import GroupMembershipSerializer, GroupSerializer, RoutingRuleSerializer


class GroupViewSet(ItsmModelViewSet):
    queryset = Group.objects.filter(is_deleted=False).select_related("lead", "helpdesk")
    serializer_class = GroupSerializer
    module_code = "itsm.groups"
    search_fields = ["name", "key", "description"]
    filterset_fields = ["type", "is_active", "helpdesk"]

    def get_queryset(self):
        # A helpdesk's "Assigned Groups" view shows that helpdesk's groups PLUS the
        # shared/global (null-helpdesk) teams. Clamp to the requester's accessible
        # helpdesks, honouring the advisory ?helpdesk= param. Superusers are unrestricted.
        from apps.itsm_helpdesks.services import resolve_helpdesk_scope
        qs = super().get_queryset()
        scope = resolve_helpdesk_scope(
            self.request.user, self.request.query_params.get("helpdesk"), request=self.request
        )
        if scope is not None:
            qs = qs.filter(Q(helpdesk_id__in=scope) | Q(helpdesk__isnull=True))
        return qs

    def perform_create(self, serializer):
        # A non-superuser may only create a group inside a helpdesk they belong to;
        # creating a shared/global (null-helpdesk) group is superuser-only.
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        helpdesk = serializer.validated_data.get("helpdesk")
        accessible = accessible_helpdesk_ids_cached(self.request)
        if accessible is not None and (helpdesk is None or helpdesk.id not in accessible):
            raise PermissionDenied("You do not have access to this helpdesk.")
        serializer.save()

    @action(detail=True, methods=["get"])
    def members(self, request, pk=None):
        group = self.get_object()
        rows = group.memberships.filter(is_active=True).select_related("user")
        return Response(GroupMembershipSerializer(rows, many=True).data)

    @action(detail=True, methods=["post"])
    def add_member(self, request, pk=None):
        group = self.get_object()
        membership, _ = GroupMembership.objects.update_or_create(
            group=group, user_id=request.data["user"],
            defaults={"role_in_group": request.data.get("role_in_group", "member"),
                      "is_active": True},
        )
        return Response(GroupMembershipSerializer(membership).data, status=201)

    @action(detail=True, methods=["post"])
    def remove_member(self, request, pk=None):
        group = self.get_object()
        GroupMembership.objects.filter(group=group, user_id=request.data["user"]).update(
            is_active=False
        )
        return Response(status=204)


class GroupMembershipViewSet(ItsmModelViewSet):
    queryset = GroupMembership.objects.filter(is_deleted=False).select_related("user", "group")
    serializer_class = GroupMembershipSerializer
    module_code = "itsm.groups"
    filterset_fields = ["group", "user", "is_active"]


class RoutingRuleViewSet(ItsmModelViewSet):
    queryset = RoutingRule.objects.filter(is_deleted=False).select_related(
        "target_group", "target_assignee"
    )
    serializer_class = RoutingRuleSerializer
    module_code = "itsm.groups"
    filterset_fields = ["project", "is_active"]
