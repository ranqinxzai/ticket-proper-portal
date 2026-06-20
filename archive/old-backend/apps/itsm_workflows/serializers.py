from __future__ import annotations

from rest_framework import serializers

from .models import (
    AutoAssignmentRule,
    ReopenRule,
    Status,
    StatusCategory,
    Transition,
    TransitionCondition,
    TransitionScreen,
    Workflow,
)


class StatusCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = StatusCategory
        fields = ["id", "key", "name", "color", "sort_order"]


class StatusSerializer(serializers.ModelSerializer):
    category_key = serializers.CharField(source="category.key", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)

    class Meta:
        model = Status
        fields = ["id", "workflow", "name", "key", "category", "category_key", "category_name",
                  "color", "sort_order", "is_initial", "canvas_x", "canvas_y"]


class TransitionConditionSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransitionCondition
        fields = ["id", "transition", "condition_type", "config", "negate"]


class TransitionSerializer(serializers.ModelSerializer):
    from_status_key = serializers.CharField(source="from_status.key", read_only=True, default=None)
    to_status_key = serializers.CharField(source="to_status.key", read_only=True)
    conditions = TransitionConditionSerializer(many=True, read_only=True)

    class Meta:
        model = Transition
        fields = ["id", "workflow", "name", "from_status", "from_status_key",
                  "to_status", "to_status_key", "is_global", "sort_order",
                  "post_functions", "auto_assign_rule", "screen", "conditions"]


class WorkflowSerializer(serializers.ModelSerializer):
    status_count = serializers.SerializerMethodField()

    class Meta:
        model = Workflow
        fields = ["id", "name", "description", "base_type", "is_default", "is_active",
                  "version", "status_count", "created_at"]

    def get_status_count(self, obj):
        return obj.statuses.count()


class WorkflowGraphSerializer(serializers.ModelSerializer):
    statuses = StatusSerializer(many=True, read_only=True)
    transitions = TransitionSerializer(many=True, read_only=True)

    class Meta:
        model = Workflow
        fields = ["id", "name", "description", "base_type", "is_active", "version",
                  "statuses", "transitions"]


class AutoAssignmentRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutoAssignmentRule
        fields = ["id", "name", "strategy", "target_group", "fixed_user", "config"]


class ReopenRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReopenRule
        fields = ["id", "workflow", "reopen_to_status", "window_days", "requires_comment"]


class TransitionScreenSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransitionScreen
        fields = ["id", "workflow", "name"]
