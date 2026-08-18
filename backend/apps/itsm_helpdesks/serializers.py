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
                  "order", "notification_from_name", "notification_from_email",
                  "combined_queue_columns", "member_count", "created_at"]

    def get_member_count(self, obj):
        return obj.memberships.filter(is_active=True, is_deleted=False).count()


class HelpdeskWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Helpdesk
        fields = ["id", "name", "key", "description", "icon", "color", "status", "order",
                  "notification_from_name", "notification_from_email", "combined_queue_columns"]

    def validate_combined_queue_columns(self, value):
        """Keep only real columns for the All-Tickets queue: a known built-in, or a
        `cf:<key>` **value-backed** custom field defined on some active project in
        this helpdesk (the union). Drops unknown/stale keys, duplicates (order
        preserved), and column-backed (`config.maps_to`) system fields, which have no
        `FieldValue` and would render a blank column. On create custom columns are
        kept as-is (no projects to resolve against yet)."""
        from apps.itsm_tickets.services.filter_fields import clean_queue_columns, column_cf_keys

        valid_cf = (
            column_cf_keys(self.instance.projects.filter(is_deleted=False, status="active"))
            if self.instance is not None
            else None
        )
        return clean_queue_columns(value, valid_cf=valid_cf)
