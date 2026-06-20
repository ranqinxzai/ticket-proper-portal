# itsm-dashboards — API Contracts

**Status: BUILT.** Router in `itsm_dashboards/urls.py` registers `saved-filters`, `dashboards`,
`widgets`. Base `/api/v1/itsm/`.

## Saved filters — module `itsm.tickets.queue`
### `GET|POST saved-filters` · `.../{id}`
Owned-or-shared filtering (you see your own + `is_shared=True`).
`{ id, name, query_spec, owner, is_shared, ... }`.
### `GET saved-filters/{id}/results/`
Runs the filter via `query_builder.filtered_tickets(query_spec, user)` and returns matching tickets
(first 100).
`query_spec` JSON, e.g.:
```json
{ "op": "and", "conditions": [
  { "field": "status__category", "operator": "eq", "value": "todo" },
  { "field": "priority", "operator": "in", "value": ["critical","high"] },
  { "field": "assignee", "operator": "isnull", "value": true }
] }
```
Used by saved queues, the filter builder, ticket-list widgets, and bulk ops.

## Dashboards — module `itsm.dashboards`
### `GET|POST dashboards` · `.../{id}`
Owned-or-shared filtering.
`{ id, name, owner, is_shared, layout, widgets:[Widget], created_at }` (widgets nested read-only).
Sharing is via the `is_shared` flag + `DashboardShare` rows (no custom `share` action on the viewset).

## Widgets — module `itsm.dashboards`
### `GET|POST widgets` · `.../{id}`  filter `?dashboard=&widget_type=`
`{ id, dashboard, widget_type:"kpi|pie|bar|trend|sla|ticket_list", title, saved_filter, config,
sort_order, position }`.
### `GET widgets/{id}/data/`
Resolves the widget's data payload by delegating to `itsm_reporting.services.widget_data.resolve`
(KPI / pie / bar / trend / sla / ticket_list shapes).

## Bulk + queue filtering (lives in itsm_tickets)
The ticket list supports `?saved_filter=<id>` filtering, and `POST tickets/bulk/`
(module `itsm.tickets.bulk`) operates over `ids` or `saved_filter_id` with ops
`assign`/`priority`/`watch`/`unwatch`/`delete`.

## Error codes (intended)
- `400` — `query_spec` referencing a non-whitelisted field/operator.
- `403` — accessing a dashboard not owned/shared, or data the viewer lacks rights to.
