# itsm-reporting — Interlinking

## Depends on
- **itsm-core** — `BaseModel` (only if the deferred snapshot tables are added).
- **itsm-tickets** — aggregates over `Ticket` first-class columns; `widget_data.resolve` also calls
  `itsm_tickets.services.query_builder` for the ticket-list widget.
- **itsm-sla** — `SLATracker` outcomes feed `SLAComplianceStat` and the SLA-compliance report.
- **itsm-workflows** — status-category grouping (open vs done) and resolution timestamps.
- **itsm-groups / accounts.User** — by-group and per-agent breakdowns.
- **itsm-projects** — project-scoped filters.
- **itsm-dashboards** — `widget_data.resolve` powers dashboard widgets; the `query_builder`
  (`query_spec`→Q) it uses lives in `itsm_tickets/services/query_builder.py`.
- **itsm-rbac** — gated by `itsm.reports` / `.sla` / `.agent`.

## Depended on by
- **itsm-dashboards** — KPI/trend/SLA-gauge widgets call the same aggregate services / snapshots.

## Scheduler (deferred, not built)
No reporting scheduler job exists today. If the snapshot tier is added, `reporting.aggregate_nightly`
would run alongside the SLA + notification jobs on the shared `DjangoJobStore`, behind `RUN_SCHEDULER`.
