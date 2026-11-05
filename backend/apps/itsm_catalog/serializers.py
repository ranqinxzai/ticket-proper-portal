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

    def validate(self, attrs):
        """B4: "Needs approval" must name an active approval workflow that has at
        least one stage (and, if project-scoped, belongs to the item's project)."""
        inst = self.instance

        def cur(key):
            if key in attrs:
                return attrs[key]
            return getattr(inst, key) if inst is not None else None

        if cur("requires_approval"):
            wf = cur("approval_workflow")
            project = cur("project")
            msg = None
            if wf is None or wf.is_deleted:
                msg = "Pick the approval workflow this request needs, or turn off “Needs approval”."
            elif not wf.is_active:
                msg = f"The approval workflow “{wf.name}” is inactive. Activate it or pick another."
            elif not wf.stages.exists():
                msg = f"The approval workflow “{wf.name}” has no stages yet."
            elif wf.project_id and project is not None and wf.project_id != project.id:
                msg = f"The approval workflow “{wf.name}” belongs to another project."
            else:
                from apps.itsm_approvals.services.engine import has_on_fly_stage
                if has_on_fly_stage(wf):
                    msg = (f"The approval workflow “{wf.name}” has an On-fly stage, which only "
                           "Send for approval can start. Pick another one.")
            if msg:
                raise serializers.ValidationError({"approval_workflow": [msg]})
        return attrs
