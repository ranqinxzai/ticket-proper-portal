from __future__ import annotations

from rest_framework import serializers

from .models import CatalogCategory, CatalogItem


class CatalogCategorySerializer(serializers.ModelSerializer):
    helpdesk_key = serializers.CharField(source="helpdesk.key", read_only=True, default=None)

    class Meta:
        model = CatalogCategory
        fields = ["id", "name", "slug", "description", "icon", "color", "parent",
                  "helpdesk", "helpdesk_key", "is_portal_visible", "sort_order"]


class CatalogItemSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    project_key = serializers.CharField(source="project.key", read_only=True)
    helpdesk_key = serializers.CharField(source="project.helpdesk.key", read_only=True)
    approval_workflow_name = serializers.CharField(
        source="approval_workflow.name", read_only=True, default=None
    )

    class Meta:
        model = CatalogItem
        fields = ["id", "category", "category_name", "name", "slug", "short_description",
                  "description_html", "icon", "project", "project_key", "helpdesk_key",
                  "ticket_type", "request_layout", "requires_approval", "approval_workflow",
                  "approval_workflow_name", "default_group", "default_priority",
                  "default_assignee", "summary_template", "field_defaults",
                  "is_portal_visible", "is_active", "sort_order"]
