"""Resolve a dashboard Widget into its data payload."""

from __future__ import annotations

from . import reports


def resolve(widget, *, user=None, accessible_helpdesk_ids=None,
            accessible_project_ids=None) -> dict:
    cfg = widget.config or {}
    spec = widget.saved_filter.query_spec if widget.saved_filter_id else {}
    # Helpdesk + per-user project clamps flow into every report fn and the
    # ticket_list query below, so a shared/foreign widget can't surface another
    # helpdesk's — or an unassigned project's — data.
    f = {"project": spec.get("project"), "helpdesk_ids": accessible_helpdesk_ids,
         "project_ids": accessible_project_ids}

    wtype = widget.widget_type
    if wtype == "kpi":
        metric = cfg.get("metric", "open_count")
        if metric == "open_count":
            return {"type": "kpi", "value": reports.open_tickets(**f)["total"], "label": "Open tickets"}
        if metric == "breached_count":
            return {"type": "kpi", "value": reports.sla_compliance(**f)["breached"], "label": "SLA breached"}
        if metric == "sla_compliance":
            return {"type": "kpi", "value": reports.sla_compliance(**f)["compliance_pct"],
                    "label": "SLA compliance %"}
        return {"type": "kpi", "value": reports.open_tickets(**f)["total"], "label": metric}

    if wtype in ("pie", "bar"):
        group_by = cfg.get("group_by", "status")
        fn = {"status": reports.by_status, "priority": reports.by_priority,
              "group": reports.by_group}.get(group_by, reports.by_status)
        return {"type": wtype, "series": fn(**f)}

    if wtype == "trend":
        days = cfg.get("days", 30)
        return {"type": "trend",
                "created": reports.volume_trends(days=days, **f),
                "resolved": reports.resolution_trends(days=days, **f)}

    if wtype == "sla":
        return {"type": "sla", **reports.sla_compliance(**f)}

    if wtype == "ticket_list":
        from apps.itsm_tickets.serializers import TicketListSerializer
        from apps.itsm_tickets.services import query_builder
        qs = query_builder.filtered_tickets(
            spec, user=user, accessible_helpdesk_ids=accessible_helpdesk_ids,
            accessible_project_ids=accessible_project_ids,
        )[: cfg.get("limit", 10)]
        return {"type": "ticket_list", "tickets": TicketListSerializer(qs, many=True).data}

    return {"type": wtype, "error": "unknown widget type"}
