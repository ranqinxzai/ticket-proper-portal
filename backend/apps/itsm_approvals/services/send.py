"""Send for approval (2026-10-24) — an agent starts an approval from the ticket.

The single write site (rule 4) for agent-started approvals:

- ``send_options(ticket, user)`` — what the "Send for approval" drawer offers: the
  project's active policies, who each fixed stage resolves to for THIS ticket, and
  the pool an On-fly stage picks from.
- ``send_for_approval`` — allowed only from a status flagged
  ``Status.allows_send_for_approval`` and only when nothing is pending. Starts the
  request (``source="sent"``, picks + note) and moves the ticket to the status's
  ``approval_waiting_status`` (if any) in the same transaction, so a refusal leaves
  the ticket untouched.
- ``withdraw`` — the sender (or ``itsm.approvals.send`` delete) cancels a pending
  SENT request; the ticket returns to the status it was sent from. Policy requests
  (transition / catalog) can't be withdrawn: that would bypass the approval gate.

Decisions return the ticket via ``engine.return_from_waiting`` (called by
``engine.decide``).
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from apps.itsm_core.services import hooks, log_event
from apps.itsm_workflows.services.engine import TransitionError

from . import engine

_CANDIDATE_CAP = 500
_NOTE_MAX = 2000


def waiting_status_for(status):
    """The usable waiting status configured on ``status``, or None (= stay put)."""
    target = getattr(status, "approval_waiting_status", None)
    if (target is None or target.is_deleted or target.id == status.id
            or target.workflow_id != status.workflow_id or target.category.key == "done"):
        return None
    return target


def blocked_reason(ticket) -> tuple[str | None, int]:
    """Why ``ticket`` can't be sent for approval right now → (message, http status)."""
    from apps.itsm_workflows.services.engine import has_pending_approval

    # Pending first: while it waits, the ticket usually sits in a waiting status that
    # isn't flagged itself, and "already pending" is the reason that matters.
    if has_pending_approval(ticket):
        return "An approval is already pending on this ticket.", 409
    status = ticket.status
    if status is None or not status.allows_send_for_approval:
        name = status.name if status is not None else "this status"
        return f"“{name}” doesn't allow Send for approval.", 400
    return None, 200


def _person(u) -> dict:
    return {"id": u.id, "name": engine._display(u), "username": u.username, "email": u.email or ""}


def _pool_label(stage) -> str:
    pool = stage.on_fly_pool
    if pool == "any_user":
        return "Any active person"
    if pool == "group":
        return f"Members of “{stage.approver_group.name}”" if stage.approver_group else "A group (not set)"
    if pool == "listed_users":
        return "The people listed in the stage"
    return "Not set"


def send_options(ticket, user) -> dict:
    from ..models import ApprovalWorkflow

    User = get_user_model()
    reason, _code = blocked_reason(ticket)
    status = ticket.status
    waiting = waiting_status_for(status) if status is not None else None
    policies = []
    for wf in ApprovalWorkflow.objects.filter(
            project_id=ticket.project_id, is_deleted=False, is_active=True).order_by("name"):
        stages = engine._live_stages(wf)
        problem = None if stages else "It has no stages yet."
        rows = []
        for s in stages:
            p = engine.stage_problem(s, ticket)
            if p and problem is None:
                problem = f"Stage “{s.name}” {p}."
            row = {
                "id": str(s.id), "name": s.name, "level": s.level,
                "approver_type": s.approver_type,
                "approver_label": engine._approver_label(s, ticket),
                "rule": s.rule, "min_approvals": s.min_approvals,
                "problem": p,
            }
            if s.approver_type == engine.ON_THE_FLY:
                ids = engine.pool_user_ids(s)
                row.update({
                    "on_fly_pool": s.on_fly_pool,
                    "pool_label": _pool_label(s),
                    "candidates": None if ids is None else [
                        _person(u) for u in User.objects.filter(id__in=ids)
                        .order_by("full_name", "username")[:_CANDIDATE_CAP]
                    ],
                    "approver_names": [], "approver_count": 0,
                })
            else:
                ids = engine.resolve_approver_ids(s, ticket)
                row.update({
                    "approver_names": [engine._display(u) for u in User.objects.filter(id__in=ids)
                                       .order_by("full_name", "username")[:engine._NAME_SAMPLE]],
                    "approver_count": len(ids),
                })
            rows.append(row)
        policies.append({
            "id": str(wf.id), "name": wf.name, "description": wf.description, "mode": wf.mode,
            "problem": problem, "stages": rows,
        })
    return {
        "allowed": reason is None,
        "reason": reason,
        "status": {"id": str(status.id), "name": status.name} if status is not None else None,
        "waiting_status": {"id": str(waiting.id), "name": waiting.name} if waiting else None,
        "workflows": policies,
    }


@transaction.atomic
def send_for_approval(ticket, workflow, user, *, picks=None, note=""):
    """Start ``workflow`` on ``ticket`` as a sent request. Raises TransitionError
    (400/409) or ApprovalStartError (400); nothing is written on a refusal."""
    from apps.itsm_tickets.models import Ticket
    from apps.itsm_workflows.services import engine as wf_engine

    locked = (Ticket.objects.select_for_update(of=("self",))
              .select_related("status", "status__category", "status__approval_waiting_status",
                              "status__approval_waiting_status__category", "requestor")
              .get(pk=ticket.pk))
    reason, code = blocked_reason(locked)
    if reason:
        raise TransitionError(reason, status_code=code)
    if workflow is None or workflow.is_deleted or workflow.project_id != locked.project_id:
        raise engine.ApprovalStartError("Pick one of this project's approval workflows.")
    note = (note or "").strip()
    if len(note) > _NOTE_MAX:
        raise engine.ApprovalStartError(f"Keep the message under {_NOTE_MAX} characters.")

    from_status = locked.status
    req = engine.start_approval(
        locked, workflow, user=user, picks=engine.normalise_picks(picks),
        source=engine.SENT, note=note, return_status=from_status,
    )
    waiting = waiting_status_for(from_status)
    if waiting is not None:
        wf_engine.move_for_approval(locked, waiting, user, label="Sent for approval")
        req.waiting_status = waiting
        req.save(update_fields=["waiting_status", "updated_at"])
    return req


def can_withdraw(req, user) -> bool:
    if req.status != "pending" or req.source != engine.SENT:
        return False
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False) or req.requested_by_id == user.id:
        return True
    from apps.itsm_rbac.services import check_permission
    return check_permission(user, "itsm.approvals.send", "delete")


@transaction.atomic
def withdraw(req, user, reason=""):
    """Cancel a pending sent request and return the ticket to where it was sent from."""
    from ..models import ApprovalRequest

    req = (ApprovalRequest.objects.select_for_update(of=("self",))
           .select_related("ticket", "workflow", "return_status").get(pk=req.pk))
    if req.status != "pending":
        raise TransitionError("This approval is already decided.", status_code=409)
    if req.source != engine.SENT:
        raise TransitionError(
            "Only an approval sent from the ticket can be withdrawn; the workflow started this one.",
            status_code=400,
        )
    if not can_withdraw(req, user):
        raise TransitionError(
            "Only the person who sent this approval, or a supervisor, can withdraw it.",
            status_code=403,
        )
    req.status = "cancelled"
    req.decided_at = timezone.now()
    req.current_stage = None
    req.save(update_fields=["status", "decided_at", "current_stage", "updated_at"])

    ticket = req.ticket
    rid = str(req.id)
    payload = {"workflow": req.workflow.name, "withdrawn": True, "reason": (reason or "").strip()}

    release_sla = req.pause_sla

    def _after():
        log_event(ticket, user, "approval_cancelled", payload=payload)
        hooks.emit_event("ApprovalCancelled", ticket, actor=user, context={"approval_request": rid})
        if release_sla:
            hooks.sla_sync_pauses(ticket)
    transaction.on_commit(_after)
    engine.return_from_waiting(req, user, label="Approval withdrawn")
    return req
