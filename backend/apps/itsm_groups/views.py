from __future__ import annotations

from rest_framework.decorators import action
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet

from .models import Group, GroupMembership, RoutingRule
from .serializers import GroupMembershipSerializer, GroupSerializer, RoutingRuleSerializer


class GroupViewSet(ItsmModelViewSet):
    queryset = Group.objects.filter(is_deleted=False).select_related("lead")
    serializer_class = GroupSerializer
    module_code = "itsm.groups"
    search_fields = ["name", "key", "description"]
    filterset_fields = ["type", "is_active"]

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
    queryset = RoutingRule.objects.filter(is_deleted=False).select_related("target_group")
    serializer_class = RoutingRuleSerializer
    module_code = "itsm.groups"
    filterset_fields = ["project", "is_active"]
