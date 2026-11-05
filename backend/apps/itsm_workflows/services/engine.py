"""Workflow execution engine — the single choke-point for ticket status changes.

``transition()`` runs the ordered pipeline:
  resolve & assert → conditions → validators → apply status →
  post-functions (canonical order) → persist → post-commit side-effects.

Side-effects (audit log, SLA clock ops, notification events) run inside
``transaction.on_commit`` so a rolled-back transition never notifies anyone.

``move_for_approval()`` is the one other status write: the approval engine's system
move into / out of a "Send for approval" waiting status (same side-effects).
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
# Done statuses that END a ticket (Closed notification + `closed` audit), vs. a
# resolved-style done status. "rejected" = the Request workflow's Rejected status.
_TERMINAL_KEYS = ("closed", "rejected")
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
        # B2: passes only when the ticket's LATEST non-cancelled approval request was
        # approved — or when it never had one (tickets that didn't need sign-off flow
        # normally). A rejection (or a pending request) keeps it blocked. Cancelled
        # requests (a project move) are ignored.
        latest = (ticket.approval_requests.filter(is_deleted=False).exclude(status="cancelled")
                  .order_by("-created_at").values_list("status", flat=True).first())
        result = latest in (None, "approved")
    elif ctype == "approval_rejected":
        # True only when the ticket's LATEST non-cancelled approval request was
        # rejected — gates the Request workflow's "Reject" (new → rejected) so an
        # agent can't use it to bypass a pending/granted approval. itsm_approvals
        # auto-runs it (system actor) when an approval is rejected.
        result = latest_approval_rejected(ticket)
    return (not result) if cond.negate else result


def latest_approval_rejected(ticket) -> bool:
    """True when the ticket's most recent non-cancelled approval request is rejected."""
    mgr = getattr(ticket, "approval_requests", None)
    if mgr is None:
        return False
    latest = (mgr.filter(is_deleted=False).exclude(status="cancelled")
              .order_by("-created_at").values_list("status", flat=True).first())
    return latest == "rejected"


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
    ).filter(to_status__is_deleted=False).select_related(
        "to_status__category", "from_status"
    ).prefetch_related("conditions", "screen__fields")
    if portal_only:
        qs = qs.filter(portal_allowed=True)
    return [t for t in qs if evaluate_conditions(t, ticket, user)]


def models_q(ticket):
    """Transitions offered from the ticket's status: an edge FROM that status, or an
    explicitly global one. A non-global ``from_status=None`` transition is the
    workflow's "(create)" transition — it runs only at ticket creation, never here."""
    from django.db.models import Q
    return Q(from_status_id=ticket.status_id, from_status__isnull=False) | Q(is_global=True)


# ── The "(create)" transition (runs once, at ticket creation) ───────────────
# Semantics (B14, 2026-10-18): ``from_status=None`` + ``is_global=False`` = the create
# transition; ``is_global=True`` = available from any status (from_status ignored).
# At creation only the SAFE post-functions run — see ``apply_create_transition``.
# Conditions, mandatory screen fields, the note prompt and field conditions do NOT
# apply at create (portal/email requesters have no role; the create form's own
# Required layout governs creation).

_CREATE_PF_APPLIED = {"auto_assign", "set_assignee", "stamp_timestamp"}
_CREATE_PF_DEFERRED = {"request_approval", "emit_event"}


def create_transition_for(workflow):
    """The workflow's create transition, or None. Candidates: live, non-global,
    ``from_status=None``, into a live non-Done status. Prefers the one into the
    ``is_initial`` status, else the lowest ``sort_order``."""
    from apps.itsm_workflows.models import Transition

    if workflow is None:
        return None
    candidates = list(
        Transition.objects.filter(
            workflow=workflow, from_status__isnull=True, is_global=False,
            to_status__is_deleted=False,
        ).exclude(to_status__category__key="done")
        .select_related("to_status").order_by("sort_order", "id")
    )
    for tr in candidates:
        if tr.to_status.is_initial:
            return tr
    return candidates[0] if candidates else None


def start_status_for(workflow):
    """Where a new ticket starts: the create transition's target, else the
    ``is_initial`` status, else the lowest ``sort_order`` live status (or None)."""
    from apps.itsm_workflows.models import Status

    if workflow is None:
        return None
    tr = create_transition_for(workflow)
    if tr is not None:
        return tr.to_status
    return (Status.objects.filter(workflow=workflow, is_initial=True).first()
            or Status.objects.filter(workflow=workflow).order_by("sort_order", "id").first())


def apply_create_transition(ticket, user):
    """Run the create transition's SAFE post-functions on an UNSAVED new ticket and
    return the deferred ones (``request_approval``/``emit_event``) for
    ``run_create_deferred``. Applied: ``auto_assign`` + ``set_assignee`` (both
    fill-only — the create payload / routing win), ``stamp_timestamp``. Skipped at
    create: ``clear_assignee``, ``set_priority`` (the create payload owns ownership +
    priority), resolution post-functions and SLA ops (create starts SLA itself)."""
    tr = create_transition_for(getattr(ticket, "workflow", None))
    if tr is None:
        return []
    deferred = []
    for pf in _ordered(tr.post_functions):
        ptype = pf.get("type")
        if ptype in _CREATE_PF_DEFERRED:
            deferred.append(pf)
        elif ptype in _CREATE_PF_APPLIED:
            if ptype == "set_assignee" and ticket.assignee_id:
                continue
            _apply_post_function(pf, ticket, user, {})
    return deferred


def begin_create_approvals(ticket, deferred, user):
    """Start any ``request_approval`` the create transition carries — INSIDE the
    create transaction via ``hooks.begin_approval`` (non-swallowing: a refusal rolls
    the create back with a readable error). Falls back to the post-commit
    ``start_approval`` hook when ``begin_approval`` isn't available."""
    from apps.itsm_approvals.models import ApprovalWorkflow

    for pf in deferred:
        if pf.get("type") != "request_approval":
            continue
        awf = ApprovalWorkflow.objects.filter(
            pk=(pf.get("config") or {}).get("workflow_id"), is_deleted=False
        ).first()
        if awf is None:
            continue
        begin = getattr(hooks, "begin_approval", None)
        if begin is not None:
            try:
                begin(ticket, awf, user=user)
            except TransitionError as exc:
                # create_ticket callers surface ValueError as a 400 (B1: blocked).
                raise ValueError(exc.message) from exc
        else:  # pragma: no cover — pre-WS1 fallback
            transaction.on_commit(lambda a=awf: hooks.start_approval(ticket, a, user=user))


def run_create_deferred(ticket, deferred, user):
    """Post-commit part of the create transition: custom ``emit_event``s."""
    for pf in deferred:
        if pf.get("type") == "emit_event":
            cfg = pf.get("config") or {}
            hooks.emit_event(cfg.get("event_type", "StatusChanged"), ticket, actor=user)


# ── Capture-screen fields obey the layout's "show when" rule (2026-11-05c) ────
# A screen field is configured on the transition, but its conditional rule lives on
# the ticket's field layout (``FieldLayoutItem.visibility_rule``, set in Fields →
# Settings → Conditional rule). The slide-over evaluates it live with ``evalRule``;
# the server evaluates the same rule with ``field_service.visibility_state`` so a
# hidden field is never required and a hidden/locked value is never written.

_EDITABLE = (True, False)  # (visible, readonly) of a field with no rule


def screen_layout_rules(project, ticket_type, keys) -> dict:
    """``{field_key: visibility_rule}`` for the given screen keys, read off the ticket's
    layout (``field_service.get_layout``: the ticket type's layout, else the project
    default). Only items that carry a rule are returned; a project field wins over a
    global field with the same key. The layout's ``is_hidden`` is ignored on purpose:
    putting a field on a transition screen is an explicit admin choice."""
    from apps.itsm_core.services import fields as field_service

    keys = [k for k in keys if k]
    if not keys or project is None:
        return {}
    layout = field_service.get_layout(project, ticket_type)
    if layout is None:
        return {}
    out, scoped = {}, set()
    items = (layout.items.filter(is_deleted=False, field__is_deleted=False, field__key__in=keys)
             .select_related("field"))
    for it in items:
        rule = it.visibility_rule
        key = it.field.key
        if not isinstance(rule, dict) or not rule.get("field") or key in scoped:
            continue
        out[key] = rule
        if it.field.project_id is not None:
            scoped.add(key)
    return out


def _screen_rule_states(transition, ticket, fields) -> dict:
    """``{field_key: (visible, readonly)}`` for this transition's screen fields whose
    layout item carries a rule. Each rule is evaluated once (no chaining, like the
    browser's ``evalRule``) against the values the ticket is moving with: the submitted
    screen value when provided (even empty), else the ticket's current value, and
    ``status`` = the TARGET status (the screen captures data for the status entered)."""
    if not transition.screen_id:
        return {}
    keys = [sf.field_key for sf in transition.screen.fields.all()]
    rules = screen_layout_rules(ticket.project, ticket.ticket_type, keys)
    if not rules:
        return {}
    from apps.itsm_core.services import fields as field_service

    cond_keys = sorted({str(r["field"]) for r in rules.values()} - {"status"})
    defs = _applicable_field_defs(ticket.project, cond_keys)
    value_cache = [None]
    values = {"status": transition.to_status.key}
    for key in cond_keys:
        values[key] = _fc_effective_value(key, ticket, fields, defs, value_cache)
    return {key: field_service.visibility_state(rule, values) for key, rule in rules.items()}


# ── Validators (mandatory transition-screen fields) ─────────────────────────

def _validate(transition, ticket, fields, comment, rule_states=None) -> dict:
    errors = {}
    if transition.screen_id:
        provided = fields or {}
        states = rule_states or {}
        for sf in transition.screen.fields.filter(is_mandatory=True):
            # A screen field its layout rule hides or locks isn't required — the same
            # rule the create form follows (itsm-fields B5). GridCrest "Put on Hold":
            # Reason shows only when Pending Reason = other (2026-11-05c).
            if states.get(sf.field_key, _EDITABLE) != _EDITABLE:
                continue
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


def _fc_cascade_complete(fd, value) -> bool:
    """A cascade value is a path (list of option values, level 1 first). It is
    COMPLETE when its last node is a leaf — has no live, active child options. An
    unknown last value (option since deleted) counts as complete: fail-open, an
    agent must never be bricked by data they can't see."""
    from apps.itsm_core.models import FieldOption

    path = value if isinstance(value, (list, tuple)) else [value]
    path = [p for p in path if p not in (None, "")]
    if not path:
        return False
    node = FieldOption.objects.filter(field=fd, value=str(path[-1]), is_deleted=False).first()
    if node is None:
        return True
    return not node.children.filter(is_deleted=False, is_active=True).exists()


def _field_condition_passes(rule, ticket, fields, defs, value_cache) -> bool:
    from apps.itsm_core.models import FieldType

    op = rule.get("operator")
    key = rule.get("field_key")
    if op not in _FIELD_CONDITION_OPERATORS or not key:
        return True  # fail-OPEN on a corrupt/forward-incompatible rule (never brick a workflow)
    fd = defs.get(key)
    if fd is None:
        # The ticket's project doesn't have this field (not defined for it, or a
        # global whose ``applies_to`` excludes the project type) → NOT APPLICABLE.
        # A workflow shared by several projects must not require a field only one
        # of them has (B17a: `userlocation` blocked Assign in FACINC/HRINC).
        return True
    value = _fc_effective_value(key, ticket, fields, defs, value_cache)
    if op == "is_not_empty":
        if fd.field_type == FieldType.CASCADE and not _fc_is_empty(value):
            return _fc_cascade_complete(fd, value)  # B17b: the full path, not level 1
        return not _fc_is_empty(value)
    if op == "is_empty":
        return _fc_is_empty(value)
    if op == "equals":
        return _fc_norm(value) == _fc_norm(rule.get("value"))
    if op == "not_equals":
        return _fc_norm(value) != _fc_norm(rule.get("value"))
    return True


def _applicable_field_defs(project, keys):
    """key → FieldDefinition for the fields the PROJECT actually has (its own +
    applicable globals; project wins). The single "which fields does this project
    have?" rule (``field_service.get_field_definitions(applicable_only=True)``)."""
    from apps.itsm_core.services import fields as field_service

    defs = {}
    keys = [k for k in keys if k]
    if not keys or project is None:
        return defs
    for fd in field_service.get_field_definitions(project, applicable_only=True).filter(key__in=keys):
        if fd.key not in defs or fd.project_id is not None:
            defs[fd.key] = fd
    return defs


def _first_failing_rule(rules, ticket, fields, defs, value_cache, skip_keys=()):
    for rule in rules or []:
        if rule.get("field_key") in skip_keys:
            continue
        if not _field_condition_passes(rule, ticket, fields, defs, value_cache):
            return rule
    return None


def _rule_message(rule) -> str:
    return (rule.get("message") or "").strip() or _FIELD_CONDITION_DEFAULT_MSG


def _check_field_conditions(transition, ticket, fields):
    """Raise TransitionError (422, the admin's custom message) on the FIRST failing rule.
    No-op when none are configured (backward compatible). Authoritative — the
    precomputed ``blocked_reasons`` is only a UI hint."""
    rules = transition.field_conditions or []
    if not rules:
        return
    defs = _applicable_field_defs(ticket.project, [r.get("field_key") for r in rules])
    value_cache = [None]  # lazy get_values(ticket), fetched at most once across all rules
    rule = _first_failing_rule(rules, ticket, fields, defs, value_cache)
    if rule is not None:
        msg = _rule_message(rule)
        raise TransitionError(
            msg, status_code=422, errors={rule.get("field_key") or "detail": [msg]}
        )


def blocked_reasons(ticket, transitions) -> dict:
    """``{transition.id: message}`` for transitions whose field conditions fail on the
    ticket's CURRENT values (U4 — the button renders disabled with the reason). Rules
    on the transition's own capture-screen fields are skipped: the agent can satisfy
    them in the slide-over. Shares field defs + one ``get_values`` across all rows."""
    with_rules = [t for t in transitions if t.field_conditions]
    if not with_rules:
        return {}
    keys = {r.get("field_key") for t in with_rules for r in t.field_conditions}
    defs = _applicable_field_defs(ticket.project, keys)
    value_cache = [None]
    out = {}
    for tr in with_rules:
        screen_keys = ({sf.field_key for sf in tr.screen.fields.all()}
                       if tr.screen_id else set())
        rule = _first_failing_rule(tr.field_conditions, ticket, None, defs, value_cache,
                                   skip_keys=screen_keys)
        if rule is not None:
            out[tr.id] = _rule_message(rule)
    return out


# ── Post-functions (mutate ticket in memory) ────────────────────────────────

def _apply_post_function(pf, ticket, user, fields):
    from apps.itsm_groups.services import pick_assignee_if_unassigned

    ptype, cfg = pf.get("type"), pf.get("config", {})
    if ptype == "auto_assign":
        # B17c (user decision, all orgs): auto-assign NEVER overwrites an existing
        # assignee — it only picks someone (and advances the round-robin cursor)
        # when the ticket is unassigned.
        group = ticket.assigned_group
        strategy = cfg.get("strategy", "round_robin")
        uid = pick_assignee_if_unassigned(ticket.assignee_id, strategy, group, cfg.get("user_id"))
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
def transition(ticket, transition, user, fields=None, comment=None, *, preserve_assignee=False):
    """Move `ticket` through `transition`. Raises TransitionError on guard/validation
    failure. Returns a result dict.

    ``preserve_assignee`` is kept for API compatibility (automation passes it) but is
    now always effectively on: an ``auto_assign`` post-function never overwrites an
    existing assignee (B17c, 2026-10-18)."""
    from apps.itsm_tickets.models import Ticket

    locked = Ticket.objects.select_for_update().get(pk=ticket.pk)

    # 1) resolve & assert. A non-global from_status=None transition is the "(create)"
    # transition — it runs only at ticket creation (B14), never on an existing ticket.
    if not transition.is_global and transition.from_status_id is None:
        raise TransitionError(
            f"“{transition.name}” is the create transition; it runs only when a ticket is created.",
            status_code=400,
        )
    if not transition.is_global and transition.from_status_id != locked.status_id:
        raise TransitionError("Ticket has already moved; refresh and retry.", status_code=409)
    if transition.to_status.is_deleted:
        raise TransitionError("This transition leads to a deleted status.", status_code=400)

    # 1b) approval gate — a ticket awaiting sign-off can't change status until the
    # pending approval is decided (everyone, admins included). Defense-in-depth: the UI
    # already hides transitions via available_transitions(), but a forged/racing POST must
    # not slip through. The transition that STARTS an approval is unaffected — the request
    # is created at step 6d below, after this guard.
    if has_pending_approval(locked):
        raise TransitionError(
            "This ticket is awaiting approval; it can't change status until the "
            "pending approval is decided.",
            status_code=403,
        )

    # 2) conditions
    if not evaluate_conditions(transition, locked, user):
        raise TransitionError("You are not allowed to perform this transition.", status_code=403)

    # 3) validators. Screen fields follow their layout "show when" rule: one the rule
    # hides or locks is neither required nor written (its stored value is kept).
    rule_states = _screen_rule_states(transition, locked, fields)
    errors = _validate(transition, locked, fields, comment, rule_states)
    if errors:
        raise TransitionError("Mandatory fields missing.", status_code=422, errors=errors)
    if rule_states and fields:
        fields = {k: v for k, v in fields.items() if rule_states.get(k, _EDITABLE) == _EDITABLE}

    # 3b) field-condition validators — block-with-message (the button stays visible; only
    # the run is refused). Tests the submitted/current field value, never a post-function's.
    _check_field_conditions(transition, locked, fields)

    from_status = locked.status
    to_status = transition.to_status
    from_done = from_status.category.key == "done" if from_status_id_present(locked) else False
    to_done = to_status.category.key == "done"

    # 4) apply status
    locked.status = to_status
    old_priority = locked.priority  # C7: a set_priority PF / screen Priority is audited

    # detect reopen
    is_reopen = from_done and not to_done
    if is_reopen:
        locked.reopen_count = (locked.reopen_count or 0) + 1

    # 5) post-functions (canonical order)
    sla_ops = []
    approval_pfs = []
    for pf in _ordered(transition.post_functions):
        ptype = pf.get("type")
        if ptype in ("start_sla", "stop_sla", "pause_sla", "resume_sla", "emit_event"):
            sla_ops.append(pf)
            continue
        if ptype == "request_approval":
            approval_pfs.append(pf)  # started in-transaction at step 6d
            continue
        if ptype == "auto_assign" and locked.assignee_id:
            continue  # never overwrite an assignee (B17c) — also keeps the RR cursor still
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

    # 6c) C7: a priority changed by a `set_priority` post-function or a captured
    # Priority screen field is audited + re-targets the SLA timers, exactly like an
    # inline edit (post-commit; the SLA hook swallows its own errors).
    new_priority = locked.priority
    if new_priority != old_priority:
        def _after_priority():
            log_event(locked, user, "priority_changed",
                      payload={"old": old_priority, "new": new_priority})
            sla_hook = getattr(hooks, "sla_priority_changed", None)
            if sla_hook is not None:
                sla_hook(locked, old_priority, new_priority)
        transaction.on_commit(_after_priority)

    # 6d) start the approval(s) this transition requests — INSIDE the transaction, via
    # the non-swallowing hook (B1): when an approver can't be resolved it raises a 400
    # TransitionError, the whole transition rolls back and the ticket keeps its status
    # (no half-created request). An inactive/deleted approval workflow starts nothing.
    for pf in approval_pfs:
        hooks.begin_approval(locked, (pf.get("config") or {}).get("workflow_id"), user=user)

    # 7) post-commit side-effects
    def _after_commit():
        _status_change_effects(locked, user, from_status, to_status, transition.name,
                               is_reopen=is_reopen, to_done=to_done, sla_ops=sla_ops)

    transaction.on_commit(_after_commit)
    return {"ticket": locked, "from_status": from_status, "to_status": to_status}


def _status_change_effects(locked, user, from_status, to_status, label, *, is_reopen, to_done,
                           sla_ops=()):
    """Post-commit side-effects of a status change: audit, SLA, survey, notification,
    automation. Shared by ``transition()`` and ``move_for_approval()`` so a system
    move notifies, pauses SLA and triggers automation exactly like a transition."""
    # Shared by every notification emit for THIS status change. `changed_at` (the
    # save's auto_now stamp) makes the occurrence unique in the outbox dedupe
    # key — without it a ticket's 2nd+ status-change email was silently dropped
    # (same key), and re-resolving after a reopen never notified. Built once so
    # a transition's multiple emits (post-function + the canonical one below)
    # still collapse onto one email.
    notify_ctx = {"from": from_status.name, "to": to_status.name,
                  "changed_at": locked.updated_at.isoformat()}
    log_event(locked, user, "status_changed",
              payload={"from": from_status.name, "to": to_status.name,
                       "transition": label})
    # A Rejected request (status key "rejected", done) is terminal like Closed.
    if to_done and to_status.key in _TERMINAL_KEYS:
        log_event(locked, user, "closed", payload={"status": to_status.name})
    if is_reopen:
        log_event(locked, user, "reopened", payload={"to": to_status.name})
    hooks.sla_on_status_change(locked, from_status, to_status)
    # CSAT: fire a feedback survey when the ticket enters a done status that
    # matches the project's per-project trigger (resolved vs closed). No-op
    # unless itsm_surveys is installed + the project opted in.
    if to_status.key != "rejected":  # never ask for CSAT on a rejected request
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
    # Most specific event wins: entering a done status notifies as Resolved /
    # Closed (whose rules carry the requestor-facing email templates) rather
    # than the generic StatusChanged — one email per transition, not two.
    # Nothing emitted "Resolved"/"Closed" before this, so those scheme rules
    # and templates were dead config. Same key convention as the close
    # log_event above; a done status not keyed "closed" counts as resolved
    # (incident "resolved", request "fulfilled").
    if to_done:
        event = "Closed" if to_status.key in _TERMINAL_KEYS else "Resolved"
    else:
        event = "StatusChanged"
    hooks.emit_event(event, locked, actor=user, context=notify_ctx)
    hooks.automation_dispatch("status_changed", locked, actor=user,
                              from_status=from_status, to_status=to_status)


@transaction.atomic
def move_for_approval(ticket, to_status, user, *, label):
    """Move ``ticket`` into or out of an approval's waiting status ("Send for
    approval", 2026-10-24). The only status write besides ``transition()``, and only
    ``itsm_approvals`` calls it.

    It's a system move: no Transition row, so no conditions, screens, field
    conditions or post-functions, and it deliberately ignores the pending-approval
    freeze (the approval engine moves the ticket while its own request is pending).
    The post-commit effects are the same as a transition's (audit, SLA pause/resume
    via ``pauses_sla``, StatusChanged, automation). Refuses a deleted status, one from
    another workflow, or a Done status (a waiting/return status never closes a
    ticket). Returns the locked ticket, or None when it's already there."""
    from apps.itsm_tickets.models import Ticket

    locked = Ticket.objects.select_for_update(of=("self",)).select_related(
        "status", "status__category").get(pk=ticket.pk)
    if to_status is None or to_status.is_deleted:
        raise TransitionError("That status no longer exists.", status_code=400)
    if to_status.workflow_id != locked.workflow_id:
        raise TransitionError("That status belongs to another workflow.", status_code=400)
    if to_status.category.key == "done":
        raise TransitionError(f"“{to_status.name}” is a Done status.", status_code=400)
    if locked.status_id == to_status.id:
        return None

    from_status = locked.status
    from_done = from_status.category.key == "done" if from_status_id_present(locked) else False
    locked.status = to_status
    is_reopen = from_done
    if is_reopen:
        locked.reopen_count = (locked.reopen_count or 0) + 1
    locked.save(update_fields=["status", "reopen_count", "updated_at"])

    transaction.on_commit(lambda: _status_change_effects(
        locked, user, from_status, to_status, label, is_reopen=is_reopen, to_done=False))
    return locked


def from_status_id_present(ticket) -> bool:
    return ticket.status_id is not None and ticket.status.category_id is not None
