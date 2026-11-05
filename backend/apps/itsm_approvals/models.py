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
    # Pause the ticket's SLA clocks (first response, resolution, assignment) while a
    # request under this policy is pending (2026-11-05c). Copied onto each request at
    # start, so flipping it never changes a request already in flight.
    pause_sla = models.BooleanField(default=False)

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
        # Picked by the agent who sends the ticket for approval (2026-10-24). The
        # stage only defines the pool; the picks live on ApprovalRequestApprover.
        ON_THE_FLY = "on_the_fly", "On fly (agent picks)"

    class OnFlyPool(models.TextChoices):
        ANY_USER = "any_user", "Any user"
        GROUP = "group", "Members of a group"
        LISTED_USERS = "listed_users", "Listed users"

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
    # On fly only: who the agent may pick from. "group" reuses `approver_group`;
    # "listed_users" uses `candidate_users`.
    on_fly_pool = models.CharField(max_length=16, choices=OnFlyPool.choices, blank=True, default="")
    candidate_users = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="+")

    class Meta:
        ordering = ["level"]
        constraints = [
            # Live stages only: a soft-deleted stage keeps its row (and level), so a
            # full unique made "delete stage 3, add it again" collide (B3).
            models.UniqueConstraint(
                fields=["workflow", "level"], condition=models.Q(is_deleted=False),
                name="uniq_approval_workflow_live_level",
            ),
        ]

    def __str__(self):
        return f"{self.workflow.name} · L{self.level} {self.name}"


class ApprovalRequest(BaseModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"

    class Source(models.TextChoices):
        # Started by a workflow transition, a catalog item or the admin `start` API.
        POLICY = "policy", "Workflow / catalog"
        # Started by an agent with "Send for approval" (2026-10-24): it may carry
        # on-the-fly picks and a note, can be withdrawn, and returns the ticket to
        # `return_status` when decided.
        SENT = "sent", "Sent by an agent"

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
    # Snapshots taken at start, so editing the policy (mode flip, stage add/delete)
    # never strands an in-flight request. `stage_ids` is used in parallel mode only:
    # every listed stage is pending at once until its rule is met.
    mode = models.CharField(
        max_length=12, choices=ApprovalWorkflow.Mode.choices,
        default=ApprovalWorkflow.Mode.SEQUENTIAL,
    )
    stage_ids = models.JSONField(default=list, blank=True)
    # Snapshot of ApprovalWorkflow.pause_sla at start: while this request is pending
    # the SLA engine keeps the ticket's clocks paused (``sla_engine._approval_pauses``).
    pause_sla = models.BooleanField(default=False)
    source = models.CharField(max_length=8, choices=Source.choices, default=Source.POLICY)
    note = models.TextField(blank=True)
    # Sent requests only: the status the ticket was sent from, and the waiting
    # status it was moved to (null = it stayed put).
    return_status = models.ForeignKey(
        "itsm_workflows.Status", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    waiting_status = models.ForeignKey(
        "itsm_workflows.Status", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

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


class ApprovalRequestApprover(BaseModel):
    """A person the sender picked for an On-fly stage of one request."""

    approval_request = models.ForeignKey(
        ApprovalRequest, on_delete=models.CASCADE, related_name="picked_approvers"
    )
    stage = models.ForeignKey(ApprovalStage, on_delete=models.CASCADE, related_name="+")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["approval_request", "stage", "user"], condition=models.Q(is_deleted=False),
                name="uniq_approval_request_stage_picked_user",
            ),
        ]

    def __str__(self):
        return f"{self.user_id} picked for {self.stage_id}"
