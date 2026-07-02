"""Workflow execution engine — the single choke-point for ticket status changes.

``transition()`` runs the ordered pipeline:
  resolve & assert → conditions → validators → apply status →
  post-functions (canonical order) → persist → post-commit side-effects.

Side-effects (audit log, SLA clock ops, notification events) run inside
``transaction.on_commit`` so a rolled-back transition never notifies anyone.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.itsm_core.services import hooks, log_event

# Canonical post-function ordering — authors can't foot-gun the order.
_PF_ORDER = {
    "auto_assign": 10, "set_assignee": 11, "clear_assignee": 12,
    "set_priority": 20,
    "set_resolution": 30, "clear_resolution": 31, "set_resolution_details": 32,
    "stamp_timestamp": 40,
    "request_approval": 45,
    "start_sla": 50, "stop_sla": 51, "pause_sla": 52, "resume_sla": 53,
    "emit_event": 90,
}
_STAMP_FIELDS = {"assigned_at", "resolved_at", "closed_at", "first_responded_at"}
# ITIL Resolution-Detail columns captured from a Resolve transition screen.
_RESOLUTION_TEXT_FIELDS = ("resolution_code", "root_cause", "resolution_notes")


def _as_bool(v):
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on")
    return bool(v)


class TransitionError(Exception):
    def __init__(self, message, status_code=400, errors=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.errors = errors or {}


# ── Conditions (read-only guards) ───────────────────────────────────────────

def _check_condition(cond, ticket, user) -> bool:
    from apps.itsm_rbac.services import get_user_role

    ctype, cfg = cond.condition_type, (cond.config or {})
    result = True
    if ctype == "role_in":
        role = get_user_role(user)
        result = bool(user and user.is_superuser) or (role is not None and role.code in cfg.get("roles", []))
    elif ctype == "is_assignee":
        result = ticket.assignee_id == getattr(user, "id", None)
    elif ctype == "group_member":
        gid = cfg.get("group_id") or ticket.assigned_group_id
        result = bool(gid) and ticket.assigned_group and ticket.assigned_group.memberships.filter(
            user=user, is_active=True
        ).exists()
    elif ctype == "field_equals":
        result = getattr(ticket, cfg.get("field", ""), None) == cfg.get("value")
    elif ctype == "approval_granted":
        # Gate passes when an approval has been granted, OR none is pending (i.e. this
        # ticket didn't need approval). itsm_approvals provides the related manager.
        reqs = ticket.approval_requests.filter(is_deleted=False)
        result = reqs.filter(status="approved").exists() or not reqs.filter(status="pending").exists()
    return (not result) if cond.negate else result


def evaluate_conditions(transition, ticket, user) -> bool:
    return all(_check_condition(c, ticket, user) for c in transition.conditions.all())


def available_transitions(ticket, user, portal_only=False):
    """Transitions valid from the ticket's current status whose conditions pass.

    ``portal_only`` narrows to transitions flagged ``portal_allowed`` — the gate for the
    end-user Service Portal. Conditions still apply on top (a portal-allowed transition with
    an agent-only condition like ``is_assignee`` is correctly hidden from a requestor)."""
    from apps.itsm_workflows.models import Transition

    qs = Transition.objects.filter(workflow_id=ticket.workflow_id).filter(
        models_q(ticket)
    ).select_related("to_status", "from_status").prefetch_related("conditions")
    if portal_only:
        qs = qs.filter(portal_allowed=True)
    return [t for t in qs if evaluate_conditions(t, ticket, user)]


def models_q(ticket):
    from django.db.models import Q
    return Q(from_status_id=ticket.status_id) | Q(is_global=True)


# ── Validators (mandatory transition-screen fields) ─────────────────────────

def _validate(transition, ticket, fields, comment) -> dict:
    errors = {}
    if transition.screen_id:
        provided = fields or {}
        for sf in transition.screen.fields.filter(is_mandatory=True):
            val = provided.get(sf.field_key)
            if val in (None, "", []):
                errors[sf.field_key] = ["This field is required for this transition."]
    # A transition configured to demand a note rejects a blank one (defense-in-depth —
    # the UI slide-over also blocks submit, but a forged request must not skip it).
    if transition.note_prompt and transition.note_required and not (comment or "").strip():
        errors["comment"] = [f"{transition.note_heading or 'A note'} is required for this transition."]
    return errors


# ── Post-functions (mutate ticket in memory) ────────────────────────────────

def _apply_post_function(pf, ticket, user, fields):
    from apps.itsm_groups.services import resolve_assignee

    ptype, cfg = pf.get("type"), pf.get("config", {})
    if ptype == "auto_assign":
        group = ticket.assigned_group
        strategy = cfg.get("strategy", "round_robin")
        uid = resolve_assignee(strategy, group, cfg.get("user_id"))
        if uid:
            ticket.assignee_id = uid
    elif ptype == "set_assignee":
        ticket.assignee_id = cfg.get("user_id")
    elif ptype == "clear_assignee":
        ticket.assignee_id = None
    elif ptype == "set_priority":
        ticket.priority = cfg.get("priority", ticket.priority)
    elif ptype == "set_resolution":
        ticket.resolution = (fields or {}).get("resolution") or cfg.get("resolution") or ticket.resolution
    elif ptype == "set_resolution_details":
        # Capture the ITIL resolution fields from the transition screen `fields`.
        # Only keys actually provided are written, so a partial screen never blanks
        # a field the agent didn't touch.
        data = fields or {}
        for key in _RESOLUTION_TEXT_FIELDS:
            if key in data:
                setattr(ticket, key, data.get(key) or "")
        if "workaround_provided" in data:
            wp = data.get("workaround_provided")
            ticket.workaround_provided = None if wp in (None, "") else _as_bool(wp)
    elif ptype == "clear_resolution":
        ticket.resolution = ""
        ticket.resolution_code = ""
        ticket.root_cause = ""
        ticket.resolution_notes = ""
        ticket.workaround_provided = None
    elif ptype == "stamp_timestamp":
        field = cfg.get("field")
        if field in _STAMP_FIELDS:
            setattr(ticket, field, timezone.now())
    # SLA ops are deferred to post-commit hooks (see transition()).


def _ordered(post_functions):
    return sorted(post_functions or [], key=lambda pf: _PF_ORDER.get(pf.get("type"), 99))


# ── The choke-point ─────────────────────────────────────────────────────────

@transaction.atomic
def transition(ticket, transition, user, fields=None, comment=None):
    """Move `ticket` through `transition`. Raises TransitionError on guard/validation
    failure. Returns a result dict."""
    from apps.itsm_tickets.models import Ticket

    locked = Ticket.objects.select_for_update().get(pk=ticket.pk)

    # 1) resolve & assert
    if not transition.is_global and transition.from_status_id not in (None, locked.status_id):
        raise TransitionError("Ticket has already moved; refresh and retry.", status_code=409)

    # 2) conditions
    if not evaluate_conditions(transition, locked, user):
        raise TransitionError("You are not allowed to perform this transition.", status_code=403)

    # 3) validators
    errors = _validate(transition, locked, fields, comment)
    if errors:
        raise TransitionError("Mandatory fields missing.", status_code=422, errors=errors)

    from_status = locked.status
    to_status = transition.to_status
    from_done = from_status.category.key == "done" if from_status_id_present(locked) else False
    to_done = to_status.category.key == "done"

    # 4) apply status
    locked.status = to_status

    # detect reopen
    is_reopen = from_done and not to_done
    if is_reopen:
        locked.reopen_count = (locked.reopen_count or 0) + 1

    # 5) post-functions (canonical order)
    sla_ops = []
    for pf in _ordered(transition.post_functions):
        ptype = pf.get("type")
        if ptype in ("start_sla", "stop_sla", "pause_sla", "resume_sla", "emit_event",
                     "request_approval"):
            sla_ops.append(pf)
            continue
        _apply_post_function(pf, locked, user, fields)

    # 6) persist
    update_fields = ["status", "assignee", "priority", "resolution",
                     "resolution_code", "root_cause", "resolution_notes", "workaround_provided",
                     "reopen_count",
                     "assigned_at", "resolved_at", "closed_at", "first_responded_at", "updated_at"]
    locked.save(update_fields=[f for f in update_fields if hasattr(locked, f)])

    # 7) post-commit side-effects
    def _after_commit():
        log_event(locked, user, "status_changed",
                  payload={"from": from_status.name, "to": to_status.name,
                           "transition": transition.name})
        if to_done and to_status.key in ("closed",):
            log_event(locked, user, "closed", payload={"status": to_status.name})
        if is_reopen:
            log_event(locked, user, "reopened", payload={"to": to_status.name})
        hooks.sla_on_status_change(locked, from_status, to_status)
        for pf in sla_ops:
            cfg = pf.get("config", {})
            metric = cfg.get("metric", "resolution")
            if pf["type"] == "pause_sla":
                hooks.sla_pause(locked, metric)
            elif pf["type"] == "resume_sla":
                hooks.sla_resume(locked, metric)
            elif pf["type"] == "stop_sla":
                hooks.sla_stop(locked, metric)
            elif pf["type"] == "start_sla":
                hooks.sla_start_for_ticket(locked)
            elif pf["type"] == "emit_event":
                hooks.emit_event(cfg.get("event_type", "StatusChanged"), locked, actor=user)
            elif pf["type"] == "request_approval":
                from apps.itsm_approvals.models import ApprovalWorkflow
                awf = ApprovalWorkflow.objects.filter(
                    pk=cfg.get("workflow_id"), is_deleted=False
                ).first()
                if awf:
                    hooks.start_approval(locked, awf, user=user)
        hooks.emit_event("StatusChanged", locked, actor=user,
                         context={"from": from_status.name, "to": to_status.name})

    transaction.on_commit(_after_commit)
    return {"ticket": locked, "from_status": from_status, "to_status": to_status}


def from_status_id_present(ticket) -> bool:
    return ticket.status_id is not None and ticket.status.category_id is not None
