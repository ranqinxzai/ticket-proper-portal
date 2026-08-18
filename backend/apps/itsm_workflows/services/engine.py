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


def has_pending_approval(ticket) -> bool:
    """True while any approval sign-off on the ticket is still awaiting a decision.

    A pending approval freezes the ticket's status: no workflow transition may run until
    the approval is approved or rejected (enforced centrally here + in ``transition()``),
    so a configured sign-off can't be bypassed — not even by an admin. The approval
    decision itself flows through ``itsm_approvals``, not this engine, so it is never
    blocked. Uses the reverse relation to avoid importing itsm_approvals; degrades to
    False if that app isn't installed."""
    mgr = getattr(ticket, "approval_requests", None)
    if mgr is None:
        return False
    return mgr.filter(is_deleted=False, status="pending").exists()


def available_transitions(ticket, user, portal_only=False):
    """Transitions valid from the ticket's current status whose conditions pass.

    ``portal_only`` narrows to transitions flagged ``portal_allowed`` — the gate for the
    end-user Service Portal. Conditions still apply on top (a portal-allowed transition with
    an agent-only condition like ``is_assignee`` is correctly hidden from a requestor)."""
    from apps.itsm_workflows.models import Transition

    # A ticket awaiting approval sign-off exposes no transitions — its status is frozen
    # until the pending approval is decided (mirrors the guard in ``transition()``).
    if has_pending_approval(ticket):
        return []

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


# ── Field-condition validators (block-with-message guards) ───────────────────
# JIRA-style validators, NOT conditions: the transition stays VISIBLE (these are not
# evaluated in ``available_transitions``); the RUN is blocked with the admin's custom
# message. They run after ``_validate`` and before post-functions, so they test the value
# the agent is SUBMITTING (screen-field overlay) or the ticket's CURRENT value — never a
# value a post-function will later compute (e.g. ``auto_assign``). Each rule is
# ``{field_key, operator, value?, message}`` with operator in _FIELD_CONDITION_OPERATORS.

_FIELD_CONDITION_OPERATORS = {"is_not_empty", "is_empty", "equals", "not_equals"}
_FIELD_CONDITION_DEFAULT_MSG = "This transition is blocked until the field condition is met."


def _fc_is_empty(value) -> bool:
    """Emptiness for a field-condition value. Note ``0`` and ``False`` are PRESENT."""
    if isinstance(value, str):
        return value.strip() == ""
    return value in (None, [], {})


def _fc_norm(value):
    """String-normalize a value for equals/not_equals so a stored id/number/bool/option
    compares cleanly against the admin's (string) target."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, tuple)):
        return sorted(str(v) for v in value)
    return str(value)


def _fc_effective_value(key, ticket, fields, defs, value_cache):
    """The value a rule tests: the agent-submitted screen value when this request provided
    it (overlay wins, even if now empty), else the ticket's current stored value.
    Column-backed (``config.maps_to``) reads the Ticket column (FK → its scalar ``*_id``);
    value-backed reads FieldValue via the field service, fetched at most once (cached)."""
    provided = fields or {}
    if key in provided:
        return provided[key]
    fd = defs.get(key)
    maps_to = (fd.config or {}).get("maps_to") if fd else None
    if maps_to:
        id_attr = f"{maps_to}_id"
        return getattr(ticket, id_attr) if hasattr(ticket, id_attr) else getattr(ticket, maps_to, None)
    if value_cache[0] is None:
        from apps.itsm_core.services import fields as field_service
        value_cache[0] = field_service.get_values(ticket)
    return value_cache[0].get(key)


def _field_condition_passes(rule, ticket, fields, defs, value_cache) -> bool:
    op = rule.get("operator")
    key = rule.get("field_key")
    if op not in _FIELD_CONDITION_OPERATORS or not key:
        return True  # fail-OPEN on a corrupt/forward-incompatible rule (never brick a workflow)
    value = _fc_effective_value(key, ticket, fields, defs, value_cache)
    if op == "is_not_empty":
        return not _fc_is_empty(value)
    if op == "is_empty":
        return _fc_is_empty(value)
    if op == "equals":
        return _fc_norm(value) == _fc_norm(rule.get("value"))
    if op == "not_equals":
        return _fc_norm(value) != _fc_norm(rule.get("value"))
    return True


def _check_field_conditions(transition, ticket, fields):
    """Raise TransitionError (422, the admin's custom message) on the FIRST failing rule.
    No-op when none are configured (backward compatible)."""
    rules = transition.field_conditions or []
    if not rules:
        return
    keys = [r.get("field_key") for r in rules if r.get("field_key")]
    defs = _screen_field_defs(ticket.project, keys)  # reuse the existing key→def resolver
    value_cache = [None]  # lazy get_values(ticket), fetched at most once across all rules
    for rule in rules:
        if not _field_condition_passes(rule, ticket, fields, defs, value_cache):
            msg = (rule.get("message") or "").strip() or _FIELD_CONDITION_DEFAULT_MSG
            raise TransitionError(
                msg, status_code=422, errors={rule.get("field_key") or "detail": [msg]}
            )


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
        # config.preserve lists resolution fields a reopen must keep — the Problem
        # workflow preserves its KEDB payload (root_cause + workaround_provided,
        # captured at Record Known Error, not at resolve time).
        preserve = set(cfg.get("preserve") or [])
        ticket.resolution = ""
        ticket.resolution_code = ""
        if "root_cause" not in preserve:
            ticket.root_cause = ""
        ticket.resolution_notes = ""
        if "workaround_provided" not in preserve:
            ticket.workaround_provided = None
    elif ptype == "stamp_timestamp":
        field = cfg.get("field")
        if field in _STAMP_FIELDS:
            setattr(ticket, field, timezone.now())
    # SLA ops are deferred to post-commit hooks (see transition()).


def _ordered(post_functions):
    return sorted(post_functions or [], key=lambda pf: _PF_ORDER.get(pf.get("type"), 99))


# ── Transition-screen field persistence (admin-configurable capture fields) ──
# A transition's `screen` holds `TransitionScreenField`s (any `FieldDefinition.key`).
# `_validate` already enforces the mandatory ones (422). These helpers PERSIST the
# captured values so an arbitrary field an admin puts on a transition is actually
# saved: column-backed (`config.maps_to`) fields → the Ticket column, value-backed
# custom fields → a `FieldValue` row. Idempotent with `set_resolution_details` (both
# write identical values from the same `fields`).

def _screen_field_defs(project, keys):
    """Resolve screen field keys to their FieldDefinition (project wins over global),
    mirroring `itsm_tickets.views._resolve_screen_fields`."""
    from django.db.models import Q

    from apps.itsm_core.models import FieldDefinition

    defs = {}
    for fd in (FieldDefinition.objects
               .filter(key__in=list(keys), is_deleted=False)
               .filter(Q(project=project) | Q(project__isnull=True))):
        if fd.key not in defs or fd.project_id is not None:
            defs[fd.key] = fd
    return defs


def _coerce_column(field, raw):
    """Coerce a captured screen value for a column-backed (maps_to) Ticket field."""
    from django.utils.dateparse import parse_datetime

    from apps.itsm_core.models import FieldType

    t = field.field_type
    if t == FieldType.CHECKBOX:
        return None if raw in (None, "") else _as_bool(raw)
    if t == FieldType.NUMBER:
        return raw
    if t in (FieldType.DATE, FieldType.DATETIME):
        return parse_datetime(str(raw)) if not hasattr(raw, "isoformat") else raw
    return str(raw)


def _screen_provided(transition, fields):
    """{field_key: raw} for this transition's screen fields with a non-empty value."""
    if not transition.screen_id or not fields:
        return {}
    keys = [sf.field_key for sf in transition.screen.fields.all()]
    return {k: fields[k] for k in keys if fields.get(k) not in (None, "", [])}


def _apply_screen_columns(ticket, transition, fields) -> list:
    """Write column-backed (config.maps_to) screen fields onto the ticket in-memory;
    return the Ticket columns touched (for the save update_fields). Only non-empty
    provided values are written, so a partial screen never blanks a column."""
    provided = _screen_provided(transition, fields)
    if not provided:
        return []
    defs = _screen_field_defs(ticket.project, provided.keys())
    cols = []
    for key, raw in provided.items():
        fd = defs.get(key)
        maps_to = (fd.config or {}).get("maps_to") if fd else None
        if maps_to and hasattr(ticket, maps_to):
            setattr(ticket, maps_to, _coerce_column(fd, raw))
            cols.append(maps_to)
    return cols


def _persist_screen_values(ticket, transition, fields, user):
    """Persist value-backed (custom) screen fields as FieldValues. `set_values` skips
    column-backed (maps_to)/attachment keys itself and logs a `field_changed` audit."""
    provided = _screen_provided(transition, fields)
    if not provided:
        return
    from apps.itsm_core.services import fields as field_service

    field_service.set_values(ticket, provided, user)


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

    # 1b) approval gate — a ticket awaiting sign-off can't change status until the
    # pending approval is decided (everyone, admins included). Defense-in-depth: the UI
    # already hides transitions via available_transitions(), but a forged/racing POST must
    # not slip through. The transition that STARTS an approval is unaffected — the request
    # is created by a post-commit hook, so nothing is pending at this point yet.
    if has_pending_approval(locked):
        raise TransitionError(
            "This ticket is awaiting approval; it can't change status until the "
            "pending approval is decided.",
            status_code=403,
        )

    # 2) conditions
    if not evaluate_conditions(transition, locked, user):
        raise TransitionError("You are not allowed to perform this transition.", status_code=403)

    # 3) validators
    errors = _validate(transition, locked, fields, comment)
    if errors:
        raise TransitionError("Mandatory fields missing.", status_code=422, errors=errors)

    # 3b) field-condition validators — block-with-message (the button stays visible; only
    # the run is refused). Tests the submitted/current field value, never a post-function's.
    _check_field_conditions(transition, locked, fields)

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

    # 5b) column-backed transition-screen fields (config.maps_to) → Ticket columns
    screen_cols = _apply_screen_columns(locked, transition, fields)

    # 6) persist
    update_fields = ["status", "assignee", "priority", "resolution",
                     "resolution_code", "root_cause", "resolution_notes", "workaround_provided",
                     "reopen_count",
                     "assigned_at", "resolved_at", "closed_at", "first_responded_at", "updated_at",
                     *screen_cols]
    locked.save(update_fields=[f for f in dict.fromkeys(update_fields) if hasattr(locked, f)])

    # 6b) value-backed transition-screen fields (custom fields) → FieldValue rows
    _persist_screen_values(locked, transition, fields, user)

    # 7) post-commit side-effects
    def _after_commit():
        # Shared by every notification emit for THIS transition. `changed_at` (the
        # save's auto_now stamp) makes the occurrence unique in the outbox dedupe
        # key — without it a ticket's 2nd+ status-change email was silently dropped
        # (same key), and re-resolving after a reopen never notified. Built once so
        # a transition's multiple emits (post-function + the canonical one below)
        # still collapse onto one email.
        notify_ctx = {"from": from_status.name, "to": to_status.name,
                      "changed_at": locked.updated_at.isoformat()}
        log_event(locked, user, "status_changed",
                  payload={"from": from_status.name, "to": to_status.name,
                           "transition": transition.name})
        if to_done and to_status.key in ("closed",):
            log_event(locked, user, "closed", payload={"status": to_status.name})
        if is_reopen:
            log_event(locked, user, "reopened", payload={"to": to_status.name})
        hooks.sla_on_status_change(locked, from_status, to_status)
        # CSAT: fire a feedback survey when the ticket enters a done status that
        # matches the project's per-project trigger (resolved vs closed). No-op
        # unless itsm_surveys is installed + the project opted in.
        hooks.survey_on_resolution(locked, from_status, to_status)
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
                hooks.emit_event(cfg.get("event_type", "StatusChanged"), locked, actor=user,
                                 context=dict(notify_ctx))
            elif pf["type"] == "request_approval":
                from apps.itsm_approvals.models import ApprovalWorkflow
                awf = ApprovalWorkflow.objects.filter(
                    pk=cfg.get("workflow_id"), is_deleted=False
                ).first()
                if awf:
                    hooks.start_approval(locked, awf, user=user)
        # Most specific event wins: entering a done status notifies as Resolved /
        # Closed (whose rules carry the requestor-facing email templates) rather
        # than the generic StatusChanged — one email per transition, not two.
        # Nothing emitted "Resolved"/"Closed" before this, so those scheme rules
        # and templates were dead config. Same key convention as the close
        # log_event above; a done status not keyed "closed" counts as resolved
        # (incident "resolved", request "fulfilled").
        if to_done:
            event = "Closed" if to_status.key == "closed" else "Resolved"
        else:
            event = "StatusChanged"
        hooks.emit_event(event, locked, actor=user, context=notify_ctx)

    transaction.on_commit(_after_commit)
    return {"ticket": locked, "from_status": from_status, "to_status": to_status}


def from_status_id_present(ticket) -> bool:
    return ticket.status_id is not None and ticket.status.category_id is not None
