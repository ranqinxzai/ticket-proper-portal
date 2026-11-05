"""Approval engine — start a request, resolve approvers, record decisions, advance.

All status changes on the ticket still go through the workflow engine (the
``approval_granted`` condition gates the relevant transition); this module only
manages the ApprovalRequest/Action lifecycle and emits notifications.

Rules (2026-10-18 bug-fix batch):
- **No silent freeze (B1).** ``start_approval`` validates every stage up front and
  raises ``ApprovalStartError`` (a 400 ``TransitionError``) when any stage has nobody
  who could decide it. Called inside the caller's transaction (``hooks.begin_approval``
  from a transition, ``raise_from_catalog``), so the refusal rolls the whole write back.
- **Level advance after a data change** (sequential): if the next stage has become
  unresolvable since the start, the approve is refused atomically (nothing recorded,
  the request stays at its level) and ``request_state`` reports a ``blocked_reason``
  so every viewer sees why. Rejecting is always allowed. Never auto-skipped (that would
  bypass the policy) and never auto-rejected.
- **Parallel mode (B3).** Every stage snapshotted at start (``ApprovalRequest.stage_ids``)
  is pending at once; the request is approved once every stage's rule is met and
  rejected by any rejection. One decision by a user eligible for several pending
  stages counts for all of them.
- **Inactive / deleted policies start nothing** when a transition points at them
  (``start_for_transition`` returns None and the transition proceeds).
- **Superuser override.** A superuser may always decide; their approval completes the
  stage. The UI only offers it when no eligible approver is left (``can_decide``).
- **On fly (2026-10-24).** An ``on_the_fly`` stage's approvers are picked by the agent
  who sends the ticket (``services/send.py``) and stored per request
  (``ApprovalRequestApprover``), so resolving them needs the request (``req=``). Such a
  policy can't start from a transition or catalog item (no picks → ApprovalStartError).
- **Sent requests** (``source="sent"``) return the ticket from its waiting status to
  ``return_status`` when decided or withdrawn, and never auto-move to Rejected.
"""

from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from apps.itsm_core.services import hooks
from apps.itsm_workflows.services.engine import TransitionError

logger = logging.getLogger("itsm")

SEQUENTIAL = "sequential"
PARALLEL = "parallel"
ON_THE_FLY = "on_the_fly"
SENT = "sent"
_NAME_SAMPLE = 5  # approver names returned per pending stage


class ApprovalStartError(TransitionError):
    """An approval can't start (or advance) because a stage has nobody who could
    decide it. Always a 400 with a human message naming the stage and the reason."""

    def __init__(self, message, problems=None):
        super().__init__(message, status_code=400, errors={"approval": list(problems or [message])})


# ── Approver resolution ─────────────────────────────────────────────────────

def _display(user) -> str:
    if user is None:
        return "someone"
    return (getattr(user, "full_name", "") or "").strip() or user.username


def _live_active(obj) -> bool:
    return obj is not None and not getattr(obj, "is_deleted", False) and getattr(obj, "is_active", True)


def resolve_approver_ids(stage, ticket, req=None) -> set:
    """Ids of ACTIVE users who may act on `stage` for `ticket` (superusers excluded —
    they can always override, but never count as "an approver exists"). An On-fly
    stage resolves to the people picked on `req` (none without a request)."""
    User = get_user_model()
    t = stage.approver_type
    if t == ON_THE_FLY:
        if req is None:
            return set()
        from ..models import ApprovalRequestApprover
        return set(
            ApprovalRequestApprover.objects.filter(
                approval_request=req, stage=stage, is_deleted=False, user__is_active=True
            ).values_list("user_id", flat=True)
        )
    if t == "specific_user":
        u = stage.approver_user
        return {u.id} if u is not None and u.is_active else set()
    if t == "role":
        if not _live_active(stage.approver_role):
            return set()
        from apps.itsm_rbac.models import RoleAssignment
        return set(
            RoleAssignment.objects.filter(
                role_id=stage.approver_role_id, is_deleted=False, user__is_active=True
            ).values_list("user_id", flat=True)
        )
    if t == "group":
        if not _live_active(stage.approver_group):
            return set()
        from apps.itsm_groups.models import GroupMembership
        return set(
            GroupMembership.objects.filter(
                group_id=stage.approver_group_id, is_active=True, is_deleted=False,
                user__is_active=True,
            ).values_list("user_id", flat=True)
        )
    if t == "requestor_manager":
        requestor = getattr(ticket, "requestor", None) if ticket is not None else None
        mgr_id = getattr(requestor, "manager_id", None)
        if mgr_id and User.objects.filter(pk=mgr_id, is_active=True).exists():
            return {mgr_id}
        # No usable manager → the stage's optional fallback approver.
        u = stage.approver_user
        return {u.id} if u is not None and u.is_active else set()
    return set()


def pool_user_ids(stage):
    """Ids of the active people an agent may pick for an On-fly stage, or None when
    the pool is "any user" (every active person in the org)."""
    from apps.accounts.system_users import system_usernames

    pool = stage.on_fly_pool
    if pool == "any_user":
        return None
    if pool == "group":
        if not _live_active(stage.approver_group):
            return set()
        from apps.itsm_groups.models import GroupMembership
        return set(
            GroupMembership.objects.filter(
                group_id=stage.approver_group_id, is_active=True, is_deleted=False,
                user__is_active=True,
            ).exclude(user__username__in=system_usernames()).values_list("user_id", flat=True)
        )
    if pool == "listed_users":
        return set(stage.candidate_users.filter(is_active=True)
                   .exclude(username__in=system_usernames()).values_list("id", flat=True))
    return set()


def _on_fly_pool_problem(stage) -> str | None:
    pool = stage.on_fly_pool
    if pool == "any_user":
        return None
    if pool == "group":
        group = stage.approver_group
        if group is None:
            return "no group to pick from is chosen"
        if not _live_active(group):
            return f"the group “{group.name}” is inactive"
        if not pool_user_ids(stage):
            return f"the group “{group.name}” has no active members"
        return None
    if pool == "listed_users":
        if not pool_user_ids(stage):
            return "none of the people listed to pick from is active"
        return None
    return "no list to pick from is chosen"


def stage_problem(stage, ticket=None, req=None) -> str | None:
    """Why `stage` can't be decided, as a predicate ("has no approver — …"), or None.

    ``ticket=None`` checks the configuration only (used by the editor); the
    requestor-dependent "Requestor's manager" check needs the ticket. An On-fly stage
    checks its pool, plus the people picked when ``req`` is given."""
    t = stage.approver_type
    reason = None
    if t == "specific_user":
        u = stage.approver_user
        if u is None:
            reason = "no approver is chosen"
        elif not u.is_active:
            reason = f"{_display(u)}'s account is deactivated"
    elif t == "role":
        role = stage.approver_role
        if role is None:
            reason = "no role is chosen"
        elif not _live_active(role):
            reason = f"the role “{role.name}” is inactive"
        elif not resolve_approver_ids(stage, ticket):
            reason = f"nobody active has the role “{role.name}”"
    elif t == "group":
        group = stage.approver_group
        if group is None:
            reason = "no group is chosen"
        elif not _live_active(group):
            reason = f"the group “{group.name}” is inactive"
        elif not resolve_approver_ids(stage, ticket):
            reason = f"the group “{group.name}” has no active members"
    elif t == "requestor_manager":
        fallback = stage.approver_user
        if ticket is None:
            if fallback is not None and not fallback.is_active:
                reason = f"the fallback approver {_display(fallback)} is deactivated"
        elif not resolve_approver_ids(stage, ticket):
            requestor = getattr(ticket, "requestor", None)
            if requestor is None:
                reason = "the ticket has no requestor"
            elif not requestor.manager_id:
                reason = "the requestor has no manager set"
            else:
                reason = f"the requestor's manager ({_display(requestor.manager)}) is deactivated"
    elif t == ON_THE_FLY:
        reason = _on_fly_pool_problem(stage) if req is None else None
        if req is not None and not resolve_approver_ids(stage, ticket, req):
            reason = "the people picked for it are deactivated"
    else:
        reason = "its approver type is unknown"
    if reason:
        return f"has no approver — {reason}"
    # On fly without a request: the count is checked against the picks at start.
    if stage.rule == "any" and ticket is not None and (t != ON_THE_FLY or req is not None):
        n = len(resolve_approver_ids(stage, ticket, req))
        need = max(1, stage.min_approvals or 1)
        if n < need:
            return (f"can't be completed — it needs {need} approvals but only "
                    f"{n} {'person' if n == 1 else 'people'} can approve")
    return None


def _live_stages(workflow):
    return list(workflow.stages.select_related("approver_user", "approver_role",
                                               "approver_group").order_by("level"))


def _picks_problem(stage, ids) -> str | None:
    """Why the people picked for an On-fly stage can't be used, or None. ``ids=None``
    means nobody could pick (a transition / catalog start)."""
    if ids is None:
        return ("picks its approvers on the fly, so this approval can only be started "
                "with Send for approval")
    if not ids:
        return "needs at least one approver picked"
    User = get_user_model()
    from apps.accounts.system_users import system_usernames

    users = list(User.objects.filter(id__in=ids))
    if len(users) != len(ids):
        return "has someone picked who doesn't exist"
    off = [_display(u) for u in users if not u.is_active or u.username in system_usernames()]
    if off:
        return f"has someone picked who can't approve ({', '.join(off)})"
    pool = pool_user_ids(stage)
    if pool is not None:
        outside = [_display(u) for u in users if u.id not in pool]
        if outside:
            return f"has someone picked who isn't on its list ({', '.join(outside)})"
    need = max(1, stage.min_approvals or 1) if stage.rule == "any" else 1
    if len(ids) < need:
        return f"needs at least {need} approvers picked"
    return None


def normalise_picks(raw) -> dict:
    """``{stage_id: [user_id, …]}`` from a request body → ``{str: [int, …]}`` (deduped,
    order kept). Raises ApprovalStartError on a malformed body."""
    if raw in (None, ""):
        return {}
    if not isinstance(raw, dict):
        raise ApprovalStartError("Approvers must be a map of stage → people.")
    out = {}
    for sid, ids in raw.items():
        if not isinstance(ids, (list, tuple)):
            raise ApprovalStartError("Approvers must be a map of stage → people.")
        try:
            out[str(sid)] = list(dict.fromkeys(int(i) for i in ids))
        except (TypeError, ValueError):
            raise ApprovalStartError("Approvers must be a map of stage → people.") from None
    return out


def ensure_startable(ticket, workflow, picks=None):
    """Raise ApprovalStartError unless every stage of `workflow` has someone who
    could decide it for `ticket`. ``picks`` = ``{stage_id: [user_id]}`` for On-fly
    stages (None = nobody picked: a transition / catalog start)."""
    if workflow is None or workflow.is_deleted:
        raise ApprovalStartError("Approval can't start: the approval workflow no longer exists.")
    if not workflow.is_active:
        raise ApprovalStartError(f"Approval can't start: the approval workflow “{workflow.name}” is inactive.")
    stages = _live_stages(workflow)
    if not stages:
        raise ApprovalStartError(
            f"Approval can't start: the approval workflow “{workflow.name}” has no stages."
        )
    problems = []
    for s in stages:
        p = stage_problem(s, ticket)
        if p is None and s.approver_type == ON_THE_FLY:
            p = _picks_problem(s, None if picks is None else picks.get(str(s.id), []))
        if p:
            problems.append(f"stage “{s.name}” {p}")
    if problems:
        raise ApprovalStartError("Approval can't start: " + "; ".join(problems) + ".", problems)


def has_on_fly_stage(workflow) -> bool:
    """True when the approval workflow (or its id) has a live On-fly stage."""
    from ..models import ApprovalStage

    wid = getattr(workflow, "pk", workflow)
    return bool(wid) and ApprovalStage.objects.filter(workflow_id=wid, approver_type=ON_THE_FLY).exists()


def policy_start_sites(workflow) -> list:
    """Where `workflow` is started automatically: live transitions whose
    ``request_approval`` names it, and catalog items that need it. An On-fly stage
    can't be added while any exist (nobody could pick its approvers there)."""
    from apps.itsm_workflows.models import Transition

    wid = str(getattr(workflow, "pk", workflow))
    sites = [f"the transition “{t.name}”" for t in Transition.objects.filter(
        post_functions__contains=[{"type": "request_approval", "config": {"workflow_id": wid}}])[:3]]
    try:
        from apps.itsm_catalog.models import CatalogItem
    except ImportError:  # pragma: no cover
        return sites
    sites += [f"the catalog item “{c.name}”" for c in CatalogItem.objects.filter(
        approval_workflow_id=wid, requires_approval=True)[:3]]
    return sites


# ── Audit (AuditEvent actions added by itsm_core/0015) ─────────────────────

def _audit(ticket, actor, action, payload):
    """approval_requested / approval_approved / approval_rejected on the ticket's
    Activity feed (rule 5: explicit log_event, called post-commit)."""
    from apps.itsm_core.services import log_event

    log_event(ticket, actor, action, payload=payload)


# ── Start ───────────────────────────────────────────────────────────────────

@transaction.atomic
def start_approval(ticket, workflow, *, user=None, picks=None, source="policy", note="",
                   return_status=None):
    """Create a pending ApprovalRequest for `ticket` under `workflow`. Idempotent:
    if an active pending request already exists, returns it. Raises
    ApprovalStartError (400) when any stage has nobody who could decide it.

    ``picks`` / ``source="sent"`` / ``note`` / ``return_status`` come from Send for
    approval (``services/send.py``); a policy start passes none of them."""
    from ..models import ApprovalRequest, ApprovalRequestApprover

    existing = ApprovalRequest.objects.filter(
        ticket=ticket, status="pending", is_deleted=False
    ).first()
    if existing:
        return existing

    ensure_startable(ticket, workflow, picks)
    stages = _live_stages(workflow)
    parallel = workflow.mode == PARALLEL
    note = (note or "").strip()
    req = ApprovalRequest.objects.create(
        ticket=ticket, workflow=workflow,
        current_stage=None if parallel else stages[0],
        status="pending", requested_by=user,
        mode=PARALLEL if parallel else SEQUENTIAL,
        stage_ids=[str(s.id) for s in stages] if parallel else [],
        source=source, note=note, return_status=return_status,
        pause_sla=bool(workflow.pause_sla),
    )
    picked_ids = set()
    for s in stages:
        if s.approver_type != ON_THE_FLY:
            continue
        for uid in (picks or {}).get(str(s.id), []):
            ApprovalRequestApprover.objects.create(approval_request=req, stage=s, user_id=uid)
            picked_ids.add(uid)
    picked_names = [_display(u) for u in get_user_model().objects.filter(id__in=picked_ids)
                    .order_by("full_name", "username")] if picked_ids else []
    pending = stages if parallel else stages[:1]
    rid = str(req.id)
    stage_ids = [str(s.id) for s in pending]
    payload = {"workflow": workflow.name, "stages": [s.name for s in pending]}
    if source == SENT:
        payload["sent"] = True
        if picked_names:
            payload["approvers"] = picked_names
        if note:
            payload["note"] = note

    pause_sla = req.pause_sla

    def _after():
        _audit(ticket, user, "approval_requested", payload)
        for sid in stage_ids:
            hooks.emit_event("ApprovalRequested", ticket, actor=user,
                             context={"approval_request": rid, "stage": sid})
        if pause_sla:  # "Pause SLA while waiting" on the policy (2026-11-05c)
            hooks.sla_sync_pauses(ticket)
    transaction.on_commit(_after)
    return req


def start_for_transition(ticket, workflow, *, user=None):
    """Start the approval a transition's ``request_approval`` post-function names
    (``workflow`` = an ApprovalWorkflow or its id). A missing, deleted or inactive
    policy starts nothing (returns None) — an inactive workflow is switched off, so
    the transition proceeds without sign-off."""
    from ..models import ApprovalWorkflow

    workflow_id = getattr(workflow, "pk", workflow)
    if not workflow_id:
        return None
    wf = ApprovalWorkflow.objects.filter(pk=workflow_id, is_deleted=False).first()
    if wf is None or not wf.is_active:
        return None
    return start_approval(ticket, wf, user=user)


# ── Request state ───────────────────────────────────────────────────────────

def request_stages(req):
    """The stages a request runs over: the start-time snapshot (parallel; includes
    stages soft-deleted since, so an in-flight request never loses its stages) or the
    workflow's live stages (sequential)."""
    from ..models import ApprovalStage

    if req.mode == PARALLEL:
        return list(
            ApprovalStage.all_objects.filter(id__in=req.stage_ids or [])
            .select_related("approver_user", "approver_role", "approver_group")
            .order_by("level")
        )
    return _live_stages(req.workflow)


def _actions(req, stage, decision=None):
    from ..models import ApprovalAction

    qs = ApprovalAction.objects.filter(approval_request=req, stage=stage, is_deleted=False)
    if decision:
        qs = qs.filter(decision=decision)
    return qs


def _acted_ids(req, stage) -> set:
    return set(a for a in _actions(req, stage).values_list("approver_id", flat=True) if a)


def _stage_satisfied(req, stage) -> bool:
    """True once `stage` has enough approvals per its rule (a superuser approval
    always completes it — the override escape hatch)."""
    approved = _actions(req, stage, "approved")
    if approved.filter(approver__is_superuser=True).exists():
        return True
    approvers = set(a for a in approved.values_list("approver_id", flat=True) if a is not None)
    if stage.rule == "all":
        required = resolve_approver_ids(stage, req.ticket, req)
        return bool(required) and required.issubset(approvers)
    return len(approvers) >= max(1, stage.min_approvals or 1)


def pending_stages(req) -> list:
    """Stages currently awaiting a decision on `req` (empty unless pending)."""
    if req.status != "pending":
        return []
    if req.mode == PARALLEL:
        return [s for s in request_stages(req) if not _stage_satisfied(req, s)]
    return [req.current_stage] if req.current_stage_id else []


def eligible_stages(req, user) -> list:
    """Pending stages `user` is an approver of and hasn't acted on yet."""
    if not user or not getattr(user, "is_authenticated", False):
        return []
    return [s for s in pending_stages(req)
            if user.id in resolve_approver_ids(s, req.ticket, req) and user.id not in _acted_ids(req, s)]


def _waiting_ids(req, stage) -> set:
    return resolve_approver_ids(stage, req.ticket, req) - _acted_ids(req, stage)


def _next_stage(req, stage):
    return (req.workflow.stages.select_related("approver_user", "approver_role", "approver_group")
            .filter(level__gt=stage.level).order_by("level").first())


def blocked_reason(req) -> str | None:
    """Why a pending request can't complete right now, or None."""
    stages = pending_stages(req)
    if req.status != "pending":
        return None
    if not stages:
        return "This approval has no pending stage, so nobody can decide it. A superuser can decide it."
    for s in stages:
        if not _waiting_ids(req, s) and not _stage_satisfied(req, s):
            p = stage_problem(s, req.ticket, req) or "has nobody left who can decide it"
            return f"Stage “{s.name}” {p}. Fix the stage or the person's account; a superuser can also decide it."
    if req.mode == SEQUENTIAL:
        nxt = _next_stage(req, stages[0])
        while nxt is not None:
            p = stage_problem(nxt, req.ticket, req)
            if p:
                return (f"The next stage “{nxt.name}” {p}. Approving this level will be refused "
                        "until an administrator fixes it.")
            nxt = _next_stage(req, nxt)
    return None


def _approver_label(stage, ticket) -> str:
    t = stage.approver_type
    if t == "specific_user":
        return _display(stage.approver_user) if stage.approver_user else "nobody (no approver set)"
    if t == "role":
        return f"anyone with the role “{stage.approver_role.name}”" if stage.approver_role else "a role (not set)"
    if t == "group":
        return f"anyone in “{stage.approver_group.name}”" if stage.approver_group else "a group (not set)"
    if t == "requestor_manager":
        return "the requestor's manager"
    if t == ON_THE_FLY:
        return "the people picked when it was sent"
    return t


def request_state(req, user) -> dict:
    """Viewer-specific state for the API: pending stages with who they wait for,
    `can_decide` and `blocked_reason`."""
    User = get_user_model()
    stages_out = []
    stuck = False
    pend = pending_stages(req)
    for s in pend:
        waiting = _waiting_ids(req, s)
        if not waiting:
            stuck = True
        names = [_display(u) for u in User.objects.filter(id__in=waiting).order_by("full_name", "username")[:_NAME_SAMPLE]]
        stages_out.append({
            "id": str(s.id), "name": s.name, "level": s.level,
            "approver_type": s.approver_type,
            "approver_label": _approver_label(s, req.ticket),
            "approver_names": names, "approver_count": len(waiting),
        })
    if req.status == "pending" and not pend:
        stuck = True
    can = bool(eligible_stages(req, user))
    if not can and req.status == "pending" and stuck and getattr(user, "is_superuser", False):
        can = True  # only a superuser can unblock it
    return {
        "pending_stages": stages_out,
        "can_decide": can,
        "blocked_reason": blocked_reason(req) if req.status == "pending" else None,
    }


# ── Decide ──────────────────────────────────────────────────────────────────

@transaction.atomic
def decide(req, approver, decision: str, comment: str = ""):
    """Record an approve/reject by `approver` on the request's pending stage(s).

    Sequential: acts on the current stage; once its rule is met the next stage
    becomes pending (refused with ApprovalStartError if it has nobody who could
    decide it) or the request is approved. Parallel: acts on every pending stage the
    approver is eligible for; approved once every stage's rule is met. Any rejection
    rejects the whole request."""
    from ..models import ApprovalAction, ApprovalRequest

    if decision not in ("approved", "rejected"):
        raise TransitionError("Unknown decision.", status_code=400)
    req = (ApprovalRequest.objects.select_for_update(of=("self",))
           .select_related("workflow", "ticket", "current_stage").get(pk=req.pk))
    if req.status != "pending":
        raise TransitionError("This approval is already decided.", status_code=409)

    stages = pending_stages(req)
    acting = eligible_stages(req, approver)
    if not acting:
        if getattr(approver, "is_superuser", False):
            acting = stages  # override: sequential has one pending stage, parallel all
        elif any(approver.id in resolve_approver_ids(s, req.ticket, req) for s in stages):
            raise TransitionError(
                "You have already decided this stage; it's waiting for the other approvers.",
                status_code=409,
            )
        else:
            raise TransitionError("You are not an approver for this stage.", status_code=403)

    comment = (comment or "").strip()
    for s in acting or [None]:
        ApprovalAction.objects.create(
            approval_request=req, stage=s, approver=approver, decision=decision, comment=comment,
        )

    events = []  # (event, extra context)
    audit = None
    ticket = req.ticket
    stage_names = [s.name for s in acting if s is not None]
    if decision == "rejected":
        req.status = "rejected"
        req.decided_at = timezone.now()
        req.save(update_fields=["status", "decided_at", "updated_at"])
        events.append(("ApprovalRejected", {}))
        audit = ("approval_rejected", {"workflow": req.workflow.name, "stages": stage_names,
                                       "comment": comment})
    elif req.mode == PARALLEL:
        if not acting or all(_stage_satisfied(req, s) for s in request_stages(req)):
            _finish_approved(req)
            events.append(("ApprovalGranted", {}))
        audit = ("approval_approved", {"workflow": req.workflow.name, "stages": stage_names,
                                       "comment": comment})
    else:
        stage = acting[0] if acting else None
        if stage is None or _stage_satisfied(req, stage):
            nxt = _next_stage(req, stage) if stage is not None else None
            if nxt is not None:
                problem = stage_problem(nxt, ticket, req)
                if problem:
                    raise ApprovalStartError(
                        f"Your approval can't be recorded: the next stage “{nxt.name}” {problem}. "
                        "Ask an administrator to fix it, then approve again."
                    )
                req.current_stage = nxt
                req.save(update_fields=["current_stage", "updated_at"])
                events.append(("ApprovalRequested", {"stage": str(nxt.id)}))
            else:
                _finish_approved(req)
                events.append(("ApprovalGranted", {}))
        audit = ("approval_approved", {"workflow": req.workflow.name, "stages": stage_names,
                                       "comment": comment})

    rid = str(req.id)
    rejected = decision == "rejected"
    sent = req.source == SENT

    release_sla = req.pause_sla and req.status != "pending"

    def _after():
        if audit:
            _audit(ticket, approver, audit[0], audit[1])
        for event, extra in events:
            hooks.emit_event(event, ticket, actor=approver,
                             context={"approval_request": rid, **extra})
        if rejected and not sent:  # a sent request returns instead (below)
            move_to_rejected(ticket, reason=comment)
        if release_sla:  # decided → the approval stops holding the clocks
            hooks.sla_sync_pauses(ticket)
    transaction.on_commit(_after)
    # Registered after `_after`, so the feed reads "approved" then "status changed".
    if sent and req.status in ("approved", "rejected"):
        return_from_waiting(req, approver,
                            label="Approval approved" if req.status == "approved" else "Approval rejected")
    return req


def _finish_approved(req):
    req.status = "approved"
    req.decided_at = timezone.now()
    req.current_stage = None
    req.save(update_fields=["status", "decided_at", "current_stage", "updated_at"])


def return_from_waiting(req, actor, *, label):
    """A sent request is over: move its ticket from the waiting status back to the
    status it was sent from. Only when the ticket still sits in the waiting status
    (a project move re-homes it) and the return status is still usable; anything
    else is logged, never raised — the decision itself must stand."""
    from apps.itsm_tickets.models import Ticket
    from apps.itsm_workflows.services import engine as wf_engine

    if req.source != SENT or not req.waiting_status_id or not req.return_status_id:
        return None
    current = Ticket.objects.filter(pk=req.ticket_id).values_list("status_id", flat=True).first()
    if current != req.waiting_status_id:
        return None
    back = req.return_status
    if back is None or back.is_deleted:
        logger.warning("approval %s: return status is gone; ticket %s stays in the waiting status",
                       req.pk, req.ticket_id)
        return None
    try:
        return wf_engine.move_for_approval(req.ticket, back, actor, label=label)
    except TransitionError as exc:
        logger.warning("approval %s: return to %s refused: %s", req.pk, back.pk, exc.message)
    return None


def _system_actor(fallback=None):
    try:
        from apps.itsm_automation.services.system_user import get_automation_bot
        return get_automation_bot()
    except (ImportError, ModuleNotFoundError):
        return fallback


def move_to_rejected(ticket, *, reason=""):
    """After a rejection commits: run the ticket's workflow transition into the status
    keyed ``rejected`` (from the current status, or global) as the system actor. No
    such transition → the ticket stays put (the rejection is still notified). Any
    refusal (condition, mandatory screen field…) is logged, never raised."""
    from apps.itsm_tickets.models import Ticket
    from apps.itsm_workflows.models import Transition
    from apps.itsm_workflows.services import engine as wf_engine

    try:
        t = Ticket.objects.select_related("status").get(pk=ticket.pk)
        if t.status and t.status.key == "rejected":
            return None
        tr = (Transition.objects.filter(workflow_id=t.workflow_id, to_status__key="rejected")
              .filter(Q(from_status_id=t.status_id) | Q(is_global=True))
              .select_related("to_status", "from_status")
              # A transition from the current status wins over a global one.
              .order_by(F("from_status_id").desc(nulls_last=True)).first())
        if tr is None:
            return None
        return wf_engine.transition(t, tr, _system_actor(), comment=reason or "Approval rejected.")
    except TransitionError as exc:
        logger.warning("approval rejected: auto-move of %s to Rejected refused: %s",
                       getattr(ticket, "ticket_number", ticket.pk), exc.message)
    except Exception:  # noqa: BLE001 — the rejection itself is already committed
        logger.exception("approval rejected: auto-move to Rejected failed")
    return None


@transaction.atomic
def cancel_pending(ticket, *, user=None):
    """Cancel every still-pending ApprovalRequest on `ticket` (terminal state).

    Used when a ticket is moved to another project: the pending sign-off belongs
    to the *source* project's ApprovalWorkflow and its approvers, so carrying it
    across would freeze the ticket in the new project (``has_pending_approval``
    blocks all transitions). Returns the number cancelled. Emits a notification per
    cancelled request post-commit. The caller is responsible for the ticket-level
    audit entry."""
    from ..models import ApprovalRequest

    reqs = list(
        ApprovalRequest.objects.select_for_update().filter(
            ticket=ticket, status="pending", is_deleted=False
        )
    )
    for req in reqs:
        req.status = "cancelled"
        req.decided_at = timezone.now()
        req.current_stage = None
        req.save(update_fields=["status", "decided_at", "current_stage", "updated_at"])

    if reqs:
        ids = [str(r.id) for r in reqs]
        release_sla = any(r.pause_sla for r in reqs)

        def _notify():
            for rid in ids:
                hooks.emit_event("ApprovalCancelled", ticket, actor=user,
                                 context={"approval_request": rid})
            if release_sla:  # e.g. a project move: the clocks run again
                hooks.sla_sync_pauses(ticket)
        transaction.on_commit(_notify)
    return len(reqs)


# ── Queries ─────────────────────────────────────────────────────────────────

def pending_for(user):
    """Pending ApprovalRequests where `user` can decide a pending stage now (approver
    of it and hasn't acted on it). A cheap superset query, then the exact check."""
    from ..models import ApprovalRequest

    if not user or not getattr(user, "is_authenticated", False):
        return ApprovalRequest.objects.none()

    p = "workflow__stages__"
    q = (
        Q(**{f"{p}approver_type": "specific_user", f"{p}approver_user": user})
        | Q(**{f"{p}approver_type": "requestor_manager"}) & (
            Q(ticket__requestor__manager=user) | Q(**{f"{p}approver_user": user}))
        | Q(**{f"{p}approver_type": "group",
               f"{p}approver_group__memberships__user": user,
               f"{p}approver_group__memberships__is_active": True})
        | Q(**{f"{p}approver_type": ON_THE_FLY,
               "picked_approvers__user": user, "picked_approvers__is_deleted": False})
    )
    assignment = getattr(user, "itsm_role_assignment", None)
    if assignment is not None and getattr(assignment, "role_id", None):
        q |= Q(**{f"{p}approver_type": "role", f"{p}approver_role_id": assignment.role_id})

    # A deleted ticket's request leaves the inbox and badge (BUG_LOG 2026-10-29).
    candidates = (ApprovalRequest.objects.filter(status="pending", is_deleted=False,
                                                 ticket__is_deleted=False)
                  .filter(q).select_related("ticket", "workflow", "current_stage").distinct())
    ids = [r.id for r in candidates if eligible_stages(r, user)]
    return (ApprovalRequest.objects.filter(id__in=ids)
            .select_related("ticket", "ticket__project", "ticket__project__helpdesk",
                            "workflow", "current_stage")
            .order_by("-created_at"))


def pending_approver_users(ticket, stage=None) -> list:
    """Users who can decide right now on `ticket`'s pending approval (approvers of a
    pending stage who haven't acted on it). ``stage`` (id or ApprovalStage) narrows to
    that stage — used for the per-stage ``ApprovalRequested`` recipients. Superusers
    are not included unless they are genuine approvers."""
    from ..models import ApprovalRequest

    User = get_user_model()
    req = (ApprovalRequest.objects.filter(ticket=ticket, status="pending", is_deleted=False)
           .select_related("workflow", "ticket", "current_stage").order_by("-created_at").first())
    if req is None:
        return []
    sid = str(getattr(stage, "id", stage)) if stage else None
    ids = set()
    for s in pending_stages(req):
        if sid and str(s.id) != sid:
            continue
        ids |= _waiting_ids(req, s)
    return list(User.objects.filter(id__in=ids, is_active=True).order_by("id"))
