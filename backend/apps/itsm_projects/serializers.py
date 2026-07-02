from __future__ import annotations

import uuid as _uuid

from rest_framework import serializers

from .models import Project, ProjectMembership, TicketType


class ProjectMembershipSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)
    project_key = serializers.CharField(source="project.key", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    helpdesk = serializers.CharField(source="project.helpdesk_id", read_only=True)

    class Meta:
        model = ProjectMembership
        fields = ["id", "project", "project_key", "project_name", "helpdesk",
                  "user", "username", "full_name", "is_active"]


class TicketTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketType
        fields = ["id", "project", "name", "key", "icon", "base_category",
                  "parent", "is_active", "is_default", "sort_order"]


class ProjectSerializer(serializers.ModelSerializer):
    helpdesk_key = serializers.CharField(source="helpdesk.key", read_only=True)
    helpdesk_name = serializers.CharField(source="helpdesk.name", read_only=True)
    default_group_name = serializers.CharField(source="default_group.name", read_only=True)
    default_workflow_name = serializers.CharField(source="default_workflow.name", read_only=True)
    calendar_name = serializers.CharField(source="calendar.name", read_only=True)
    ticket_types = TicketTypeSerializer(many=True, read_only=True)
    open_ticket_count = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = ["id", "helpdesk", "helpdesk_key", "helpdesk_name", "name", "key", "description",
                  "project_type", "status", "color", "icon",
                  "default_group", "default_group_name", "default_workflow", "default_workflow_name",
                  "calendar", "calendar_name", "queue_columns",
                  "default_view_key", "disabled_view_keys", "allowed_group_ids",
                  "priority_matrix",
                  "lead", "ticket_types", "open_ticket_count", "created_at"]

    def get_open_ticket_count(self, obj):
        if not hasattr(obj, "_open_count"):
            return None
        return obj._open_count


class ProjectWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ["id", "helpdesk", "name", "key", "description", "project_type", "status",
                  "color", "icon", "default_group", "default_workflow", "calendar", "lead",
                  "queue_columns", "default_view_key", "disabled_view_keys", "allowed_group_ids",
                  "priority_matrix"]

    def validate_priority_matrix(self, value):
        """Validate + normalise the ITIL priority matrix (``matrix[impact][urgency]
        -> priority``). Unknown impact / urgency / priority codes are dropped, and the
        result is merged over the standard default so a partial edit never leaves a
        hole the auto-calc can't resolve."""
        from .models import default_priority_matrix

        impacts = {"low", "medium", "high", "critical"}
        urgencies = {"low", "medium", "high"}
        priorities = {"low", "medium", "high", "critical"}
        merged = default_priority_matrix()
        if isinstance(value, dict):
            for imp, row in value.items():
                if imp not in impacts or not isinstance(row, dict):
                    continue
                for urg, pri in row.items():
                    if urg in urgencies and pri in priorities:
                        merged.setdefault(imp, {})[urg] = pri
        return merged

    def validate_allowed_group_ids(self, value):
        """Keep only real group ids assignable on this project — a group in this
        project's helpdesk or a shared/global (null-helpdesk) team. Drop unknown
        ids and duplicates, preserving order. An empty list means *all groups are
        allowed* (the default, nothing restricted)."""
        import uuid as _uuid2

        from django.db.models import Q

        from apps.itsm_groups.models import Group

        # Resolve the owning helpdesk: the instance's on edit, else the payload's.
        helpdesk = self.instance.helpdesk_id if self.instance is not None else None
        helpdesk = (getattr(self, "initial_data", None) or {}).get("helpdesk", helpdesk)

        cleaned: list[str] = []
        for raw in value or []:
            raw = str(raw)
            try:
                _uuid2.UUID(raw)
            except (ValueError, TypeError, AttributeError):
                continue
            if raw in cleaned:
                continue
            visible = Q(helpdesk__isnull=True)
            if helpdesk:
                visible |= Q(helpdesk_id=helpdesk)
            if Group.objects.filter(visible, pk=raw, is_deleted=False).exists():
                cleaned.append(raw)
        return cleaned

    def validate_disabled_view_keys(self, value):
        """Keep only real system-view keys; "all" can never be disabled."""
        from apps.itsm_tickets.services.filter_fields import SYSTEM_VIEWS

        valid = {v["key"] for v in SYSTEM_VIEWS} - {"all"}
        seen: list[str] = []
        for k in value or []:
            if k in valid and k not in seen:
                seen.append(k)
        return seen

    def validate_default_view_key(self, value):
        """Accept a known system view key, or a ``saved:<uuid>`` reference to a
        **shared** filter visible on this project's queue (one scoped to this
        project, or a cross-project/global shared filter). Anything else — an
        unknown key, a deleted/personal filter, or a filter scoped to a *different*
        project — falls back to blank so the queue resolves the product default
        rather than a dangling or foreign reference no other agent can resolve."""
        value = (value or "").strip()
        if not value:
            return ""
        from apps.itsm_tickets.services.filter_fields import SYSTEM_VIEWS

        if value in {v["key"] for v in SYSTEM_VIEWS}:
            return value
        if value.startswith("saved:"):
            from django.db.models import Q

            from apps.itsm_dashboards.models import SavedFilter

            raw = value[len("saved:"):]
            try:
                _uuid.UUID(raw)
            except ValueError:
                return ""
            # Mirror SavedFilterViewSet's project scoping: only a shared filter on
            # this project (or a null-project/global shared one) is resolvable by
            # every agent's queue. On create there is no project yet, so only the
            # global shared scope can match.
            visible = Q(project__isnull=True)
            if self.instance is not None:
                visible |= Q(project=self.instance)
            if SavedFilter.objects.filter(
                visible, pk=raw, is_deleted=False, is_shared=True
            ).exists():
                return value
        return ""
