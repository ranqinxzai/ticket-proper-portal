from __future__ import annotations

from rest_framework import serializers

from .models import Project, TicketType


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
    ticket_types = TicketTypeSerializer(many=True, read_only=True)
    open_ticket_count = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = ["id", "helpdesk", "helpdesk_key", "helpdesk_name", "name", "key", "description",
                  "project_type", "status", "color", "icon",
                  "default_group", "default_group_name", "default_workflow", "default_workflow_name",
                  "lead", "ticket_types", "open_ticket_count", "created_at"]

    def get_open_ticket_count(self, obj):
        if not hasattr(obj, "_open_count"):
            return None
        return obj._open_count


class ProjectWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ["id", "helpdesk", "name", "key", "description", "project_type", "status",
                  "color", "icon", "default_group", "default_workflow", "lead"]
