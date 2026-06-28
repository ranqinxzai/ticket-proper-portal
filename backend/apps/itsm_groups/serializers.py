from __future__ import annotations

from rest_framework import serializers

from .models import Group, GroupMembership, RoutingRule


class GroupMembershipSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)

    class Meta:
        model = GroupMembership
        fields = ["id", "group", "user", "username", "full_name", "role_in_group", "is_active"]


class GroupSerializer(serializers.ModelSerializer):
    lead_name = serializers.CharField(source="lead.full_name", read_only=True)
    helpdesk_name = serializers.CharField(source="helpdesk.name", read_only=True)
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = Group
        fields = ["id", "helpdesk", "helpdesk_name", "name", "key", "description", "type",
                  "lead", "lead_name", "is_active", "member_count", "created_at"]

    def get_member_count(self, obj):
        return obj.memberships.filter(is_active=True).count()


class RoutingRuleSerializer(serializers.ModelSerializer):
    target_group_name = serializers.CharField(source="target_group.name", read_only=True)
    target_assignee_name = serializers.CharField(source="target_assignee.full_name", read_only=True)

    class Meta:
        model = RoutingRule
        fields = ["id", "project", "name", "priority", "match_spec",
                  "target_group", "target_group_name",
                  "target_assignee", "target_assignee_name", "is_active"]
