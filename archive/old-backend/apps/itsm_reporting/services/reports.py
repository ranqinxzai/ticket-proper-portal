"""Live operational reports — ORM aggregations over Ticket (+ SLATracker when present).

These read live data (cheap with the Ticket composite indexes). Heavy historical
trends can later be backed by the nightly snapshot tables; the API shape is stable.
"""

from __future__ import annotations

from datetime import timedelta

from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Q
from django.utils import timezone


def _base(project=None, group=None, date_from=None, date_to=None, helpdesk_ids=None):
    from apps.itsm_tickets.models import Ticket
    qs = Ticket.objects.filter(is_deleted=False)
    # Helpdesk clamp (None ⇒ unrestricted/superuser). Always applied first so no
    # report can roll up another helpdesk's volumes.
    if helpdesk_ids is not None:
        qs = qs.filter(project__helpdesk_id__in=helpdesk_ids)
    if project:
        qs = qs.filter(project_id=project)
    if group:
        qs = qs.filter(assigned_group_id=group)
    if date_from:
        qs = qs.filter(created_at__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__lte=date_to)
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
    if f.get("project"):
        qs = qs.filter(ticket__project_id=f["project"])
    total = qs.count()
    breached = qs.filter(breached=True).count()
    met = total - breached
    return {"total": total, "met": met, "breached": breached,
            "compliance_pct": round(met / total * 100, 1) if total else None}


def _daily(qs, field, days):
    start = (timezone.now() - timedelta(days=days)).date()
    rows = {}
    for t in qs.filter(**{f"{field}__date__gte": start}).values_list(field, flat=True):
        if t:
            rows[t.date().isoformat()] = rows.get(t.date().isoformat(), 0) + 1
    return [{"date": d, "value": v} for d, v in sorted(rows.items())]


def volume_trends(days=30, **f):
    return _daily(_base(**f), "created_at", days)


def resolution_trends(days=30, **f):
    return _daily(_base(**f).filter(resolved_at__isnull=False), "resolved_at", days)


REPORTS = {
    "open-tickets": open_tickets,
    "by-status": by_status,
    "by-priority": by_priority,
    "by-group": by_group,
    "agent-performance": agent_performance,
    "sla-compliance": sla_compliance,
    "resolution-trends": resolution_trends,
    "volume-trends": volume_trends,
}
