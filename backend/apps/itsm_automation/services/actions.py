"""Automation actions. Each runner writes ONLY through the existing service
choke-points (workflow engine, ticket_service, field_service) as the automation
bot, so every guard, audit row and notification behaves exactly like a manual edit.

A runner returns ``{"type", "status": "done"|"skipped", "detail"}`` or raises
``AutomationError`` (the dispatcher rolls the rule back and records the message).
"""

from __future__ import annotations

from apps.itsm_tickets.models import (
    ImpactLevel,
    InvestigationReason,
    Priority,
    ResolutionCode,
    UrgencyLevel,
)

# The ITIL columns update_ticket writes; the kwarg is the column name. Same set as
# catalog.SETTABLE_COLUMNS minus impact/urgency, which are listed with the built-ins.
_ITIL_TEXT = {"business_impact", "root_cause", "resolution_notes", "workaround_notes"}
_ITIL_CHOICE = {  # blank clears; otherwise one of the values (as TicketViewSet.update)
    "resolution_code": set(ResolutionCode.values),
    "investigation_reason": set(InvestigationReason.values),
}
_ITIL_NULLABLE_BOOL = {"service_downtime", "workaround_provided"}
# Built-in fields a set_field action may write → the update_ticket kwarg.
SETTABLE_BUILTINS = {
    "priority": "priority",
    "impact": "impact",
    "urgency": "urgency",
    "assignee": "assignee_id",
    "assigned_group": "group_id",
    **{c: c for c in (*_ITIL_TEXT, *_ITIL_CHOICE, *_ITIL_NULLABLE_BOOL,
                      "users_affected", "major_incident")},
}
_CHOICES = {
    "priority": {c.value for c in Priority},
    "impact": {c.value for c in ImpactLevel},
    "urgency": {c.value for c in UrgencyLevel},
}
COMMENT_VISIBILITIES = ("public", "private")


class AutomationError(Exception):
    """An action could not run; the message is shown in the rule's run log."""


def _as_bool(value) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def clean_column_value(field, value):
    """The value a set_field action writes to an ITIL column, normalised the way
    ``TicketViewSet.update`` does it. Raises ``AutomationError`` for a bad value. The
    serializer calls it at save, the runner again at run time. Other fields pass
    through unchanged."""
    if field in _ITIL_TEXT:
        return "" if value is None else str(value)
    if field in _ITIL_CHOICE:
        value = str(value) if value else ""  # str(): a list is just an invalid value
        if value and value not in _ITIL_CHOICE[field]:
            raise AutomationError(f"“{value}” isn't a valid {field.replace('_', ' ')}.")
        return value
    if field == "users_affected":
        if value in (None, ""):
            return None
        try:
            number = int(str(value).strip())
        except (TypeError, ValueError) as exc:
            raise AutomationError("Users affected must be a whole number.") from exc
        if number < 0:
            raise AutomationError("Users affected must be zero or more.")
        return number
    if field in _ITIL_NULLABLE_BOOL:
        return None if value in (None, "") else _as_bool(value)
    if field == "major_incident":
        return _as_bool(value)
    return value


def _result(atype, status, detail):
    return {"type": atype, "status": status, "detail": detail}


# ── transition ───────────────────────────────────────────────────────────────

def run_transition(ticket, cfg, bot):
    from apps.itsm_workflows.models import Transition
    from apps.itsm_workflows.services import engine

    tr = (Transition.objects.filter(pk=cfg.get("transition_id"), is_deleted=False)
          .select_related("to_status", "from_status").first())
    if tr is None:
        raise AutomationError("The configured transition no longer exists.")
    if tr.workflow_id != ticket.workflow_id:
        return _result("transition", "skipped",
                       f"“{tr.name}” belongs to a different workflow than this ticket.")
    if ticket.status_id == tr.to_status_id:
        return _result("transition", "skipped", f"Already in {tr.to_status.name}.")
    if not tr.is_global and tr.from_status_id != ticket.status_id:
        source = tr.from_status.name if tr.from_status else "(create)"
        return _result("transition", "skipped",
                       f"“{tr.name}” only runs from {source}; the ticket is in {ticket.status.name}.")
    try:
        # keep_assignee → preserve_assignee is redundant since 2026-10-18: the engine's
        # auto_assign never overwrites an existing assignee. Passed for compatibility.
        engine.transition(ticket, tr, bot,
                          preserve_assignee=bool(cfg.get("keep_assignee", True)))
    except engine.TransitionError as exc:
        raise AutomationError(f"Transition “{tr.name}” was blocked: {exc}") from exc
    return _result("transition", "done", f"{tr.name} → {tr.to_status.name}")


# ── set field ────────────────────────────────────────────────────────────────

def _user_id(value):
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise AutomationError("Assignee must be a user id.") from exc


def run_set_field(ticket, cfg, bot):
    from apps.itsm_tickets.services import ticket_service

    field = cfg.get("field") or ""
    value = cfg.get("value")

    if field.startswith("cf:"):
        return _set_custom(ticket, field[3:], value, bot)
    kwarg = SETTABLE_BUILTINS.get(field)
    if kwarg is None:
        raise AutomationError(f"“{field}” can't be set by automation.")
    if field in _CHOICES and value not in _CHOICES[field]:
        raise AutomationError(f"“{value}” isn't a valid {field} value.")

    changes = {kwarg: clean_column_value(field, value)}
    if field == "assignee":
        changes = {"assignee_id": _user_id(value)}
    elif field == "assigned_group":
        # A new group whose members don't include the current assignee also clears
        # the assignee (the strict-assignment rule would otherwise reject the write).
        try:
            ticket_service.ensure_assignee_in_group(value, ticket.assignee_id)
        except ValueError:
            changes["assignee_id"] = None
    try:
        ticket_service.update_ticket(ticket=ticket, user=bot, **changes)
    except ValueError as exc:
        raise AutomationError(str(exc)) from exc
    return _result("set_field", "done", f"{field} set")


def _set_custom(ticket, key, value, bot):
    from apps.itsm_core.services import fields as field_service

    defs = {d.key: d for d in field_service.get_field_definitions(ticket.project)}
    fdef = defs.get(key)
    if fdef is None:
        raise AutomationError(f"Custom field “{key}” isn't configured on this project.")
    column = (fdef.config or {}).get("maps_to")
    if column:
        # Column-backed system field (e.g. impact) — write the Ticket column instead.
        return run_set_field(ticket, {"field": column, "value": value}, bot)
    try:
        field_service.set_values(ticket, {key: value}, bot)
    except (TypeError, ValueError) as exc:
        raise AutomationError(f"Couldn't set {fdef.name}: {exc}") from exc
    return _result("set_field", "done", f"{fdef.name} set")


# ── add comment ──────────────────────────────────────────────────────────────

def run_add_comment(ticket, cfg, bot):
    from apps.itsm_tickets.models import CannedNote
    from apps.itsm_tickets.services import ticket_service

    visibility = cfg.get("visibility") or "private"
    if visibility not in COMMENT_VISIBILITIES:
        raise AutomationError("Comment visibility must be public or private.")
    body = cfg.get("body_html") or ""
    if cfg.get("canned_note_id"):
        note = CannedNote.objects.filter(pk=cfg["canned_note_id"], is_shared=True,
                                         is_deleted=False).first()
        if note is None:
            raise AutomationError("The configured canned response no longer exists.")
        body = note.body_html
    if not body.strip():
        raise AutomationError("The comment is empty.")
    # counts_as_response=False: an automated reply must not satisfy the
    # first-response SLA — only a person answering does.
    ticket_service.add_comment(ticket=ticket, author=bot, body_html=body,
                               visibility=visibility, counts_as_response=False)
    return _result("add_comment", "done",
                   "Internal note added" if visibility == "private" else "Public comment added")


RUNNERS = {
    "transition": run_transition,
    "set_field": run_set_field,
    "add_comment": run_add_comment,
}
