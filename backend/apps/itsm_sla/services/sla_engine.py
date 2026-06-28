"""SLA runtime engine. Computed-on-read is authoritative for the UI; the
scheduled breach sweep owns side-effects (flip breached, fire escalations)."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.itsm_core.services import hooks, log_event

from ..business_time import (
    MisconfiguredCalendar,
    add_business_minutes,
    business_minutes_between,
    spec_from_calendar,
)
from ..models import (
    BusinessCalendar,
    EscalationRule,
    SLAEscalationLog,
    SLAMetric,
    SLAPauseInterval,
    SLAPolicy,
    SLATracker,
)


def _default_calendar():
    return BusinessCalendar.objects.filter(is_default=True).first() or BusinessCalendar.objects.first()


def _spec(tracker):
    cal = tracker.calendar or _default_calendar()
    if cal is None:
        # 24/7 fallback
        from datetime import time
        from ..business_time import CalendarSpec
        return CalendarSpec(timezone="UTC",
                            windows={d: [(time(0, 0), time(23, 59))] for d in range(7)})
    return spec_from_calendar(cal)


def resolve_policy(ticket):
    """Most specific active policy for the ticket's project (applies_to match), else default."""
    candidates = SLAPolicy.objects.filter(is_active=True, is_deleted=False).filter(
        project=ticket.project
    ).prefetch_related("metrics__targets")
    for p in candidates:
        spec = p.applies_to or {}
        if spec.get("priority") and ticket.priority not in spec["priority"]:
            continue
        if spec.get("ticket_type") and str(ticket.ticket_type_id) not in [str(x) for x in spec["ticket_type"]]:
            continue
        return p
    return (candidates.filter(is_default=True).first()
            or SLAPolicy.objects.filter(is_default=True, is_active=True).first())


def _target_minutes(metric, priority):
    t = metric.targets.filter(priority=priority).first() or metric.targets.first()
    return t.target_minutes if t else 480


@transaction.atomic
def start_trackers(ticket):
    policy = resolve_policy(ticket)
    if policy is None:
        return []
    # A project may pin its own business calendar; that wins over the policy's
    # calendar and the global default. The per-tracker `calendar` snapshot below
    # freezes this choice so later config edits don't strand in-flight clocks.
    cal = getattr(ticket.project, "calendar", None) or policy.calendar or _default_calendar()
    now = timezone.now()
    created = []
    for metric in policy.metrics.all():
        if SLATracker.objects.filter(ticket=ticket, metric=metric).exists():
            continue
        target = _target_minutes(metric, ticket.priority)
        try:
            due = add_business_minutes(_spec_for_cal(cal), now, target)
        except MisconfiguredCalendar:
            due = now
        tr = SLATracker.objects.create(
            ticket=ticket, metric=metric, calendar=cal, target_minutes=target,
            started_at=now, due_at=due, state="running",
        )
        created.append(tr)
    if created:
        log_event(ticket, None, "sla_started", payload={"metrics": [t.metric.kind for t in created]})
        _sync_due_date(ticket)
    return created


def _spec_for_cal(cal):
    if cal is None:
        from datetime import time
        from ..business_time import CalendarSpec
        return CalendarSpec(timezone="UTC", windows={d: [(time(0, 0), time(23, 59))] for d in range(7)})
    return spec_from_calendar(cal)


def _sync_due_date(ticket):
    """Mirror the resolution SLA due_at onto Ticket.due_date for queue display."""
    from apps.itsm_tickets.models import Ticket
    res = SLATracker.objects.filter(ticket=ticket, metric__kind="resolution").first()
    if res:
        Ticket.objects.filter(pk=ticket.pk).update(due_date=res.due_at)


def recompute(tracker):
    """Re-derive due_at from first principles (budget + paused). Idempotent."""
    spec = _spec(tracker)
    try:
        tracker.due_at = add_business_minutes(
            spec, tracker.started_at, tracker.target_minutes + tracker.total_paused_minutes
        )
    except MisconfiguredCalendar:
        pass
    tracker.save(update_fields=["due_at", "updated_at"])


def _find(ticket, metric_kind):
    return SLATracker.objects.filter(ticket=ticket, metric__kind=metric_kind).first()


def pause(ticket, metric_kind):
    tr = _find(ticket, metric_kind)
    if not tr or tr.state != "running":
        return
    now = timezone.now()
    tr.state = "paused"
    tr.paused_at = now
    tr.save(update_fields=["state", "paused_at", "updated_at"])
    SLAPauseInterval.objects.create(tracker=tr, paused_at=now)
    log_event(ticket, None, "sla_paused", payload={"metric": metric_kind})


def resume(ticket, metric_kind):
    tr = _find(ticket, metric_kind)
    if not tr or tr.state != "paused":
        return
    now = timezone.now()
    interval = tr.pauses.filter(resumed_at__isnull=True).order_by("-paused_at").first()
    if interval:
        paused_business = business_minutes_between(_spec(tr), interval.paused_at, now)
        interval.resumed_at = now
        interval.save(update_fields=["resumed_at", "updated_at"])
        tr.total_paused_minutes += paused_business
    tr.state = "running"
    tr.paused_at = None
    tr.save(update_fields=["state", "paused_at", "total_paused_minutes", "updated_at"])
    recompute(tr)
    log_event(ticket, None, "sla_resumed", payload={"metric": metric_kind})


def stop(ticket, metric_kind):
    tr = _find(ticket, metric_kind)
    if not tr or tr.state in ("stopped", "met", "breached"):
        return
    now = timezone.now()
    tr.stopped_at = now
    if now > tr.due_at:
        tr.state, tr.breached, tr.breached_at = "breached", True, tr.breached_at or now
    else:
        tr.state = "met"
    tr.save(update_fields=["stopped_at", "state", "breached", "breached_at", "updated_at"])


def on_status_change(ticket, from_status, to_status):
    """Pause/resume/stop clocks as the ticket moves through statuses."""
    to_done = to_status.category.key == "done"
    to_key = to_status.key
    for tr in SLATracker.objects.filter(ticket=ticket).select_related("metric"):
        if tr.state in ("stopped", "met", "breached"):
            continue
        kind = tr.metric.kind
        pause_keys = tr.metric.pause_statuses or []
        if kind == "resolution":
            if to_done:
                stop(ticket, "resolution")
            elif to_key in pause_keys and tr.state == "running":
                pause(ticket, "resolution")
            elif to_key not in pause_keys and tr.state == "paused":
                resume(ticket, "resolution")
        elif kind == "first_response":
            # First response is satisfied either by the first public reply
            # (add_comment → sla_stop) or by resolving the ticket. Merely moving
            # to an in-progress status no longer counts — picking a ticket up is
            # not a response to the requester. See itsm-sla BUG_LOG (ITINC-606).
            if to_done and tr.state == "running":
                stop(ticket, "first_response")
        elif kind == "assignment":
            if ticket.assignee_id and tr.state == "running":
                stop(ticket, "assignment")


def elapsed_minutes(tracker, now=None):
    now = now or timezone.now()
    end = tracker.stopped_at or now
    gross = business_minutes_between(_spec(tracker), tracker.started_at, end)
    return max(0.0, gross - tracker.total_paused_minutes)


def countdown_payload(tracker):
    now = timezone.now()
    elapsed = elapsed_minutes(tracker, now)
    target = tracker.target_minutes or 1
    pct = elapsed / target
    breached = tracker.breached or (tracker.state == "running" and now > tracker.due_at)
    rag = "red" if (breached or pct >= 1.0) else ("amber" if pct >= 0.75 else "green")
    return {
        "metric": tracker.metric.kind,
        "metric_name": tracker.metric.name,
        "state": tracker.state,
        "due_at": tracker.due_at.isoformat(),
        "paused": tracker.state == "paused",
        "breached": breached,
        "target_minutes": tracker.target_minutes,
        "elapsed_minutes": round(elapsed, 1),
        "remaining_minutes": round(tracker.target_minutes - elapsed, 1),
        "rag": rag,
    }


def scan_breaches():
    """Scheduler entry point. Flip breached state + fire escalations idempotently."""
    now = timezone.now()
    fired = 0
    for tr in SLATracker.objects.filter(state="running").select_related("ticket", "metric"):
        elapsed = elapsed_minutes(tr, now)
        pct = (elapsed / tr.target_minutes * 100) if tr.target_minutes else 0
        # breach
        if now > tr.due_at and not tr.breached:
            tr.breached = True
            tr.breached_at = now
            tr.save(update_fields=["breached", "breached_at", "updated_at"])
            log_event(tr.ticket, None, "sla_breached", payload={"metric": tr.metric.kind})
            hooks.emit_event("SLABreach", tr.ticket, context={"metric": tr.metric.kind})
        # threshold escalations
        for esc in EscalationRule.objects.filter(metric=tr.metric, is_deleted=False):
            if pct >= esc.threshold_pct:
                _, created = SLAEscalationLog.objects.get_or_create(tracker=tr, threshold_pct=esc.threshold_pct)
                if created:
                    fired += 1
                    _run_escalation(esc, tr)
    return {"breaches_scanned": fired}


def _run_escalation(esc, tracker):
    ticket = tracker.ticket
    if esc.action == "notify":
        event = "SLABreach" if esc.threshold_pct >= 100 else "SLAWarning"
        hooks.emit_event(event, ticket, context={"metric": tracker.metric.kind, "threshold": esc.threshold_pct})
    elif esc.action == "raise_priority":
        order = ["low", "medium", "high", "critical"]
        from apps.itsm_tickets.models import Ticket
        idx = min(order.index(ticket.priority) + 1, len(order) - 1) if ticket.priority in order else 2
        Ticket.objects.filter(pk=ticket.pk).update(priority=order[idx])
        log_event(ticket, None, "priority_changed", payload={"new": order[idx], "by": "sla_escalation"})
    elif esc.action == "reassign":
        target = (esc.config or {}).get("group_lead")
        if target:
            from apps.itsm_tickets.services import ticket_service
            ticket_service.assign(ticket=ticket, assignee_id=target, user=None)
