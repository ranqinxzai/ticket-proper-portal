# itsm-dashboards — Interlinking

## Depends on
- **itsm-core** — `BaseModel`.
- **itsm-tickets** — `SavedFilter.query_spec` filters `Ticket`; ticket-list widgets + bulk ops select
  tickets; the `query_builder` (`build_q` / `filtered_tickets`) lives here and compiles against
  Ticket fields.
- **itsm-reporting** — `widgets/{id}/data/` delegates to `widget_data.resolve`; KPI/trend/SLA widgets
  pull from reporting's live aggregates (no snapshot tables exist).
- **itsm-projects / itsm-groups / accounts.User** — filter dimensions + share targets.
- **itsm-rbac** — gated by `itsm.dashboards` (config) and `itsm.dashboard` (view); shares never
  bypass per-viewer data RBAC.

## Depended on by
- **itsm-tickets** — saved queues + the queue filter builder use `SavedFilter` + `query_builder`
  (this ships at M2, before the full grid at M10); the **bulk** endpoint
  (`itsm.tickets.bulk`) consumes a SavedFilter to pick its target set.

## Shared service
`query_builder` (`query_spec`→Q) is the common, security-critical translator used by saved queues,
dashboard widgets, reporting's ticket-list widget, and bulk ops. It lives in
`itsm_tickets/services/query_builder.py`, not in `itsm_dashboards`.
