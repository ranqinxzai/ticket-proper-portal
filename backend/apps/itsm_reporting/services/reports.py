"""Live operational reports — ORM aggregations over Ticket (+ SLATracker when present).

These read live data (cheap with the Ticket composite indexes). Heavy historical
trends can later be backed by the nightly snapshot tables; the API shape is stable.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.db.models import Avg, Count
from django.utils import timezone


def _base(project=None, group=None, date_from=None, date_to=None, helpdesk_ids=None,
          project_ids=None):
    from apps.itsm_tickets.models import Ticket
    qs = Ticket.objects.filter(is_deleted=False)
    # Helpdesk clamp (None ⇒ unrestricted/superuser). Always applied first so no
    # report can roll up another helpdesk's volumes.
    if helpdesk_ids is not None:
        qs = qs.filter(project__helpdesk_id__in=helpdesk_ids)
    # Finer per-user project clamp (strict whitelist; None ⇒ unrestricted).
    if project_ids is not None:
        qs = qs.filter(project_id__in=project_ids)
    if project:
        qs = qs.filter(project_id=project)
    if group:
        qs = qs.filter(assigned_group_id=group)
    # `__date` lookups so a plain YYYY-MM-DD bound is inclusive of the whole day
    # (a `created_at__lte=<date>` would truncate to midnight and drop everything
    # created on the `to` day itself). The day boundary is computed in the DB/server
    # timezone — settings.TIME_ZONE is UTC, so this is the UTC calendar day, not the
    # viewer's local day (a ~few tickets near a tz day-edge attribute to the UTC day).
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)
    return qs


def open_tickets(**f):
    qs = _base(**f).exclude(status__category__key="done")
    return {"total": qs.count(),
            "by_project": list(qs.values("project__key").annotate(n=Count("id")).order_by("-n"))}


def by_status(**f):
    # Group by status *id* too so each row carries a single drill-down target
    # (``status_id``) — the dashboard turns a segment click into a queue filter
    # ``{field:"status", op:"eq", value:<id>}``. Shared workflows keep ids stable
    # across a helpdesk's projects, so this rarely fragments same-named statuses.
    rows = _base(**f).values(
        "status_id", "status__name", "status__color", "status__category__key").annotate(
        n=Count("id")).order_by("-n")
    return [{"label": r["status__name"], "color": r["status__color"],
             "category": r["status__category__key"], "status_id": str(r["status_id"])
             if r["status_id"] else None, "value": r["n"]} for r in rows]


def by_priority(**f):
    # ``label`` is the raw priority code (p1..p4) — itself the drill-down filter value.
    rows = _base(**f).values("priority").annotate(n=Count("id")).order_by("priority")
    return [{"label": r["priority"], "value": r["n"]} for r in rows]


def by_group(**f):
    # ``group_id`` is the drill-down target (null ⇒ "Unassigned" ⇒ the queue filter
    # ``{field:"assigned_group", op:"is_empty"}``).
    rows = _base(**f).values("assigned_group_id", "assigned_group__name").annotate(
        n=Count("id")).order_by("-n")
    return [{"label": r["assigned_group__name"] or "Unassigned",
             "group_id": str(r["assigned_group_id"]) if r["assigned_group_id"] else None,
             "value": r["n"]} for r in rows]


def by_source(**f):
    """Ticket volume by intake source (agent / portal / email / phone / api). The
    ``label`` (source code) is itself the drill-down filter value
    (``{field:"source", op:"eq", value:<code>}``)."""
    rows = _base(**f).values("source").annotate(n=Count("id")).order_by("-n")
    return [{"label": r["source"] or "unknown", "value": r["n"]} for r in rows]


# Scope-only kwargs (no dates) — for reports whose date range applies to a field
# other than ``created_at`` (resolved_at / breached_at) or not at all (live backlog).
_SCOPE_KEYS = ("project", "group", "helpdesk_ids", "project_ids")


def _scope_only(f):
    return {k: f[k] for k in _SCOPE_KEYS if k in f}


def _report_scope(f):
    """Scope + created-date kwargs understood by ``_base`` (drops ``days`` etc.)."""
    return {k: f[k] for k in (*_SCOPE_KEYS, "date_from", "date_to") if k in f}


def _resolved_in_range(**f):
    """Tickets RESOLVED in the range (``resolved_at`` UTC day, inclusive), whenever
    they were created — assigned or not. The same set ``resolution_trends`` counts,
    so the dashboard's Avg resolution / leaderboard agree with its Resolved tile."""
    qs = _base(**_scope_only(f)).filter(resolved_at__isnull=False)
    if f.get("date_from"):
        qs = qs.filter(resolved_at__date__gte=f["date_from"])
    if f.get("date_to"):
        qs = qs.filter(resolved_at__date__lte=f["date_to"])
    return qs


def _display_name(full_name, first, last, username):
    """Full name → first + last → username (agents without a name set)."""
    return ((full_name or "").strip() or f"{first or ''} {last or ''}".strip()
            or username or "")


def _mins_to_hours(m):
    return round(m / 60, 1) if m is not None else None


def agent_performance(**f):
    """Per agent: tickets resolved in the range (business-hours average on each
    ticket's SLA calendar) + their open backlog RIGHT NOW (live — not limited by the
    range). Agents with open work but nothing resolved are listed too."""
    from django.contrib.auth import get_user_model

    from .business_hours import BusinessClock

    clock = BusinessClock()
    open_by = dict(_base(**_scope_only(f)).exclude(status__category__key="done")
                   .filter(assignee__isnull=False).order_by()
                   .values_list("assignee_id").annotate(n=Count("id")))
    resolved: dict = {}
    for aid, pid, created, done in (_resolved_in_range(**f).filter(assignee__isnull=False)
                                    .values_list("assignee_id", "project_id", "created_at",
                                                 "resolved_at").iterator()):
        resolved.setdefault(aid, []).append(
            clock.minutes(clock.project_calendar_id(pid), created, done))
    ids = set(open_by) | set(resolved)
    users = {u[0]: u[1:] for u in get_user_model().objects.filter(id__in=ids).values_list(
        "id", "full_name", "first_name", "last_name", "username")}
    rows = []
    for aid in ids:
        full, first, last, username = users.get(aid, ("", "", "", ""))
        mins = resolved.get(aid, [])
        rows.append({
            "agent": _display_name(full, first, last, username) or str(aid),
            "username": username,
            "resolved_count": len(mins),
            "open_count": open_by.get(aid, 0),
            "avg_resolution_hours": _mins_to_hours(sum(mins) / len(mins)) if mins else None,
        })
    return sorted(rows, key=lambda x: (-x["resolved_count"], -x["open_count"],
                                       x["agent"].lower()))


# SLA compliance headline metrics (assignment SLAs are deliberately left out).
_SLA_HEADLINE_KINDS = (("first_response", "First response"), ("resolution", "Resolution"))
# Cancelled / withdrawn clocks never count as met or breached.
_SLA_CANCELLED_STATES = ("stopped", "cancelled")
_OUTCOME_RANK = {"met": 0, "open": 1, "breached": 2}


def _sla_outcome(state, breached, due_at, now):
    """A clock's outcome: ``breached`` (flagged, or running past its due time),
    ``met`` (finished on time) or ``open`` (still undecided)."""
    if breached or (state == "running" and due_at and due_at < now):
        return "breached"
    if state == "met":
        return "met"
    return "open"


def _pct(met, total):
    return round(met / total * 100, 1) if total else None


def sla_compliance(**f):
    """SLA compliance = met ÷ (met + breached), counted over TICKETS.

    - Per metric (First response, Resolution): a ticket is breached if its clock of
      that kind breached (finished late, or still running past due), met if it
      finished on time; still-running-on-time clocks are not counted yet.
    - Headline (``total``/``met``/``breached``/``compliance_pct``): per ticket across
      both metrics — breached if any breached, met only if all are met.
    - Assignment SLAs and cancelled (``stopped``) clocks are excluded.
    Scope = ``_base`` (helpdesk / project / group clamps + the created-date range).
    """
    def _row(kind, label, met, breached):
        return {"metric": kind, "label": label, "total": met + breached, "met": met,
                "breached": breached, "compliance_pct": _pct(met, met + breached)}

    try:
        from apps.itsm_sla.models import SLATracker
    except (ImportError, ModuleNotFoundError):
        return {"total": 0, "met": 0, "breached": 0, "compliance_pct": None,
                "by_metric": [_row(k, lbl, 0, 0) for k, lbl in _SLA_HEADLINE_KINDS]}
    now = timezone.now()
    kinds = [k for k, _ in _SLA_HEADLINE_KINDS]
    per_kind = {k: {} for k in kinds}   # kind -> {ticket_id: worst outcome}
    per_ticket: dict = {}               # ticket_id -> worst outcome over both kinds
    qs = (SLATracker.objects
          .filter(ticket__in=_base(**_report_scope(f)), metric__kind__in=kinds)
          .exclude(state__in=_SLA_CANCELLED_STATES))
    # (``SLATracker.objects`` already hides soft-deleted — e.g. withdrawn "no target" — clocks.)
    for tid, kind, state, breached, due_at in qs.values_list(
            "ticket_id", "metric__kind", "state", "breached", "due_at").iterator():
        o = _sla_outcome(state, breached, due_at, now)
        for bucket in (per_kind[kind], per_ticket):
            if _OUTCOME_RANK[o] > _OUTCOME_RANK.get(bucket.get(tid), -1):
                bucket[tid] = o
    by_metric = []
    for kind, label in _SLA_HEADLINE_KINDS:
        vals = list(per_kind[kind].values())
        by_metric.append(_row(kind, label, vals.count("met"), vals.count("breached")))
    outcomes = list(per_ticket.values())
    met, breached = outcomes.count("met"), outcomes.count("breached")
    return {"total": met + breached, "met": met, "breached": breached,
            "compliance_pct": _pct(met, met + breached), "by_metric": by_metric}


def _as_date(v):
    """Coerce a 'YYYY-MM-DD' string (or date/datetime) to a date, or None."""
    if not v:
        return None
    if isinstance(v, str):
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return v.date() if hasattr(v, "date") and not isinstance(v, date) else v


def _window(days, date_from, date_to):
    """Resolve the trend [start, end] day window. An explicit ``date_from`` /
    ``date_to`` (the per-report date range) wins; otherwise fall back to ``days``
    back from the end (or today when no end) — so a lone ``date_to`` still yields a
    sensible window ending at that date rather than an empty start>end one. The
    dashboard (days only, no end) keeps the prior "days back from today" behaviour."""
    end = _as_date(date_to)  # None ⇒ open-ended (up to today)
    start = _as_date(date_from) or (end or timezone.now().date()) - timedelta(days=days)
    return start, end


def _daily(qs, field, start, end=None):
    rows = {}
    flt = {f"{field}__date__gte": start}
    if end:
        flt[f"{field}__date__lte"] = end
    for t in qs.filter(**flt).values_list(field, flat=True):
        if t:
            rows[t.date().isoformat()] = rows.get(t.date().isoformat(), 0) + 1
    return [{"date": d, "value": v} for d, v in sorted(rows.items())]


def volume_trends(days=30, date_from=None, date_to=None, **f):
    start, end = _window(days, date_from, date_to)
    return _daily(_base(**f), "created_at", start, end)


def resolution_trends(days=30, date_from=None, date_to=None, **f):
    start, end = _window(days, date_from, date_to)
    return _daily(_base(**f).filter(resolved_at__isnull=False), "resolved_at", start, end)


def created_vs_resolved(days=30, date_from=None, date_to=None, **f):
    """Daily created vs resolved over the window, with net (created − resolved).
    A thin combiner over the two trend series so the table reads as one report.
    Honours an explicit ``date_from``/``date_to`` range (each series windowed on
    its own field) and falls back to ``days`` when no range is given."""
    created = {r["date"]: r["value"]
               for r in volume_trends(days=days, date_from=date_from, date_to=date_to, **f)}
    resolved = {r["date"]: r["value"]
                for r in resolution_trends(days=days, date_from=date_from, date_to=date_to, **f)}
    return [{"date": d, "created": created.get(d, 0), "resolved": resolved.get(d, 0),
             "net": created.get(d, 0) - resolved.get(d, 0)}
            for d in sorted(set(created) | set(resolved))]


_PRIORITY_ORDER = {"p1": 0, "p2": 1, "p3": 2, "p4": 3}


def resolution_time_by_priority(**f):
    """Avg / min / max time-to-resolve in BUSINESS hours, per priority, over tickets
    RESOLVED in the range (assigned or not). Each ticket is measured on its SLA
    calendar (project → SLA policy → default calendar; none ⇒ wall-clock), gross of
    on-hold time. ``resolved_count`` summed over the rows equals the dashboard's
    Resolved tile for the same scope + window."""
    from .business_hours import BusinessClock

    clock = BusinessClock()
    by_prio: dict = {}
    for pid, prio, created, done in (_resolved_in_range(**f)
                                     .values_list("project_id", "priority", "created_at",
                                                  "resolved_at").iterator()):
        by_prio.setdefault(prio, []).append(
            clock.minutes(clock.project_calendar_id(pid), created, done))
    rows = [{
        "priority": prio,
        "resolved_count": len(mins),
        "avg_hours": _mins_to_hours(sum(mins) / len(mins)),
        "min_hours": _mins_to_hours(min(mins)),
        "max_hours": _mins_to_hours(max(mins)),
    } for prio, mins in by_prio.items()]
    return sorted(rows, key=lambda x: _PRIORITY_ORDER.get(x["priority"], 9))


def backlog_aging(**f):
    """Open (not-done) tickets bucketed by age since creation."""
    qs = _base(**f).exclude(status__category__key="done")
    now = timezone.now()
    # (label, older-than days, younger-than days|None)
    buckets = [("0-1d", 0, 1), ("1-3d", 1, 3), ("3-7d", 3, 7), ("7-30d", 7, 30), (">30d", 30, None)]
    rows = []
    for label, lo, hi in buckets:
        q = qs.filter(created_at__lt=now - timedelta(days=lo))
        if hi is not None:
            q = q.filter(created_at__gte=now - timedelta(days=hi))
        # ``lo``/``hi`` (age in days) let the dashboard build the equivalent
        # created-date drill-down window (open tickets created hi..lo days ago).
        rows.append({"label": label, "value": q.count(), "lo": lo, "hi": hi})
    return rows


def sla_breach_list(**f):
    """Per-ticket list of breached SLA trackers, most-recent breach first (capped).

    ``minutes_overdue`` ("Overdue by") is real lateness in BUSINESS minutes on the
    tracker's calendar — from the due time to when the clock stopped (finished late),
    froze (paused) or now (still running). Not ``breached_at − due_at``: the breach
    scanner stamps ``breached_at`` ~1 min after due, so that only measured detection
    lag. ``finished_at`` is the stop time (None ⇒ still running / paused)."""
    try:
        from apps.itsm_sla.models import SLATracker
    except (ImportError, ModuleNotFoundError):
        return []
    from .business_hours import BusinessClock

    # Same helpdesk / project / group clamps as every other report (via _base); the
    # date range filters the breach time, not the ticket's created date.
    qs = SLATracker.objects.filter(breached=True, ticket__in=_base(**_scope_only(f)))
    if f.get("date_from"):
        qs = qs.filter(breached_at__date__gte=f["date_from"])
    if f.get("date_to"):
        qs = qs.filter(breached_at__date__lte=f["date_to"])
    qs = qs.select_related(
        "ticket", "ticket__project", "metric", "ticket__assigned_group",
        "ticket__assignee").order_by("-breached_at")
    clock = BusinessClock()
    now = timezone.now()
    rows = []
    for tr in qs[:1000]:
        tk = tr.ticket
        end = tr.stopped_at or (tr.paused_at if tr.state == "paused" else None) or now
        overdue = None
        if tr.due_at:
            overdue = int(clock.minutes(clock.tracker_calendar_id(tr.calendar_id),
                                        tr.due_at, end))
        rows.append({
            "ticket_number": tk.ticket_number,
            "project_key": tk.project.key if tk.project_id else "",
            "summary": tk.summary,
            "metric": tr.metric.name if tr.metric_id else "—",
            "priority": tk.priority,
            "team": tk.assigned_group.name if tk.assigned_group_id else "Unassigned",
            "due_at": tr.due_at.isoformat() if tr.due_at else None,
            "breached_at": tr.breached_at.isoformat() if tr.breached_at else None,
            "finished_at": tr.stopped_at.isoformat() if tr.stopped_at else None,
            "minutes_overdue": overdue,
        })
    return rows


# ── "Needs attention" summary + SLA drill-down lists ────────────────────────
# The dashboard's attention tiles (unassigned / overdue / SLA at-risk / breached)
# are computed here server-side so the numbers are accurate over the WHOLE scoped
# backlog — the old client-side derivation only saw the first page of tickets per
# project and undercounted busy helpdesks.

# Cap the running/breached trackers scanned for the SLA RAG classification so one
# enormous backlog can't stall a dashboard poll. Beyond this the counts are marked
# partial (``sla_partial``); in practice a single helpdesk's open trackers sit well
# under the cap.
_SLA_SCAN_CAP = 8000
_RAG_SEVERITY = {"green": 0, "amber": 1, "red": 2}


def _open_sla_index(**f):
    """Classify each OPEN, in-scope ticket by its worst first-response/resolution
    SLA RAG, using the SAME engine function as the queue's SLA bars and the detail
    panel (``sla_engine.timer_snapshot`` — business minutes elapsed ÷ target, amber
    ≥ 75%, red when breached / ≥ 100%), so a ticket amber in the queue is "at risk"
    here. Falls back to the old wall-clock fraction only if the engine function is
    unavailable. One calendar cache is shared across the scan.

    Returns ``{ticket_id: {"ticket": Ticket, "rag": worst, "breached": any}}`` and a
    ``_partial`` marker key (``True`` when the tracker scan hit ``_SLA_SCAN_CAP``).
    """
    try:
        from apps.itsm_sla.models import SLATracker
    except (ImportError, ModuleNotFoundError):
        return {"_partial": False}
    open_ids = list(_base(**f).exclude(status__category__key="done")
                    .values_list("id", flat=True))
    agg = {"_partial": False}
    if not open_ids:
        return agg
    try:
        from apps.itsm_sla.services.sla_engine import timer_snapshot
    except (ImportError, AttributeError):  # older engine without the public reader
        timer_snapshot = None
    calendar_cache: dict = {}
    now = timezone.now()
    trackers = (SLATracker.objects
                .filter(ticket_id__in=open_ids,
                        metric__kind__in=("first_response", "resolution"))
                .select_related("ticket", "ticket__project", "ticket__status",
                                "ticket__assignee", "metric")
                .order_by("-ticket__created_at"))
    scanned = 0
    for tr in trackers[:_SLA_SCAN_CAP]:
        scanned += 1
        breached = bool(tr.breached) or (tr.state == "running" and now > tr.due_at)
        if tr.state in ("met", "stopped", "breached"):
            rag = "red" if breached else "green"   # finished: outcome only
        elif breached:
            rag = "red"                            # no need to measure elapsed time
        elif timer_snapshot is not None:
            snap = timer_snapshot(tr, now, calendar_cache)
            rag, breached = snap["rag"], bool(snap["breached"])
        else:
            span = (tr.due_at - tr.started_at).total_seconds()
            frac = ((now - tr.started_at).total_seconds() / span) if span > 0 else 1.0
            rag = "red" if frac >= 1.0 else "amber" if frac >= 0.75 else "green"
        entry = agg.get(tr.ticket_id)
        if entry is None:
            entry = {"ticket": tr.ticket, "rag": "green", "breached": False}
            agg[tr.ticket_id] = entry
        if _RAG_SEVERITY[rag] > _RAG_SEVERITY[entry["rag"]]:
            entry["rag"] = rag
        entry["breached"] = entry["breached"] or breached
    agg["_partial"] = scanned >= _SLA_SCAN_CAP
    return agg


def _today_bounds(now):
    """[start, end) of the current UTC calendar day (settings.TIME_ZONE is UTC)."""
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def attention_summary(**f):
    """Accurate, point-in-time counts for the dashboard's "Needs attention" tiles,
    over the whole scoped OPEN backlog. Cheap DB counts for unassigned / overdue /
    due-today; the SLA at-risk (amber) & breached (red) counts come from
    ``_open_sla_index`` (distinct open tickets, worst RAG)."""
    now = timezone.now()
    open_qs = _base(**f).exclude(status__category__key="done")
    day_start, day_end = _today_bounds(now)
    idx = _open_sla_index(**f)
    partial = idx.pop("_partial", False)
    breached = sum(1 for e in idx.values() if e["breached"])
    at_risk = sum(1 for e in idx.values() if e["rag"] == "amber" and not e["breached"])
    return {
        "open_total": open_qs.count(),
        "unassigned": open_qs.filter(assignee__isnull=True).count(),
        "overdue": open_qs.filter(due_date__lt=now, due_date__isnull=False).count(),
        "due_today": open_qs.filter(due_date__gte=day_start, due_date__lt=day_end).count(),
        "sla_at_risk": at_risk,
        "sla_breached": breached,
        "sla_partial": partial,
    }


def _sla_ticket_row(t):
    """Compact ticket row for the SLA drill-down lists (enough to render a line and
    build the ticket-detail deep link)."""
    who = ""
    if t.assignee_id:
        who = (t.assignee.get_full_name() or "").strip() or t.assignee.username
    return {
        "ticket_number": t.ticket_number,
        "project_key": t.project.key if t.project_id else "",
        "summary": t.summary,
        "priority": t.priority,
        "status": t.status.name if t.status_id else "",
        "assignee": who,
        "due_date": _iso(t.due_date),
    }


def sla_at_risk_list(**f):
    """Open tickets whose first-response/resolution SLA is amber (≥75% elapsed, not
    yet breached) — the drill-down behind the "SLA at risk" tile. Soonest-due first."""
    idx = _open_sla_index(**f)
    idx.pop("_partial", None)
    rows = [_sla_ticket_row(e["ticket"]) for e in idx.values()
            if e["rag"] == "amber" and not e["breached"]]
    return sorted(rows, key=lambda r: r["due_date"] or "9999")[:500]


def sla_breached_open_list(**f):
    """Open tickets with a breached first-response/resolution SLA — the drill-down
    behind the "SLA breached (open)" tile. Distinct from the historical
    ``sla-breach-list`` report, which spans resolved/closed tickets too."""
    idx = _open_sla_index(**f)
    idx.pop("_partial", None)
    rows = [_sla_ticket_row(e["ticket"]) for e in idx.values() if e["breached"]]
    return sorted(rows, key=lambda r: r["due_date"] or "9999")[:500]


# ── Raw "Ticket Data" export ────────────────────────────────────────────────
# Standard + system + timeline columns, in display order: (row-key, header, type).
# `type` drives client/Excel formatting (datetime | bool | number | text).
_TICKET_DATA_COLUMNS = [
    ("ticket_number", "Ticket #", "text"),
    ("summary", "Summary", "text"),
    ("helpdesk", "Helpdesk", "text"),
    ("project", "Project", "text"),
    ("project_key", "Project key", "text"),
    ("ticket_type", "Ticket type", "text"),
    ("status", "Status", "text"),
    ("status_category", "Status category", "text"),
    ("workflow", "Workflow", "text"),
    ("priority", "Priority", "text"),
    ("impact", "Impact", "text"),
    ("urgency", "Urgency", "text"),
    # ITIL Impact Assessment (agent-only; surfaced on Incident projects)
    ("business_impact", "Business impact", "text"),
    ("users_affected", "Users affected", "number"),
    ("service_downtime", "Service downtime", "bool"),
    ("major_incident", "Major incident", "bool"),
    ("resolution", "Resolution", "text"),
    # ITIL Resolution Details (captured on the Resolve screen)
    ("resolution_code", "Resolution code", "text"),
    ("root_cause", "Root cause", "text"),
    ("workaround_provided", "Workaround provided", "bool"),
    ("resolution_notes", "Resolution notes", "text"),
    ("assigned_group", "Team", "text"),
    ("assignee", "Assignee", "text"),
    ("requestor", "Requestor", "text"),
    # Asset Management phase 2: the primary asset and every linked asset.
    ("asset", "Asset", "text"),
    ("all_assets", "All assets", "text"),
    ("source", "Source", "text"),
    ("reopen_count", "Reopen count", "number"),
    ("due_date", "Due date", "datetime"),
    ("first_responded_at", "First responded", "datetime"),
    ("assigned_at", "Assigned at", "datetime"),
    ("resolved_at", "Resolved at", "datetime"),
    ("closed_at", "Closed at", "datetime"),
    ("created_by", "Created by", "text"),
    ("updated_by", "Updated by", "text"),
    ("created_at", "Created at", "datetime"),
    ("updated_at", "Updated at", "datetime"),
    ("is_deleted", "Deleted", "bool"),
    ("deleted_at", "Deleted at", "datetime"),
    ("description_text", "Description", "text"),
]

# SLA metric kinds flattened into columns, in order. Each present kind contributes
# state / due / breached / breached_at / target columns.
_SLA_KINDS = [("first_response", "First response"), ("resolution", "Resolution"),
              ("assignment", "Assignment")]

# Cap the raw export so a huge backlog can't OOM the worker / browser. Download a
# longer window in parts (the 6-month range cap already bounds most requests).
_TICKET_DATA_MAX_ROWS = 5000


def _iso(v):
    return v.isoformat() if v else None


def ticket_data(**f):
    """Raw per-ticket export — every standard + system + timeline field, a flattened
    SLA-tracker summary, and all custom-field values. Returns ``{columns, rows,
    truncated}`` (columns carry labels + a format hint) so the screen and the
    xlsx/csv export render the same dynamic column set. Honours the shared
    project/group/date/helpdesk filters via ``_base``."""
    from apps.itsm_core.models import FieldType
    from apps.itsm_core.models.fields import NO_VALUE_TYPES
    from apps.itsm_core.services import fields as field_service

    qs = (_base(**f)
          .select_related("project", "project__helpdesk", "ticket_type", "status",
                          "status__category", "workflow", "assigned_group", "assignee",
                          "requestor", "created_by", "updated_by", "primary_asset")
          .order_by("-created_at"))
    total = qs.count()
    tickets = list(qs[:_TICKET_DATA_MAX_ROWS])
    ticket_ids = [t.id for t in tickets]

    # Linked asset tags per ticket, primary first (batched — no N+1).
    assets_by_ticket: dict = {}
    if ticket_ids:
        from apps.itsm_tickets.models import TicketAsset
        for link in (TicketAsset.objects.filter(ticket_id__in=ticket_ids)
                     .select_related("asset").order_by("position", "created_at")):
            assets_by_ticket.setdefault(link.ticket_id, []).append(link.asset.asset_tag)

    # SLA trackers, grouped by ticket then metric kind (batched — no N+1).
    sla_by_ticket, sla_kinds_present = {}, set()
    if ticket_ids:
        try:
            from apps.itsm_sla.models import SLATracker
            for tr in SLATracker.objects.filter(
                    ticket_id__in=ticket_ids).select_related("metric"):
                sla_by_ticket.setdefault(tr.ticket_id, {})[tr.metric.kind] = tr
                sla_kinds_present.add(tr.metric.kind)
        except (ImportError, ModuleNotFoundError):
            pass

    # Column-backed ITIL globals (Impact, Business impact, Root cause, …) are
    # standard Ticket columns, but a project only "has" them when the global def's
    # ``config.applies_to`` lists its project type — the same rule the Fields tab,
    # filter picker and column pickers follow (``hide_inapplicable_globals``).
    # Single project ⇒ hide what doesn't apply to it. Multi-project scope ⇒ hide a
    # column only when it applies to NONE of the project types in the result set.
    proj = None
    if f.get("project"):
        from apps.itsm_projects.models import Project
        proj = Project.objects.filter(pk=f["project"]).first()
    hidden: set[str] = set()
    if proj:
        hidden = set(field_service.inapplicable_global_keys(proj.project_type))
    else:
        types = {t.project.project_type for t in tickets if t.project_id}
        if types:
            hidden = set.intersection(
                *(set(field_service.inapplicable_global_keys(pt)) for pt in types))

    # Custom-field values, batched. When a single project is in scope, surface ALL
    # of that project's applicable (own + global) defined fields as columns even if
    # empty; else only the fields that actually carry a value somewhere in the
    # result set.
    _CF_TYPE = {FieldType.DATE: "datetime", FieldType.DATETIME: "datetime",
                FieldType.CHECKBOX: "bool", FieldType.NUMBER: "number"}
    cf_values, cf_cols = {}, {}  # cf_cols: key -> (label, type), insertion-ordered
    if proj:
        for fld in field_service.get_field_definitions(
                proj, applicable_only=True).order_by("name"):
            if fld.field_type in NO_VALUE_TYPES or (fld.config or {}).get("maps_to"):
                continue  # attachment / column-backed fields hold no FieldValue
            cf_cols[fld.key] = (fld.name, _CF_TYPE.get(fld.field_type, "text"))
    if ticket_ids:
        from apps.itsm_core.models import FieldValue
        for fv in FieldValue.objects.filter(
                ticket_id__in=ticket_ids).select_related("field", "value_user"):
            val = field_service._serialize(fv)
            cf_values.setdefault(fv.ticket_id, {})[fv.field.key] = val
            cf_cols.setdefault(fv.field.key,
                               (fv.field.name, _CF_TYPE.get(fv.field.field_type, "text")))

    # Assemble the column manifest: standard → SLA (present kinds) → custom fields.
    columns = [{"key": k, "label": lbl, "type": ty}
               for k, lbl, ty in _TICKET_DATA_COLUMNS if k not in hidden]
    for kind, label in _SLA_KINDS:
        if kind not in sla_kinds_present:
            continue
        columns += [
            {"key": f"sla_{kind}_state", "label": f"SLA {label} — state", "type": "text"},
            {"key": f"sla_{kind}_due", "label": f"SLA {label} — due", "type": "datetime"},
            {"key": f"sla_{kind}_breached", "label": f"SLA {label} — breached", "type": "bool"},
            {"key": f"sla_{kind}_breached_at", "label": f"SLA {label} — breached at",
             "type": "datetime"},
            {"key": f"sla_{kind}_target_minutes", "label": f"SLA {label} — target (min)",
             "type": "number"},
        ]
    for key, (label, ty) in cf_cols.items():
        columns.append({"key": f"cf_{key}", "label": label, "type": ty})

    rows = []
    for t in tickets:
        proj = t.project if t.project_id else None
        row = {
            "ticket_number": t.ticket_number,
            "summary": t.summary,
            "helpdesk": proj.helpdesk.name if proj and proj.helpdesk_id else None,
            "project": proj.name if proj else None,
            "project_key": proj.key if proj else None,
            "ticket_type": t.ticket_type.name if t.ticket_type_id else None,
            "status": t.status.name if t.status_id else None,
            "status_category": (t.status.category.key
                                if t.status_id and t.status.category_id else None),
            "workflow": t.workflow.name if t.workflow_id else None,
            "priority": t.priority,
            "impact": t.impact,
            "urgency": t.urgency,
            "business_impact": t.business_impact,
            "users_affected": t.users_affected,
            "service_downtime": t.service_downtime,
            "major_incident": t.major_incident,
            "resolution": t.resolution,
            "resolution_code": t.resolution_code,
            "root_cause": t.root_cause,
            "workaround_provided": t.workaround_provided,
            "resolution_notes": t.resolution_notes,
            "assigned_group": t.assigned_group.name if t.assigned_group_id else None,
            "assignee": t.assignee.username if t.assignee_id else None,
            "requestor": t.requestor.username if t.requestor_id else None,
            "asset": (f"{t.primary_asset.asset_tag} · {t.primary_asset.name}"
                      if t.primary_asset_id else None),
            "all_assets": ", ".join(assets_by_ticket.get(t.id, [])) or None,
            "source": t.source,
            "reopen_count": t.reopen_count,
            "due_date": _iso(t.due_date),
            "first_responded_at": _iso(t.first_responded_at),
            "assigned_at": _iso(t.assigned_at),
            "resolved_at": _iso(t.resolved_at),
            "closed_at": _iso(t.closed_at),
            "created_by": t.created_by.username if t.created_by_id else None,
            "updated_by": t.updated_by.username if t.updated_by_id else None,
            "created_at": _iso(t.created_at),
            "updated_at": _iso(t.updated_at),
            "is_deleted": t.is_deleted,
            "deleted_at": _iso(t.deleted_at),
            "description_text": t.description_text,
        }
        kinds = sla_by_ticket.get(t.id, {})
        for kind, _label in _SLA_KINDS:
            if kind not in sla_kinds_present:
                continue
            tr = kinds.get(kind)
            row[f"sla_{kind}_state"] = tr.state if tr else None
            row[f"sla_{kind}_due"] = _iso(tr.due_at) if tr else None
            row[f"sla_{kind}_breached"] = tr.breached if tr else None
            row[f"sla_{kind}_breached_at"] = _iso(tr.breached_at) if tr else None
            row[f"sla_{kind}_target_minutes"] = tr.target_minutes if tr else None
        vals = cf_values.get(t.id, {})
        for key in cf_cols:
            v = vals.get(key)
            row[f"cf_{key}"] = ", ".join(str(x) for x in v) if isinstance(v, list) else v
        rows.append({k: v for k, v in row.items() if k not in hidden})

    return {"columns": columns, "rows": rows, "truncated": total > len(rows)}


# ── CSAT surveys (itsm_surveys) ─────────────────────────────────────────────
def _survey_base(**f):
    """SurveyResponse queryset with the same project/helpdesk clamps as ``_base``
    (so CSAT reports never leak across helpdesks). Lazy-imports itsm_surveys so
    reporting keeps working if the app isn't installed. Date filters are applied by
    the caller (on ``sent_at`` vs ``submitted_at``)."""
    from apps.itsm_surveys.models import SurveyResponse
    # A deleted ticket leaves CSAT like every other report (``_base``).
    qs = SurveyResponse.objects.filter(is_deleted=False, ticket__is_deleted=False)
    helpdesk_ids = f.get("helpdesk_ids")
    project_ids = f.get("project_ids")
    if helpdesk_ids is not None:
        qs = qs.filter(project__helpdesk_id__in=helpdesk_ids)
    if project_ids is not None:
        qs = qs.filter(project_id__in=project_ids)
    if f.get("project"):
        qs = qs.filter(project_id=f["project"])
    return qs


def csat_summary(**f):
    """Headline CSAT over SUBMITTED responses in range: satisfaction % (top-box),
    response rate, average 0–100 score, and the rating distribution. Scale-agnostic
    — ``is_satisfied``/``csat_score`` are normalised at submit time."""
    date_from, date_to = f.get("date_from"), f.get("date_to")
    base = _survey_base(**f)
    sent_qs = base
    sub_qs = base.filter(status="submitted")
    if date_from:
        sent_qs = sent_qs.filter(sent_at__date__gte=date_from)
        sub_qs = sub_qs.filter(submitted_at__date__gte=date_from)
    if date_to:
        sent_qs = sent_qs.filter(sent_at__date__lte=date_to)
        sub_qs = sub_qs.filter(submitted_at__date__lte=date_to)
    sent = sent_qs.count()
    n = sub_qs.count()
    satisfied = sub_qs.filter(is_satisfied=True).count()
    avg = sub_qs.aggregate(a=Avg("csat_score"))["a"]
    dist = sub_qs.values("rating").annotate(value=Count("id")).order_by("rating")
    by_rating = [{"label": str(r["rating"]), "rating": r["rating"], "value": r["value"],
                  "pct": round(r["value"] / n * 100, 1) if n else 0.0} for r in dist]
    return {
        "responses": n,
        "sent": sent,
        "satisfied": satisfied,
        "csat_pct": round(satisfied / n * 100, 1) if n else None,
        "avg_score": round(avg, 1) if avg is not None else None,
        "response_rate": round(n / sent * 100, 1) if sent else None,
        "by_rating": by_rating,
    }


def csat_responses(**f):
    """Per-response list (submitted), newest first. Capped at 2000 rows."""
    date_from, date_to = f.get("date_from"), f.get("date_to")
    qs = _survey_base(**f).filter(status="submitted").select_related(
        "ticket", "project", "requestor")
    if date_from:
        qs = qs.filter(submitted_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(submitted_at__date__lte=date_to)
    rows = []
    for r in qs.order_by("-submitted_at")[:2000]:
        who = ""
        if r.requestor_id:
            who = getattr(r.requestor, "full_name", "") or getattr(r.requestor, "username", "")
        rows.append({
            "ticket": r.ticket.ticket_number if r.ticket_id else "",
            "project": r.project.key if r.project_id else "",
            "requestor": who,
            "scale_type": r.scale_type,
            "rating": r.rating,
            "satisfied": r.is_satisfied,
            "comment": r.comment_text,
            "submitted_at": r.submitted_at.isoformat() if r.submitted_at else "",
        })
    return rows


REPORTS = {
    "ticket-data": ticket_data,
    "open-tickets": open_tickets,
    "by-status": by_status,
    "by-priority": by_priority,
    "by-group": by_group,
    "by-source": by_source,
    "agent-performance": agent_performance,
    "sla-compliance": sla_compliance,
    "resolution-trends": resolution_trends,
    "volume-trends": volume_trends,
    "created-vs-resolved": created_vs_resolved,
    "resolution-time-by-priority": resolution_time_by_priority,
    "sla-breach-list": sla_breach_list,
    "backlog-aging": backlog_aging,
    # Dashboard-only helpers (accurate attention counts + SLA drill-down lists);
    # deliberately NOT in STANDARD_REPORTS (the export pack / reports catalog).
    "attention-summary": attention_summary,
    "sla-at-risk-list": sla_at_risk_list,
    "sla-breached-open-list": sla_breached_open_list,
    "csat-summary": csat_summary,
    "csat-responses": csat_responses,
}

# The curated "standard reports" catalog, in display order — drives the combined
# Excel export (Export all) and the frontend catalog. A subset of REPORTS: the raw
# trend series (volume-trends / resolution-trends) are omitted in favour of the
# combined created-vs-resolved table, but stay in REPORTS for the dashboard tab.
STANDARD_REPORTS = [
    "ticket-data",
    "by-status",
    "by-priority",
    "by-group",
    "open-tickets",
    "created-vs-resolved",
    "agent-performance",
    "resolution-time-by-priority",
    "sla-compliance",
    "sla-breach-list",
    "backlog-aging",
    "csat-summary",
    "csat-responses",
]
