from __future__ import annotations

from rest_framework import serializers

from apps.itsm_core.models import AuditEvent

from .models import (
    CannedNote,
    CannedNoteCategory,
    Comment,
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
                "full_name": getattr(user, "full_name", "") or user.username}


class TicketListSerializer(serializers.ModelSerializer):
    project_key = serializers.CharField(source="project.key", read_only=True)
    status_name = serializers.CharField(source="status.name", read_only=True)
    status_category = serializers.CharField(source="status.category.key", read_only=True)
    status_color = serializers.CharField(source="status.color", read_only=True)
    assignee = UserBriefField(read_only=True)
    assigned_group_name = serializers.CharField(source="assigned_group.name", read_only=True)
    ticket_type_name = serializers.CharField(source="ticket_type.name", read_only=True)

    class Meta:
        model = Ticket
        fields = ["id", "ticket_number", "project", "project_key", "ticket_type", "ticket_type_name",
                  "summary", "status", "status_name", "status_category", "status_color",
                  "priority", "assignee", "assigned_group", "assigned_group_name",
                  "due_date", "created_at", "updated_at", "resolved_at"]


class TicketDetailSerializer(TicketListSerializer):
    requestor = UserBriefField(read_only=True)
    created_by = UserBriefField(read_only=True)
    workflow_name = serializers.CharField(source="workflow.name", read_only=True)
    custom_fields = serializers.SerializerMethodField()

    class Meta(TicketListSerializer.Meta):
        fields = TicketListSerializer.Meta.fields + [
            "description_html", "description_text", "requestor", "created_by", "workflow",
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
    requestor = serializers.UUIDField(required=False, allow_null=True)
    assigned_group = serializers.UUIDField(required=False, allow_null=True)
    assignee = serializers.UUIDField(required=False, allow_null=True)
    source = serializers.ChoiceField(
        choices=["agent", "portal", "email", "phone", "api"], default="agent"
    )
    custom_fields = serializers.DictField(required=False, default=dict)


class CommentSerializer(serializers.ModelSerializer):
    author = UserBriefField(read_only=True)

    class Meta:
        model = Comment
        fields = ["id", "ticket", "author", "visibility", "body_html", "body_text",
                  "edited_at", "created_at"]
        read_only_fields = ["body_text", "author"]


class WatcherSerializer(serializers.ModelSerializer):
    user = UserBriefField(read_only=True)

    class Meta:
        model = Watcher
        fields = ["id", "ticket", "user"]


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

    class Meta:
        model = CannedNote
        fields = ["id", "category", "category_name", "title", "body_html", "body_text",
                  "shortcut", "is_shared", "usage_count"]
        read_only_fields = ["body_text", "usage_count"]


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
