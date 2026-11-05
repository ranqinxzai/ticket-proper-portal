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
                  "combined_queue_columns", "combined_default_view_key",
                  "combined_disabled_view_keys", "member_count", "created_at"]

    def get_member_count(self, obj):
        return obj.memberships.filter(is_active=True, is_deleted=False).count()


class HelpdeskWriteSerializer(serializers.ModelSerializer):
    # Create only: also import the standard Incident + Service Request projects
    # (HelpdeskViewSet.perform_create). Default off for API callers; the UI ticks it.
    with_standard_projects = serializers.BooleanField(
        write_only=True, required=False, default=False)

    class Meta:
        model = Helpdesk
        fields = ["id", "name", "key", "description", "icon", "color", "status", "order",
                  "notification_from_name", "notification_from_email", "combined_queue_columns",
                  "combined_default_view_key", "combined_disabled_view_keys",
                  "with_standard_projects"]

    def update(self, instance, validated_data):
        validated_data.pop("with_standard_projects", None)  # create-only flag
        return super().update(instance, validated_data)

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

    def validate_combined_disabled_view_keys(self, value):
        """Keep only real system-view keys; "all" can never be disabled."""
        from apps.itsm_tickets.services.filter_fields import clean_disabled_view_keys

        return clean_disabled_view_keys(value)

    def validate_combined_default_view_key(self, value):
        """A system view key, or ``saved:<uuid>`` of a filter shared from THIS
        helpdesk's All Tickets (project=null) — the only saved views every agent's
        All-Tickets queue lists. Anything else blanks (product default). On create
        there are no such filters yet, so only system keys survive."""
        from django.db.models import Q

        from apps.itsm_tickets.services.filter_fields import clean_default_view_key

        visible = (
            Q(project__isnull=True, helpdesk=self.instance) if self.instance is not None
            else Q(pk__in=[])
        )
        return clean_default_view_key(value, visible)
