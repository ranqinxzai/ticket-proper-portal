"""Live operational reports — ORM aggregations over Ticket (+ SLATracker when present).

These read live data (cheap with the Ticket composite indexes). Heavy historical
trends can later be backed by the nightly snapshot tables; the API shape is stable.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Max, Min, Q
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
    rows = _base(**f).values("status__name", "status__color", "status__category__key").annotate(
        n=Count("id")).order_by("-n")
    return [{"label": r["status__name"], "color": r["status__color"],
             "category": r["status__category__key"], "value": r["n"]} for r in rows]


def by_priority(**f):
    rows = _base(**f).values("priority").annotate(n=Count("id")).order_by("priority")
    return [{"label": r["priority"], "value": r["n"]} for r in rows]


def by_group(**f):
    rows = _base(**f).values("assigned_group__name").annotate(n=Count("id")).order_by("-n")
    return [{"label": r["assigned_group__name"] or "Unassigned", "value": r["n"]} for r in rows]


def agent_performance(**f):
    qs = _base(**f).filter(assignee__isnull=False)
    resolved = qs.filter(resolved_at__isnull=False).annotate(
        ttr=ExpressionWrapper(F("resolved_at") - F("created_at"), output_field=DurationField())
    )
    open_by = dict(qs.exclude(status__category__key="done").values_list("assignee_id").annotate(n=Count("id")))
    rows = []
    for r in resolved.values("assignee__username", "assignee_id").annotate(
            resolved_count=Count("id"), avg_ttr=Avg("ttr")):
        rows.append({
            "agent": r["assignee__username"],
            "resolved_count": r["resolved_count"],
            "open_count": open_by.get(r["assignee_id"], 0),
            "avg_resolution_hours": round(r["avg_ttr"].total_seconds() / 3600, 1) if r["avg_ttr"] else None,
        })
    return sorted(rows, key=lambda x: -x["resolved_count"])


def sla_compliance(**f):
    try:
        from apps.itsm_sla.models import SLATracker
    except (ImportError, ModuleNotFoundError):
        return {"total": 0, "met": 0, "breached": 0, "compliance_pct": None}
    qs = SLATracker.objects.filter(state__in=["met", "breached", "stopped"])
    if f.get("helpdesk_ids") is not None:
        qs = qs.filter(ticket__project__helpdesk_id__in=f["helpdesk_ids"])
    if f.get("project_ids") is not None:
        qs = qs.filter(ticket__project_id__in=f["project_ids"])
    if f.get("project"):
        qs = qs.filter(ticket__project_id=f["project"])
    if f.get("date_from"):
        qs = qs.filter(ticket__created_at__date__gte=f["date_from"])
    if f.get("date_to"):
        qs = qs.filter(ticket__created_at__date__lte=f["date_to"])
    total = qs.count()
    breached = qs.filter(breached=True).count()
    met = total - breached
    return {"total": total, "met": met, "breached": breached,
            "compliance_pct": round(met / total * 100, 1) if total else None}


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


def _hours(td):
    """Round a timedelta to hours (1 dp), or None."""
    return round(td.total_seconds() / 3600, 1) if td else None


_PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def resolution_time_by_priority(**f):
    """Avg/min/max time-to-resolve (hours) grouped by priority."""
    qs = _base(**f).filter(resolved_at__isnull=False).annotate(
        ttr=ExpressionWrapper(F("resolved_at") - F("created_at"), output_field=DurationField()))
    rows = [{
        "priority": r["priority"],
        "resolved_count": r["resolved_count"],
        "avg_hours": _hours(r["avg_ttr"]),
        "min_hours": _hours(r["min_ttr"]),
        "max_hours": _hours(r["max_ttr"]),
    } for r in qs.values("priority").annotate(
        resolved_count=Count("id"), avg_ttr=Avg("ttr"), min_ttr=Min("ttr"), max_ttr=Max("ttr"))]
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
        rows.append({"label": label, "value": q.count()})
    return rows


def sla_breach_list(**f):
    """Per-ticket list of breached SLA trackers, most-recent first (capped)."""
    try:
        from apps.itsm_sla.models import SLATracker
    except (ImportError, ModuleNotFoundError):
        return []
    qs = SLATracker.objects.filter(breached=True, ticket__is_deleted=False)
    if f.get("helpdesk_ids") is not None:
        qs = qs.filter(ticket__project__helpdesk_id__in=f["helpdesk_ids"])
    if f.get("project_ids") is not None:
        qs = qs.filter(ticket__project_id__in=f["project_ids"])
    if f.get("project"):
        qs = qs.filter(ticket__project_id=f["project"])
    if f.get("date_from"):
        qs = qs.filter(breached_at__date__gte=f["date_from"])
    if f.get("date_to"):
        qs = qs.filter(breached_at__date__lte=f["date_to"])
    qs = qs.select_related(
        "ticket", "metric", "ticket__assigned_group", "ticket__assignee").order_by("-breached_at")
    rows = []
    for tr in qs[:1000]:
        tk = tr.ticket
        overdue = int((tr.breached_at - tr.due_at).total_seconds() // 60) \
            if tr.breached_at and tr.due_at else None
        rows.append({
            "ticket_number": tk.ticket_number,
            "summary": tk.summary,
            "metric": tr.metric.name if tr.metric_id else "—",
            "priority": tk.priority,
            "team": tk.assigned_group.name if tk.assigned_group_id else "Unassigned",
            "due_at": tr.due_at.isoformat() if tr.due_at else None,
            "breached_at": tr.breached_at.isoformat() if tr.breached_at else None,
            "minutes_overdue": overdue,
        })
    return rows


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
    ("resolution", "Resolution", "text"),
    ("assigned_group", "Team", "text"),
    ("assignee", "Assignee", "text"),
    ("requestor", "Requestor", "text"),
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
                          "requestor", "created_by", "updated_by")
          .order_by("-created_at"))
    total = qs.count()
    tickets = list(qs[:_TICKET_DATA_MAX_ROWS])
    ticket_ids = [t.id for t in tickets]

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

    # Custom-field values, batched. When a single project is in scope, surface ALL
    # of that project's (+ global) defined fields as columns even if empty; else
    # only the fields that actually carry a value somewhere in the result set.
    _CF_TYPE = {FieldType.DATE: "datetime", FieldType.DATETIME: "datetime",
                FieldType.CHECKBOX: "bool", FieldType.NUMBER: "number"}
    cf_values, cf_cols = {}, {}  # cf_cols: key -> (label, type), insertion-ordered
    if f.get("project"):
        from apps.itsm_projects.models import Project
        proj = Project.objects.filter(pk=f["project"]).first()
        if proj:
            for fld in field_service.get_field_definitions(proj).order_by("name"):
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
    columns = [{"key": k, "label": lbl, "type": ty} for k, lbl, ty in _TICKET_DATA_COLUMNS]
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
            "resolution": t.resolution,
            "assigned_group": t.assigned_group.name if t.assigned_group_id else None,
            "assignee": t.assignee.username if t.assignee_id else None,
            "requestor": t.requestor.username if t.requestor_id else None,
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
        rows.append(row)

    return {"columns": columns, "rows": rows, "truncated": total > len(rows)}


REPORTS = {
    "ticket-data": ticket_data,
    "open-tickets": open_tickets,
    "by-status": by_status,
    "by-priority": by_priority,
    "by-group": by_group,
    "agent-performance": agent_performance,
    "sla-compliance": sla_compliance,
    "resolution-trends": resolution_trends,
    "volume-trends": volume_trends,
    "created-vs-resolved": created_vs_resolved,
    "resolution-time-by-priority": resolution_time_by_priority,
    "sla-breach-list": sla_breach_list,
    "backlog-aging": backlog_aging,
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
]
