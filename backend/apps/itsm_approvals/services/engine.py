"""Approval engine — start a request, resolve approvers, record decisions, advance.

All status changes on the ticket still go through the workflow engine (the
``approval_granted`` condition gates the relevant transition); this module only
manages the ApprovalRequest/Action lifecycle and emits notifications.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.itsm_core.services import hooks


def resolve_approver_ids(stage, ticket) -> set:
    """User ids who may act on `stage` for `ticket`."""
    t = stage.approver_type
    if t == "specific_user":
        return {stage.approver_user_id} if stage.approver_user_id else set()
    if t == "role":
        if not stage.approver_role_id:
            return set()
        from apps.itsm_rbac.models import RoleAssignment
        return set(
            RoleAssignment.objects.filter(role_id=stage.approver_role_id, is_deleted=False)
            .values_list("user_id", flat=True)
        )
    if t == "group":
        if not stage.approver_group_id:
            return set()
        from apps.itsm_groups.models import GroupMembership
        return set(
            GroupMembership.objects.filter(
                group_id=stage.approver_group_id, is_active=True, is_deleted=False
            ).values_list("user_id", flat=True)
        )
    if t == "requestor_manager":
        mgr_id = getattr(getattr(ticket, "requestor", None), "manager_id", None)
        if mgr_id:
            return {mgr_id}
        # No manager pointer → fall back to a configured fallback approver if set.
        return {stage.approver_user_id} if stage.approver_user_id else set()
    return set()


@transaction.atomic
def start_approval(ticket, workflow, *, user=None):
    """Create a pending ApprovalRequest for `ticket` under `workflow`. Idempotent:
    if an active pending request already exists, returns it."""
    from ..models import ApprovalRequest

    existing = ApprovalRequest.objects.filter(
        ticket=ticket, status="pending", is_deleted=False
    ).first()
    if existing:
        return existing

    first_stage = workflow.stages.order_by("level").first()
    req = ApprovalRequest.objects.create(
        ticket=ticket, workflow=workflow, current_stage=first_stage,
        status="pending", requested_by=user,
    )

    def _notify():
        hooks.emit_event("ApprovalRequested", ticket, actor=user,
                         context={"approval_request": str(req.id)})
    transaction.on_commit(_notify)
    return req


def _stage_satisfied(req, stage) -> bool:
    """True once `stage` has enough approvals per its rule."""
    from ..models import ApprovalAction

    approvals = ApprovalAction.objects.filter(
        approval_request=req, stage=stage, decision="approved"
    ).values_list("approver_id", flat=True)
    approvers = set(a for a in approvals if a is not None)
    if stage.rule == "all":
        required = resolve_approver_ids(stage, req.ticket)
        return bool(required) and required.issubset(approvers)
    return len(approvers) >= max(1, stage.min_approvals)


@transaction.atomic
def decide(req, approver, decision: str, comment: str = ""):
    """Record an approve/reject by `approver` on the request's current stage."""
    from ..models import ApprovalAction, ApprovalRequest

    req = ApprovalRequest.objects.select_for_update().get(pk=req.pk)
    if req.status != "pending":
        from apps.itsm_workflows.services.engine import TransitionError
        raise TransitionError("This approval is already decided.", status_code=409)

    stage = req.current_stage
    allowed = resolve_approver_ids(stage, req.ticket) if stage else set()
    if not (getattr(approver, "is_superuser", False) or approver.id in allowed):
        from apps.itsm_workflows.services.engine import TransitionError
        raise TransitionError("You are not an approver for this stage.", status_code=403)

    ApprovalAction.objects.create(
        approval_request=req, stage=stage, approver=approver,
        decision=decision, comment=comment or "",
    )

    event = None
    if decision == "rejected":
        req.status = "rejected"
        req.decided_at = timezone.now()
        req.save(update_fields=["status", "decided_at", "updated_at"])
        event = "ApprovalRejected"
    elif _stage_satisfied(req, stage):
        next_stage = req.workflow.stages.filter(level__gt=stage.level).order_by("level").first() if stage else None
        if next_stage:
            req.current_stage = next_stage
            req.save(update_fields=["current_stage", "updated_at"])
            event = "ApprovalRequested"  # notify the next level
        else:
            req.status = "approved"
            req.decided_at = timezone.now()
            req.current_stage = None
            req.save(update_fields=["status", "decided_at", "current_stage", "updated_at"])
            event = "ApprovalGranted"

    if event:
        ticket = req.ticket
        actor = approver

        def _notify():
            hooks.emit_event(event, ticket, actor=actor, context={"approval_request": str(req.id)})
        transaction.on_commit(_notify)
    return req


def pending_for(user):
    """Pending ApprovalRequests where `user` is an approver of the current stage and
    has not yet acted at that stage."""
    from ..models import ApprovalAction, ApprovalRequest

    if not user or not getattr(user, "is_authenticated", False):
        return ApprovalRequest.objects.none()

    role_id = None
    assignment = getattr(user, "itsm_role_assignment", None)
    if assignment and assignment.role_id:
        role_id = assignment.role_id

    q = (
        Q(current_stage__approver_type="specific_user", current_stage__approver_user=user)
        | Q(current_stage__approver_type="requestor_manager", ticket__requestor__manager=user)
        | Q(current_stage__approver_type="group",
            current_stage__approver_group__memberships__user=user,
            current_stage__approver_group__memberships__is_active=True)
    )
    if role_id:
        q |= Q(current_stage__approver_type="role", current_stage__approver_role_id=role_id)

    from django.db.models import F

    return (
        ApprovalRequest.objects.filter(status="pending", is_deleted=False)
        .filter(q)
        # Drop requests where this user already acted at the *current* stage.
        .exclude(actions__approver=user, actions__stage=F("current_stage"))
        .select_related("ticket", "workflow", "current_stage")
        .distinct()
    )
