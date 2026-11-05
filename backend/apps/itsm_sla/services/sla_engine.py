"""SLA runtime engine. Computed-on-read is authoritative for the UI; the
scheduled breach sweep owns side-effects (flip breached, fire escalations)."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.itsm_core.services import hooks, log_event

from ..business_time import (
    MisconfiguredCalendar,
    add_business_minutes,
    always_open_spec,
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

logger = logging.getLogger("itsm")

FINISHED_STATES = ("stopped", "met", "breached")

# ── Approval pauses (2026-11-05c) ────────────────────────────────────────────
# An approval policy with "Pause SLA while waiting" (``ApprovalWorkflow.pause_sla``,
# snapshot on ``ApprovalRequest.pause_sla``) holds the ticket's first-response,
# resolution and assignment clocks while a request is pending — the same clocks an
# "Exclude from SLA" status pauses. Pauses the approval makes are LABELLED
# (``SLAPauseInterval.reason = "approval"``) so ending the approval releases only
# those and never a pause owned by a status or a ``pause_sla`` post-function
# (e.g. "Put on Hold"). Unlabelled pauses ("") behave exactly as before.
APPROVAL = "approval"
_APPROVAL_KINDS = ("first_response", "resolution", "assignment")


def _approval_pauses(ticket) -> bool:
    """A pending, live approval request on the ticket asks to pause the SLA."""
    mgr = getattr(ticket, "approval_requests", None)
    if mgr is None:  # itsm_approvals not installed
        return False
    return mgr.filter(is_deleted=False, status="pending", pause_sla=True).exists()


def _open_reason(tr):
    """The reason label of the tracker's open pause window ("" = status / post-function)."""
    return (tr.pauses.filter(resumed_at__isnull=True).order_by("-paused_at")
            .values_list("reason", flat=True).first())


def _set_open_reason(tr, reason):
    SLAPauseInterval.objects.filter(tracker=tr, resumed_at__isnull=True).exclude(
        reason=reason).update(reason=reason, updated_at=timezone.now())


def _pause_payload(kind, reason):
    return {"metric": kind, "reason": APPROVAL} if reason == APPROVAL else {"metric": kind}


def _do_pause(ticket, tr, now, reason=""):
    _pause_tracker(tr, now, reason)
    log_event(ticket, None, "sla_paused", payload=_pause_payload(tr.metric.kind, reason))


def _do_resume(ticket, tr, now):
    reason = _open_reason(tr)
    _close_open_pause(tr, now)
    tr.state = "running"
    tr.save(update_fields=["state", "paused_at", "total_paused_minutes", "updated_at"])
    recompute(tr)
    log_event(ticket, None, "sla_resumed", payload=_pause_payload(tr.metric.kind, reason))


def _default_calendar():
    return BusinessCalendar.objects.filter(is_default=True).first() or BusinessCalendar.objects.first()


def _spec(tracker, cache=None):
    """The business-time spec a tracker is measured in. ``cache`` (a dict keyed by
    ``calendar_id``) lets a caller measuring many trackers — the queue page, the breach
    sweep — read each calendar once instead of once per tracker."""
    key = tracker.calendar_id
    if cache is not None and key in cache:
        return cache[key]
    cal = tracker.calendar if key else _default_calendar()
    spec = _spec_for_cal(cal)
    if cache is not None:
        cache[key] = spec
    return spec


def _spec_for_cal(cal):
    # No calendar at all → 24/7 UTC. A calendar with no hours → 24/7 in its tz
    # (handled inside spec_from_calendar).
    return spec_from_calendar(cal) if cal is not None else always_open_spec()


def _due(spec, start, minutes):
    """``start + minutes`` of business time. If the calendar can't place it (budget
    beyond the 2-year horizon) fall back to wall-clock minutes — never "due now",
    which instantly breached every clock."""
    try:
        return add_business_minutes(spec, start, minutes)
    except MisconfiguredCalendar:
        logger.warning("SLA calendar can't place %s business minutes after %s; using wall-clock time.",
                       minutes, start)
        return start + timedelta(minutes=minutes)


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
    # The tenant-wide fallback must only ever match the GLOBAL default —
    # a project-scoped policy flagged is_default on some other project must
    # never hijack resolution for the rest of the tenant.
    return (candidates.filter(is_default=True).first()
            or SLAPolicy.objects.filter(
                project__isnull=True, is_default=True, is_active=True
            ).first())


def _target_minutes(metric, priority):
    """The metric's budget for ``priority``, or ``None`` when that priority has no
    target. A blank target means NO SLA for that priority — there is deliberately no
    fallback to another priority's target or a default."""
    if not priority:
        return None
    for t in metric.targets.all():  # prefetched by resolve_policy / on_priority_change
        if t.priority == priority:
            return t.target_minutes
    return None


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
        # all_objects: a clock withdrawn by a priority change (soft-deleted) still
        # owns the (ticket, metric) slot — on_priority_change restores it.
        if SLATracker.all_objects.filter(ticket=ticket, metric=metric).exists():
            continue
        target = _target_minutes(metric, ticket.priority)
        if target is None:
            continue  # blank target → no SLA clock for this priority
        due = _due(_spec_for_cal(cal), now, target)
        tr = SLATracker.objects.create(
            ticket=ticket, metric=metric, calendar=cal, target_minutes=target,
            started_at=now, due_at=due, state="running",
        )
        created.append(tr)
    if created:
        log_event(ticket, None, "sla_started", payload={"metrics": [t.metric.kind for t in created]})
        # An approval started on the create transition (or a catalog item) is already
        # pending: its "Pause SLA while waiting" holds the new clocks from the start.
        if _approval_pauses(ticket):
            for tr in created:
                if tr.metric.kind in _APPROVAL_KINDS:
                    _do_pause(ticket, tr, now, APPROVAL)
        _sync_due_date(ticket)
    return created


def _sync_due_date(ticket):
    """Mirror the resolution SLA due_at onto Ticket.due_date for queue display (the
    only writer of due_date). No live resolution clock → cleared."""
    from apps.itsm_tickets.models import Ticket
    res = SLATracker.objects.filter(ticket=ticket, metric__kind="resolution").first()
    Ticket.objects.filter(pk=ticket.pk).update(due_date=res.due_at if res else None)


def recompute(tracker):
    """Re-derive due_at from first principles (budget + paused). Idempotent."""
    tracker.due_at = _due(_spec(tracker), tracker.started_at,
                          tracker.target_minutes + tracker.total_paused_minutes)
    tracker.save(update_fields=["due_at", "updated_at"])


def _find(ticket, metric_kind):
    return SLATracker.objects.filter(ticket=ticket, metric__kind=metric_kind).first()


def _close_open_pause(tr, now):
    """Close the tracker's open pause window (if any), adding its business minutes to
    ``total_paused_minutes``. The caller saves the tracker."""
    interval = tr.pauses.filter(resumed_at__isnull=True).order_by("-paused_at").first()
    if interval:
        tr.total_paused_minutes += business_minutes_between(_spec(tr), interval.paused_at, now)
        interval.resumed_at = now
        interval.save(update_fields=["resumed_at", "updated_at"])
    tr.paused_at = None


def pause(ticket, metric_kind):
    """Pause a running clock (the ``pause_sla`` post-function / hook). On a clock an
    approval already holds, it takes the pause over (label → "") so the pause outlives
    the approval."""
    tr = _find(ticket, metric_kind)
    if not tr:
        return
    if tr.state == "paused":
        if metric_kind in _APPROVAL_KINDS and _open_reason(tr) == APPROVAL:
            _set_open_reason(tr, "")
        return
    if tr.state != "running":
        return
    _do_pause(ticket, tr, timezone.now())


def _pause_tracker(tr, now, reason=""):
    tr.state = "paused"
    tr.paused_at = now
    tr.save(update_fields=["state", "paused_at", "updated_at"])
    SLAPauseInterval.objects.create(tracker=tr, paused_at=now, reason=reason)


def resume(ticket, metric_kind):
    """Resume a paused clock (the ``resume_sla`` post-function / hook) — unless a
    pending approval that pauses the SLA still holds it; the approval then owns the
    pause and releases it when decided (``sync_pauses``)."""
    tr = _find(ticket, metric_kind)
    if not tr or tr.state != "paused":
        return
    if metric_kind in _APPROVAL_KINDS and _approval_pauses(ticket):
        _set_open_reason(tr, APPROVAL)
        return
    _do_resume(ticket, tr, timezone.now())


def stop(ticket, metric_kind):
    tr = _find(ticket, metric_kind)
    if not tr or tr.state in FINISHED_STATES:
        return
    now = timezone.now()
    if tr.state == "paused":
        # Resolving straight from a paused status (e.g. Pending): the hold still
        # doesn't count — close the pause and re-derive due before judging met/breached.
        _close_open_pause(tr, now)
        tr.due_at = _due(_spec(tr), tr.started_at, tr.target_minutes + tr.total_paused_minutes)
    tr.stopped_at = now
    if now > tr.due_at:
        tr.state, tr.breached, tr.breached_at = "breached", True, tr.breached_at or now
    else:
        tr.state = "met"
    tr.save(update_fields=["stopped_at", "state", "breached", "breached_at", "paused_at",
                           "total_paused_minutes", "due_at", "updated_at"])


def withdraw_for_ticket(ticket):
    """Freeze every unfinished clock of a deleted ticket as ``stopped`` (neither met
    nor breached) so the sweep never touches it again. Called only by
    ``ticket_service.delete_ticket``. Returns the number of clocks stopped."""
    now = timezone.now()
    n = 0
    for tr in (SLATracker.objects.select_for_update(of=("self",))
               .filter(ticket=ticket).exclude(state__in=FINISHED_STATES)):
        if tr.state == "paused":
            _close_open_pause(tr, now)
        tr.state, tr.stopped_at = "stopped", now
        tr.save(update_fields=["state", "stopped_at", "paused_at", "total_paused_minutes",
                               "updated_at"])
        n += 1
    return n


def on_status_change(ticket, from_status, to_status):
    """Pause/resume/stop clocks as the ticket moves through statuses.

    A status flagged ``pauses_sla`` ("Exclude from SLA calculation") pauses **all**
    of the ticket's running clocks while it sits there and resumes them on leaving —
    the literal "SLA not calculated on hold". This is read off ``to_status`` with
    ``getattr`` because the cross-engine hook that calls us swallows exceptions, so an
    ``AttributeError`` here would silently disable pausing rather than surface. The
    legacy per-metric ``SLAMetric.pause_statuses`` keeps working for the resolution
    clock (unioned with the flag).

    A pending approval with "Pause SLA while waiting" also holds the first-response,
    resolution and assignment clocks (2026-11-05c): a status change never resumes a
    clock the approval holds, and a pause only the approval holds is labelled
    ``"approval"`` so the approval's end releases it (``sync_pauses``).
    """
    to_done = to_status.category.key == "done"
    to_key = to_status.key
    excluded = getattr(to_status, "pauses_sla", False)  # per-status exclude-from-SLA flag
    approval = None  # looked up once, only when a live clock needs it
    for tr in SLATracker.objects.filter(ticket=ticket).select_related("metric"):
        if tr.state in FINISHED_STATES:
            continue
        kind = tr.metric.kind
        pause_keys = tr.metric.pause_statuses or []
        if kind == "resolution":
            if to_done:
                stop(ticket, "resolution")
                continue
            status_pause = excluded or (to_key in pause_keys)  # union: flag OR legacy pause_statuses
        elif kind == "first_response":
            # First response is satisfied either by the first public reply
            # (add_comment → sla_stop) or by resolving the ticket. Merely moving
            # to an in-progress status no longer counts — picking a ticket up is
            # not a response to the requester. See itsm-sla BUG_LOG (ITINC-606).
            # A ``pauses_sla`` status still pauses it (resumes on leaving) so the
            # response clock does not burn while the ticket is on hold.
            if to_done:
                stop(ticket, "first_response")
                continue
            status_pause = excluded
        elif kind == "assignment":
            if ticket.assignee_id and tr.state == "running":
                stop(ticket, "assignment")
                continue
            status_pause = excluded
        else:
            continue
        if approval is None:
            approval = _approval_pauses(ticket)
        _apply_pause(ticket, tr, status_pause, approval)


def _apply_pause(ticket, tr, status_pause, approval):
    """Bring one live clock in line with "paused by the status" / "held by an approval".
    With no approval this is exactly the old rule: pause on entering, resume on leaving."""
    if status_pause or approval:
        if tr.state == "running":
            _do_pause(ticket, tr, timezone.now(), "" if status_pause else APPROVAL)
        elif tr.state == "paused" and approval:
            # Whoever holds it now owns the open window: the status ("") or only the approval.
            _set_open_reason(tr, "" if status_pause else APPROVAL)
    elif tr.state == "paused":
        _do_resume(ticket, tr, timezone.now())


def _status_pauses(status, metric):
    """Would the status alone keep this metric paused (``pauses_sla`` / pause_statuses)?"""
    excluded = bool(getattr(status, "pauses_sla", False))
    if metric.kind == "resolution":
        return excluded or status.key in (metric.pause_statuses or [])
    if metric.kind in ("first_response", "assignment"):
        return excluded
    return False


@transaction.atomic
def sync_pauses(ticket):
    """Match the ticket's clocks to its approvals (after an approval starts, is decided,
    cancelled or withdrawn). Re-reads the ticket: post-commit, the caller's copy can
    still show the old (waiting) status. While an approval that pauses the SLA is
    pending, running clocks pause (label "approval", or "" when the status pauses them
    too). Once none is, only approval-labelled pauses are released — re-labelled ""
    when the status still pauses the clock, else resumed. Idempotent."""
    from apps.itsm_tickets.models import Ticket

    t = Ticket.objects.select_related("status", "status__category").filter(pk=ticket.pk).first()
    if t is None or getattr(t, "is_deleted", False):
        return
    approval = _approval_pauses(t)
    now = timezone.now()
    resumed_resolution = False
    for tr in (SLATracker.objects.select_for_update(of=("self",))
               .filter(ticket=t).select_related("metric")):
        kind = tr.metric.kind
        if tr.state in FINISHED_STATES or kind not in _APPROVAL_KINDS:
            continue
        status_holds = _status_pauses(t.status, tr.metric)
        if approval:
            if tr.state == "running":
                _do_pause(t, tr, now, "" if status_holds else APPROVAL)
        elif tr.state == "paused" and _open_reason(tr) == APPROVAL:
            if status_holds:
                _set_open_reason(tr, "")
            else:
                _do_resume(t, tr, now)
                resumed_resolution = resumed_resolution or kind == "resolution"
    if resumed_resolution:
        _sync_due_date(t)


# ── Priority change: re-target / withdraw / restore / start clocks ───────────

def _should_pause(ticket, metric, approval=False):
    """Would ``on_status_change`` keep this metric paused — by the ticket's status, or
    (for the approval kinds) by a pending approval that pauses the SLA?"""
    return _status_pauses(ticket.status, metric) or (approval and metric.kind in _APPROVAL_KINDS)


def _already_stopped(ticket, kind):
    """The event that stops this kind of clock has already happened."""
    if ticket.status.category.key == "done":
        return True
    if kind == "first_response":
        return ticket.first_responded_at is not None
    if kind == "assignment":
        return bool(ticket.assignee_id)
    return False


def _human(mins):
    if mins is None:
        return "no SLA"
    m = int(mins)
    d, h, r = m // 1440, (m % 1440) // 60, m % 60
    return " ".join(p for p in (f"{d}d" if d else "", f"{h}h" if h else "", f"{r}m" if r else "")
                    if p) or "0m"


@transaction.atomic
def on_priority_change(ticket, old_priority, new_priority, *, start_missing=True):
    """Re-evaluate the ticket's unfinished SLA clocks as if it had always had
    ``new_priority``. Finished clocks (met / breached by a reply, resolve or assign)
    are history and are never touched.

    - live running/paused clock, new priority has a target → target replaced; start
      and pauses kept (elapsed business time kept), due re-derived, breach flag
      re-derived (the sweep re-flags a still-overdue clock within a minute);
    - new priority has NO target (blank = no SLA) → the clock is **withdrawn**: its
      open pause is closed and the row soft-deleted, so the ticket looks exactly like
      one created at that priority and the clock never counts as met or breached;
    - a withdrawn clock whose new priority has a target again → restored, from its
      original start (the withdrawn time counts as elapsed);
    - no clock for a metric yet → started from when it would have started (the
      ticket's earliest clock, else its creation time), unless the event that stops
      it already happened (resolved / replied / assigned).

    Uses the policy of the ticket's existing clocks; only a ticket with none falls
    back to ``resolve_policy``. ``start_missing=False`` (project move) never looks a
    policy up — a moved ticket keeps its source clocks. Logs one ``field_changed``
    ("SLA targets") audit row when anything changed. Returns the change list."""
    if old_priority == new_priority:
        return []
    now = timezone.now()
    rows = list(SLATracker.all_objects.select_for_update(of=("self",))
                .filter(ticket=ticket).select_related("metric"))
    by_metric = {tr.metric_id: tr for tr in rows}
    policy_ids = {tr.metric.policy_id for tr in rows}
    policy = None
    if policy_ids:
        metrics = list(SLAMetric.objects.filter(policy_id__in=policy_ids).prefetch_related("targets"))
    elif start_missing:
        policy = resolve_policy(ticket)
        if policy is None:
            return []
        metrics = list(policy.metrics.all())
    else:
        return []

    if rows:
        cal_id = rows[0].calendar_id
        cal = rows[0].calendar if cal_id else None
        clock_start = min(tr.started_at for tr in rows)
    else:
        cal = getattr(ticket.project, "calendar", None) or policy.calendar or _default_calendar()
        clock_start = ticket.created_at
    changes = []
    approval = None  # pending approval holding the clocks? looked up once, on demand
    for metric in metrics:
        target = _target_minutes(metric, new_priority)
        tr = by_metric.get(metric.id)
        if tr is not None and not tr.is_deleted and tr.state in FINISHED_STATES:
            continue  # finished — history
        if target is None:
            if tr is not None and not tr.is_deleted:
                if tr.state == "paused":
                    _close_open_pause(tr, now)
                    tr.state = "running"
                old_target, old_due = tr.target_minutes, tr.due_at
                tr.breached, tr.breached_at = False, None
                tr.save(update_fields=["state", "paused_at", "total_paused_minutes",
                                       "breached", "breached_at", "updated_at"])
                tr.soft_delete()
                changes.append({"metric": metric.kind, "name": metric.name, "action": "withdrawn",
                                "old_target": old_target, "new_target": None,
                                "old_due": old_due.isoformat(), "new_due": None})
            continue
        if tr is None or tr.is_deleted:
            if _already_stopped(ticket, metric.kind):
                continue
            if tr is None:
                tr = SLATracker(ticket=ticket, metric=metric, calendar=cal, started_at=clock_start,
                                state="running", target_minutes=target, due_at=clock_start)
                action = "started"
            else:
                tr.is_deleted, tr.deleted_at, tr.deleted_by = False, None, None
                tr.state, tr.stopped_at = "running", None
                action = "restored"
            tr.target_minutes = target
            tr.due_at = _due(_spec(tr), tr.started_at, target + tr.total_paused_minutes)
            tr.breached, tr.breached_at = False, None
            tr.save()
            if approval is None:
                approval = _approval_pauses(ticket)
            if _should_pause(ticket, metric, approval):
                status_holds = _status_pauses(ticket.status, metric)
                _pause_tracker(tr, now, "" if status_holds else APPROVAL)
            changes.append({"metric": metric.kind, "name": metric.name, "action": action,
                            "old_target": None, "new_target": target,
                            "old_due": None, "new_due": tr.due_at.isoformat()})
            continue
        if tr.target_minutes == target:
            continue
        old_target, old_due = tr.target_minutes, tr.due_at
        tr.target_minutes = target
        tr.due_at = _due(_spec(tr), tr.started_at, target + tr.total_paused_minutes)
        ref = tr.paused_at if (tr.state == "paused" and tr.paused_at) else now
        if tr.breached and ref <= tr.due_at:
            tr.breached, tr.breached_at = False, None  # no longer past the (new) due
        tr.save(update_fields=["target_minutes", "due_at", "breached", "breached_at", "updated_at"])
        changes.append({"metric": metric.kind, "name": metric.name, "action": "retargeted",
                        "old_target": old_target, "new_target": target,
                        "old_due": old_due.isoformat(), "new_due": tr.due_at.isoformat()})

    if changes:
        log_event(ticket, None, "field_changed", field_key="sla", payload={
            "name": "SLA targets",
            "old": " · ".join(f"{c['name']} {_human(c['old_target'])}" for c in changes),
            "new": " · ".join(f"{c['name']} {_human(c['new_target'])}" for c in changes),
            "reason": "priority_changed",
            "old_priority": old_priority, "new_priority": new_priority,
            "changes": [{k: v for k, v in c.items() if k != "name"} for c in changes],
        })
        _sync_due_date(ticket)
    return changes


# ── Reading a clock ──────────────────────────────────────────────────────────

def elapsed_minutes(tracker, now=None, cache=None):
    """Business minutes the clock has run, excluding pauses. Frozen while paused
    (measured to ``paused_at``) and once stopped (to ``stopped_at``)."""
    now = now or timezone.now()
    end = tracker.stopped_at or (tracker.paused_at if tracker.state == "paused" else None) or now
    gross = business_minutes_between(_spec(tracker, cache), tracker.started_at, end)
    return max(0.0, gross - tracker.total_paused_minutes)


def timer_snapshot(tracker, now=None, calendar_cache=None):
    """Public business-time view of one SLA clock — the single source for the ticket
    SLA panel, the queue's SLA bars and (WS5) the dashboard's at-risk counts.

    Returns ``{elapsed_minutes, percent_used, breached, rag}``: ``percent_used`` =
    business minutes elapsed ÷ target × 100 (not clamped; > 100 when overdue);
    ``breached`` = recorded breach, or a running clock past ``due_at``; ``rag`` =
    finished clocks red if breached else green, otherwise red at ≥ 100% or breached,
    amber at ≥ 75%, else green. Pass the same ``calendar_cache`` dict for every
    tracker in a batch so each calendar is read once (constant queries per page)."""
    now = now or timezone.now()
    elapsed = elapsed_minutes(tracker, now, calendar_cache)
    target = tracker.target_minutes
    pct = (elapsed / target * 100.0) if target else (100.0 if elapsed > 0 else 0.0)
    breached = bool(tracker.breached) or (tracker.state == "running" and now > tracker.due_at)
    if tracker.state in FINISHED_STATES:
        rag = "red" if breached else "green"
    elif breached or pct >= 100.0:
        rag = "red"
    elif pct >= 75.0:
        rag = "amber"
    else:
        rag = "green"
    return {"elapsed_minutes": elapsed, "percent_used": round(pct, 1), "breached": breached, "rag": rag}


def countdown_payload(tracker, calendar_cache=None, *, with_reason=False):
    """The SLA panel's view of one clock. ``with_reason`` adds ``pause_reason``
    ("approval" while a pending approval holds the clock, else None) — one extra
    query, so only the ticket SLA endpoint asks for it, never the queue list."""
    now = timezone.now()
    snap = timer_snapshot(tracker, now, calendar_cache)
    elapsed = snap["elapsed_minutes"]
    extra = {}
    if with_reason:
        extra["pause_reason"] = (APPROVAL if tracker.state == "paused"
                                 and _open_reason(tracker) == APPROVAL else None)
    return {**extra, 
        "metric": tracker.metric.kind,
        "metric_name": tracker.metric.name,
        "state": tracker.state,
        "due_at": tracker.due_at.isoformat(),
        "paused": tracker.state == "paused",
        "breached": snap["breached"],
        "target_minutes": tracker.target_minutes,
        "elapsed_minutes": round(elapsed, 1),
        "remaining_minutes": round(tracker.target_minutes - elapsed, 1),
        "percent_used": snap["percent_used"],
        "rag": snap["rag"],
    }


def scan_breaches():
    """Scheduler entry point. Flip breached state + fire escalations idempotently."""
    now = timezone.now()
    fired = 0
    cache = {}
    # A deleted ticket's clocks are stopped by delete_ticket; the filter also covers
    # tickets deleted before that existed (BUG_LOG 2026-10-29: REQ14 kept emailing).
    trackers = (SLATracker.objects.filter(state="running", ticket__is_deleted=False)
                .select_related("ticket", "metric"))
    for tr in trackers:
        try:
            with transaction.atomic():
                fired += _scan_tracker(tr, now, cache)
        except Exception:  # noqa: BLE001 — one bad clock must not stop the org's sweep
            logger.exception("SLA sweep failed for tracker %s", tr.pk)
    return {"breaches_scanned": fired}


def _scan_tracker(tr, now, cache):
    fired = 0
    elapsed = elapsed_minutes(tr, now, cache)
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
    return fired


def _run_escalation(esc, tracker):
    ticket = tracker.ticket
    if esc.action == "notify":
        event = "SLABreach" if esc.threshold_pct >= 100 else "SLAWarning"
        hooks.emit_event(event, ticket, context={"metric": tracker.metric.kind, "threshold": esc.threshold_pct})
    elif esc.action == "raise_priority":
        order = ["p4", "p3", "p2", "p1"]  # ascending severity; raise == step toward P1
        idx = min(order.index(ticket.priority) + 1, len(order) - 1) if ticket.priority in order else 2
        # Through the single write site: audits priority_changed {old, new}, runs
        # automation rules, and re-targets the SLA clocks via hooks.sla_priority_changed.
        from apps.itsm_tickets.services import ticket_service
        ticket_service.update_ticket(ticket=ticket, user=None, priority=order[idx])
    elif esc.action == "reassign":
        target = (esc.config or {}).get("group_lead")
        if target:
            from apps.itsm_tickets.services import ticket_service
            ticket_service.assign(ticket=ticket, assignee_id=target, user=None)
