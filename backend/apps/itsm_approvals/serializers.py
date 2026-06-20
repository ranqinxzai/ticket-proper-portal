from __future__ import annotations

from rest_framework import serializers

from .models import ApprovalAction, ApprovalRequest, ApprovalStage, ApprovalWorkflow


class ApprovalStageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApprovalStage
        fields = ["id", "workflow", "name", "level", "approver_type", "approver_user",
                  "approver_role", "approver_group", "rule", "min_approvals"]


class ApprovalWorkflowSerializer(serializers.ModelSerializer):
    stages = ApprovalStageSerializer(many=True, read_only=True)

    class Meta:
        model = ApprovalWorkflow
        fields = ["id", "name", "description", "helpdesk", "mode", "is_active", "stages"]


class ApprovalActionSerializer(serializers.ModelSerializer):
    approver_name = serializers.CharField(source="approver.full_name", read_only=True, default=None)

    class Meta:
        model = ApprovalAction
        fields = ["id", "approval_request", "stage", "approver", "approver_name",
                  "decision", "comment", "created_at"]


class ApprovalRequestSerializer(serializers.ModelSerializer):
    ticket_number = serializers.CharField(source="ticket.ticket_number", read_only=True)
    ticket_summary = serializers.CharField(source="ticket.summary", read_only=True)
    workflow_name = serializers.CharField(source="workflow.name", read_only=True)
    current_stage_name = serializers.CharField(source="current_stage.name", read_only=True, default=None)
    current_stage_level = serializers.IntegerField(source="current_stage.level", read_only=True, default=None)
    actions = ApprovalActionSerializer(many=True, read_only=True)

    class Meta:
        model = ApprovalRequest
        fields = ["id", "ticket", "ticket_number", "ticket_summary", "workflow", "workflow_name",
                  "current_stage", "current_stage_name", "current_stage_level", "status",
                  "requested_by", "decided_at", "actions", "created_at"]
