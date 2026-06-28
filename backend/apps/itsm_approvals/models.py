"""Multi-level approvals (ITIL Service Request sign-off).

An `ApprovalWorkflow` is a reusable policy of ordered `ApprovalStage`s ("Level One",
"Level Two", …). When a ticket needs sign-off, an `ApprovalRequest` instance is
created (current_stage = level 1); each approver decision is an `ApprovalAction`.
The request gates a workflow transition via the engine's ``approval_granted``
condition, so nothing changes the ticket's status except the transition engine.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.itsm_core.models import BaseModel


class ApprovalWorkflow(BaseModel):
    class Mode(models.TextChoices):
        SEQUENTIAL = "sequential", "Sequential (one level after another)"
        PARALLEL = "parallel", "Parallel (all levels at once)"

    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    helpdesk = models.ForeignKey(
        "itsm_helpdesks.Helpdesk", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="approval_workflows",
    )
    project = models.ForeignKey(
        "itsm_projects.Project", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="approval_workflows",
        help_text="Project this approval policy applies to; null = helpdesk-wide / global.",
    )
    mode = models.CharField(max_length=12, choices=Mode.choices, default=Mode.SEQUENTIAL)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ApprovalStage(BaseModel):
    class ApproverType(models.TextChoices):
        SPECIFIC_USER = "specific_user", "Specific user"
        ROLE = "role", "Anyone with role"
        GROUP = "group", "Anyone in group"
        REQUESTOR_MANAGER = "requestor_manager", "Requestor's manager"

    class Rule(models.TextChoices):
        ANY = "any", "Any one approver"
        ALL = "all", "All resolved approvers"

    workflow = models.ForeignKey(ApprovalWorkflow, on_delete=models.CASCADE, related_name="stages")
    name = models.CharField(max_length=120)
    level = models.PositiveIntegerField(default=1)
    approver_type = models.CharField(max_length=20, choices=ApproverType.choices)
    approver_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    approver_role = models.ForeignKey(
        "itsm_rbac.SystemRole", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    approver_group = models.ForeignKey(
        "itsm_groups.Group", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    rule = models.CharField(max_length=4, choices=Rule.choices, default=Rule.ANY)
    min_approvals = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["level"]
        constraints = [
            models.UniqueConstraint(fields=["workflow", "level"], name="uniq_approval_workflow_level"),
        ]

    def __str__(self):
        return f"{self.workflow.name} · L{self.level} {self.name}"


class ApprovalRequest(BaseModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"

    ticket = models.ForeignKey(
        "itsm_tickets.Ticket", on_delete=models.CASCADE, related_name="approval_requests"
    )
    workflow = models.ForeignKey(ApprovalWorkflow, on_delete=models.PROTECT, related_name="requests")
    current_stage = models.ForeignKey(
        ApprovalStage, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["ticket", "status"]),
            models.Index(fields=["status", "current_stage"]),
        ]

    def __str__(self):
        return f"Approval[{self.status}] on {self.ticket_id}"


class ApprovalAction(BaseModel):
    class Decision(models.TextChoices):
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    approval_request = models.ForeignKey(
        ApprovalRequest, on_delete=models.CASCADE, related_name="actions"
    )
    stage = models.ForeignKey(ApprovalStage, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decision = models.CharField(max_length=10, choices=Decision.choices)
    comment = models.TextField(blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["approval_request", "stage"])]

    def __str__(self):
        return f"{self.decision} by {self.approver_id}"
