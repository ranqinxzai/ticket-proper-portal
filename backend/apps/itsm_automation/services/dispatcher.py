"""Automation dispatcher — the one entry point the ticket/workflow services call
(via ``itsm_core.services.hooks.automation_dispatch``) after a write commits.

Pipeline per event: loop guard → the project's active rules (in ``order``) whose
triggers match → conditions → actions (one atomic block per rule) → run log +
audit row. A failing rule rolls back only its own actions and never breaks the
triggering write or the rules after it.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from ..models import AutomationRule, AutomationRun, TriggerType
from . import conditions
from .actions import RUNNERS, AutomationError
from .system_user import get_automation_bot, is_automation_bot

logger = logging.getLogger("itsm")


def _trigger_matches(trigger, event, changed_fields, from_status, to_status) -> bool:
    if not isinstance(trigger, dict) or trigger.get("type") != event:
        return False
    cfg = trigger.get("config") or {}
    if event == TriggerType.TICKET_UPDATED:
        wanted = set(cfg.get("fields") or [])
        return not wanted or bool(wanted & set(changed_fields or []))
    if event == TriggerType.STATUS_CHANGED:
        froms = {str(s) for s in cfg.get("from_status_ids") or []}
        tos = {str(s) for s in cfg.get("to_status_ids") or []}
        if froms and str(getattr(from_status, "pk", from_status)) not in froms:
            return False
        if tos and str(getattr(to_status, "pk", to_status)) not in tos:
            return False
        return True
    return True  # ticket_created has no config


def matching_rules(project_id, event, *, changed_fields=None, from_status=None, to_status=None):
    rules = AutomationRule.objects.filter(project_id=project_id, is_active=True, is_deleted=False)
    return [r for r in rules
            if any(_trigger_matches(t, event, changed_fields, from_status, to_status)
                   for t in (r.triggers or []))]


def _record(rule, ticket, event, status, message="", results=None):
    AutomationRun.objects.create(rule=rule, ticket_id=ticket.pk, event=event, status=status,
                                 message=message[:2000], actions_result=results or [])
    bump = {"last_run_at": timezone.now(), "run_count": F("run_count") + 1}
    if status == AutomationRun.Status.FAILED:
        bump["failure_count"] = F("failure_count") + 1
    AutomationRule.objects.filter(pk=rule.pk).update(**bump)


def _run_rule(rule, ticket, event, bot):
    """Run one rule's actions atomically. Returns the run status."""
    from apps.itsm_core.services import log_event

    results = []
    try:
        with transaction.atomic():
            for action in rule.actions or []:
                runner = RUNNERS.get((action or {}).get("type"))
                if runner is None:
                    raise AutomationError(f"Unknown action “{(action or {}).get('type')}”.")
                ticket.refresh_from_db()
                results.append(runner(ticket, action.get("config") or {}, bot))
            done = [r for r in results if r["status"] == "done"]
            if done:
                log_event(ticket, bot, "automation_applied",
                          payload={"rule_id": str(rule.pk), "rule_name": rule.name,
                                   "actions": [r["detail"] for r in done]})
    except AutomationError as exc:
        _record(rule, ticket, event, AutomationRun.Status.FAILED, str(exc), results)
        return AutomationRun.Status.FAILED
    except Exception as exc:  # noqa: BLE001 — a rule bug must never break the ticket write
        logger.exception("Automation rule %s failed on ticket %s", rule.pk, ticket.pk)
        _record(rule, ticket, event, AutomationRun.Status.FAILED,
                f"Unexpected error: {exc.__class__.__name__}", results)
        return AutomationRun.Status.FAILED

    status = (AutomationRun.Status.SUCCESS if any(r["status"] == "done" for r in results)
              else AutomationRun.Status.SKIPPED)
    message = "; ".join(r["detail"] for r in results)
    _record(rule, ticket, event, status, message, results)
    return status


def dispatch(event, ticket, *, actor=None, changed_fields=None, from_status=None, to_status=None):
    """Run every matching automation rule for ``event`` on ``ticket``.

    Called post-commit. Events caused by the automation bot itself are ignored, so
    a rule's own writes never trigger rules (no loops, no chains) in v1.
    """
    if is_automation_bot(actor):
        return
    rules = matching_rules(ticket.project_id, event, changed_fields=changed_fields,
                           from_status=from_status, to_status=to_status)
    if not rules:
        return
    from apps.itsm_tickets.models import Ticket

    bot = get_automation_bot()
    ticket = Ticket.objects.get(pk=ticket.pk)  # fresh copy; never mutate the caller's
    for rule in rules:
        ticket.refresh_from_db()
        try:
            if not conditions.matches(ticket, rule.conditions):
                continue
        except Exception:  # noqa: BLE001 — a malformed spec skips the rule, never crashes
            logger.exception("Automation rule %s: condition check failed", rule.pk)
            _record(rule, ticket, event, AutomationRun.Status.FAILED,
                    "The rule's conditions could not be evaluated.")
            continue
        status = _run_rule(rule, ticket, event, bot)
        if rule.stop_processing and status == AutomationRun.Status.SUCCESS:
            break
