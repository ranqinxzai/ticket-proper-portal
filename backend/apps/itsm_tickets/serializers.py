from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.itsm_core.models import AuditEvent

from .models import (
    CannedNote,
    CannedNoteCategory,
    Comment,
    CommentAttachment,
    TemplateCategory,
    Ticket,
    TicketAttachment,
    TicketLink,
    TicketTemplate,
    Watcher,
)


class UserBriefField(serializers.Serializer):
    """Read-only nested user brief."""
    def to_representation(self, user):
        if user is None:
            return None
        return {"id": str(user.id), "username": user.username,
                "full_name": getattr(user, "full_name", "") or user.username,
                "email": getattr(user, "email", "") or ""}


def _list_sla_entry(tracker, now):
    """Compact per-metric SLA summary for the queue's RAG bar columns.

    Uses a cheap wall-clock fraction for the green/amber/red band so the list
    endpoint never pays a business-time calendar read per row (the detail view's
    ``/tickets/{id}/sla/`` action computes the exact business-time figure). The
    client ticks the remaining/overdue label locally from ``due_at``."""
    breached = bool(tracker.breached) or (tracker.state == "running" and now > tracker.due_at)
    span = (tracker.due_at - tracker.started_at).total_seconds()
    frac = ((now - tracker.started_at).total_seconds() / span) if span > 0 else 1.0
    if tracker.state in ("met", "stopped"):
        rag = "red" if breached else "green"
    elif breached or frac >= 1.0:
        rag = "red"
    elif frac >= 0.75:
        rag = "amber"
    else:
        rag = "green"
    return {
        "state": tracker.state,
        "due_at": tracker.due_at.isoformat(),
        "started_at": tracker.started_at.isoformat(),
        "target_minutes": tracker.target_minutes,
        "breached": breached,
        "paused": tracker.state == "paused",
        "rag": rag,
    }


class TicketListSerializer(serializers.ModelSerializer):
    project_key = serializers.CharField(source="project.key", read_only=True)
    status_name = serializers.CharField(source="status.name", read_only=True)
    status_category = serializers.CharField(source="status.category.key", read_only=True)
    status_color = serializers.CharField(source="status.color", read_only=True)
    assignee = UserBriefField(read_only=True)
    requestor = UserBriefField(read_only=True)
    created_by = UserBriefField(read_only=True)
    updated_by = UserBriefField(read_only=True)
    assigned_group_name = serializers.CharField(source="assigned_group.name", read_only=True)
    ticket_type_name = serializers.CharField(source="ticket_type.name", read_only=True)
    sla = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = ["id", "ticket_number", "project", "project_key", "ticket_type", "ticket_type_name",
                  "summary", "status", "status_name", "status_category", "status_color",
                  "priority", "assignee", "requestor", "assigned_group", "assigned_group_name",
                  "created_by", "updated_by",
                  "due_date", "created_at", "updated_at", "resolved_at", "sla"]

    def get_sla(self, obj):
        from django.utils import timezone
        now = timezone.now()
        out = {"first_response": None, "resolution": None}
        # `sla_trackers` is prefetched (with `metric`) by the viewset — no N+1.
        for tr in obj.sla_trackers.all():
            kind = tr.metric.kind
            if kind in out and out[kind] is None:
                out[kind] = _list_sla_entry(tr, now)
        return out


class TicketDetailSerializer(TicketListSerializer):
    workflow_name = serializers.CharField(source="workflow.name", read_only=True)
    custom_fields = serializers.SerializerMethodField()

    class Meta(TicketListSerializer.Meta):
        fields = TicketListSerializer.Meta.fields + [
            "description_html", "description_text", "workflow",
            "workflow_name", "impact", "urgency", "resolution", "source",
            "first_responded_at", "assigned_at", "closed_at", "reopen_count", "custom_fields",
        ]

    def get_custom_fields(self, obj):
        from apps.itsm_core.services import fields as field_service
        return field_service.get_values(obj)


class TicketCreateSerializer(serializers.Serializer):
    project = serializers.UUIDField()
    ticket_type = serializers.UUIDField()
    summary = serializers.CharField(max_length=500)
    description_html = serializers.CharField(required=False, allow_blank=True, default="")
    priority = serializers.ChoiceField(
        choices=["critical", "high", "medium", "low"], default="medium"
    )
    impact = serializers.CharField(required=False, allow_blank=True, default="")
    urgency = serializers.CharField(required=False, allow_blank=True, default="")
    # requestor/assignee are User FKs (integer PK in this project) — accept any PK
    # representation; resolved via _user(pk=…). assigned_group is a UUID-PK model.
    requestor = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    assigned_group = serializers.UUIDField(required=False, allow_null=True)
    assignee = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    source = serializers.ChoiceField(
        choices=["agent", "portal", "email", "phone", "api"], default="agent"
    )
    custom_fields = serializers.DictField(required=False, default=dict)


class CommentAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = CommentAttachment
        fields = ["id", "ticket", "comment", "kind", "file", "original_name",
                  "size_bytes", "content_type", "created_at"]
        read_only_fields = ["size_bytes", "content_type", "original_name", "comment"]


class CommentSerializer(serializers.ModelSerializer):
    author = UserBriefField(read_only=True)
    # File attachments listed under the comment (inline images live in body_html).
    # `file` URLs are absolute when the view passes `context={"request": ...}`.
    attachments = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = ["id", "ticket", "author", "visibility", "body_html", "body_text",
                  "edited_at", "created_at", "attachments"]
        read_only_fields = ["body_text", "author"]

    def get_attachments(self, obj):
        atts = obj.attachments.filter(is_deleted=False).order_by("created_at")
        return CommentAttachmentSerializer(atts, many=True, context=self.context).data


class WatcherSerializer(serializers.ModelSerializer):
    user = UserBriefField(read_only=True)
    # Write path: POST {ticket, user_id} adds an arbitrary user as a watcher (the
    # nested ``user`` stays read-only for the response). The agent watcher picker uses this.
    user_id = serializers.PrimaryKeyRelatedField(
        source="user", queryset=get_user_model().objects.all(), write_only=True
    )

    class Meta:
        model = Watcher
        fields = ["id", "ticket", "user", "user_id"]


class TicketLinkSerializer(serializers.ModelSerializer):
    target_number = serializers.CharField(source="target_ticket.ticket_number", read_only=True)
    target_summary = serializers.CharField(source="target_ticket.summary", read_only=True)

    class Meta:
        model = TicketLink
        fields = ["id", "source_ticket", "target_ticket", "target_number", "target_summary", "link_type"]


class TicketAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketAttachment
        fields = ["id", "ticket", "file", "original_name", "size_bytes", "content_type", "created_at"]
        read_only_fields = ["size_bytes", "content_type", "original_name"]


class AuditEventSerializer(serializers.ModelSerializer):
    actor = UserBriefField(read_only=True)

    class Meta:
        model = AuditEvent
        fields = ["id", "ticket", "actor", "action", "field_key", "payload", "created_at"]


class CannedNoteCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = CannedNoteCategory
        fields = ["id", "name", "sort_order", "is_active"]


class CannedNoteSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)
    helpdesk_name = serializers.CharField(source="helpdesk.name", read_only=True, default=None)
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)
    owner = UserBriefField(read_only=True)
    scope_label = serializers.SerializerMethodField()

    class Meta:
        model = CannedNote
        fields = ["id", "category", "category_name", "title", "body_html", "body_text",
                  "shortcut", "scope", "scope_label", "helpdesk", "helpdesk_name",
                  "project", "project_name", "is_shared", "owner", "usage_count", "created_at"]
        # `is_shared` is server-derived from `scope` (never client-set, see validate()).
        read_only_fields = ["body_text", "usage_count", "is_shared"]

    _SCOPE_LABELS = {"personal": "Personal", "workspace": "Workspace", "project": "Project"}

    def get_scope_label(self, obj):
        return self._SCOPE_LABELS.get(obj.scope, obj.scope)

    def validate(self, attrs):
        """Derive is_shared + the label FKs from scope. Project scope derives its
        helpdesk from the project (never trusts a client-sent helpdesk)."""
        scope = attrs.get("scope", getattr(self.instance, "scope", "workspace"))
        helpdesk = attrs.get("helpdesk", getattr(self.instance, "helpdesk", None))
        project = attrs.get("project", getattr(self.instance, "project", None))
        if scope == "personal":
            attrs["helpdesk"], attrs["project"], attrs["is_shared"] = None, None, False
        elif scope == "workspace":
            attrs["project"], attrs["is_shared"] = None, True
            attrs["helpdesk"] = helpdesk            # optional label; may be None (legacy)
        elif scope == "project":
            if not project:
                raise serializers.ValidationError(
                    {"project": "A project is required for project scope."})
            attrs["project"], attrs["is_shared"] = project, True
            attrs["helpdesk"] = project.helpdesk    # derive label; ignore client helpdesk
        return attrs


class TemplateCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = TemplateCategory
        fields = ["id", "name", "sort_order"]


class TicketTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketTemplate
        fields = ["id", "project", "category", "name", "description", "ticket_type",
                  "default_priority", "default_group", "default_assignee",
                  "summary_template", "description_html", "field_defaults", "is_active"]
