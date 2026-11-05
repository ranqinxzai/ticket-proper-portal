from __future__ import annotations

from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from .models import Dashboard, QueueColumnPreference, QueueViewPreference, SavedFilter, Widget


class SavedFilterSerializer(serializers.ModelSerializer):
    # Who created it — the All-Tickets / project Filters settings list shows it.
    owner_name = serializers.SerializerMethodField()

    class Meta:
        model = SavedFilter
        fields = ["id", "name", "owner", "owner_name", "project", "helpdesk", "is_shared",
                  "sort_order", "query_spec", "created_at"]
        read_only_fields = ["owner"]

    def get_owner_name(self, obj):
        u = obj.owner
        return (u.full_name or u.username) if u is not None else ""

    def validate(self, attrs):
        """A view belongs to the queue it is saved from (rule 15 — never widen):

        * ``project`` set → the caller must be able to open that project (403), and
          ``helpdesk`` is forced to null (a project view's helpdesk is its project's);
        * ``project`` null → an All-Tickets view: ``helpdesk`` is required (400) and
          must be one the caller can access (403; superuser ``None`` = any).
        On PATCH the scope is re-checked only when project/helpdesk is sent."""
        from apps.itsm_helpdesks.services import (
            accessible_helpdesk_ids_cached,
            is_project_accessible,
        )

        request = self.context.get("request")
        if self.instance is not None and "project" not in attrs and "helpdesk" not in attrs:
            return attrs
        project = attrs.get("project", getattr(self.instance, "project", None))
        helpdesk = attrs.get("helpdesk", getattr(self.instance, "helpdesk", None))
        if project is not None:
            if request is not None and not is_project_accessible(
                    request.user, project.pk, request=request):
                raise PermissionDenied("You do not have access to this project.")
            attrs["helpdesk"] = None
            return attrs
        if helpdesk is None:
            raise serializers.ValidationError(
                {"helpdesk": "Pick the helpdesk this view belongs to."})
        if request is not None:
            accessible = accessible_helpdesk_ids_cached(request)
            if accessible is not None and helpdesk.pk not in accessible:
                raise PermissionDenied("You do not have access to this helpdesk.")
        return attrs


class QueueColumnPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = QueueColumnPreference
        fields = ["id", "project", "columns"]

    def validate_columns(self, value):
        """Keep only real columns (visible, or ``!``-hidden with their place kept)
        via the shared ``clean_queue_columns``; ``[]`` = fall back to the default."""
        from apps.itsm_tickets.services.filter_fields import clean_queue_columns

        return clean_queue_columns(value)


class QueueViewPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = QueueViewPreference
        fields = ["id", "project", "view_key"]


class WidgetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Widget
        fields = ["id", "dashboard", "widget_type", "title", "saved_filter",
                  "config", "sort_order", "position"]


class DashboardSerializer(serializers.ModelSerializer):
    widgets = WidgetSerializer(many=True, read_only=True)

    class Meta:
        model = Dashboard
        fields = ["id", "name", "owner", "is_shared", "layout", "widgets", "created_at"]
        read_only_fields = ["owner"]
