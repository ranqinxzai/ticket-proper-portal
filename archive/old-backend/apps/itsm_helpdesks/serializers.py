from __future__ import annotations

from rest_framework import serializers

from .models import Helpdesk, HelpdeskMembership


class HelpdeskMembershipSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)

    class Meta:
        model = HelpdeskMembership
        fields = ["id", "helpdesk", "user", "username", "full_name",
                  "role_in_helpdesk", "is_active"]


class HelpdeskSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = Helpdesk
        fields = ["id", "name", "key", "description", "icon", "color", "status",
                  "member_count", "created_at"]

    def get_member_count(self, obj):
        return obj.memberships.filter(is_active=True, is_deleted=False).count()


class HelpdeskWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Helpdesk
        fields = ["id", "name", "key", "description", "icon", "color", "status"]
