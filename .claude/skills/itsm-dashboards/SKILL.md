# itsm-dashboards

## Purpose
Drag-and-drop dashboard builder + saved filters. `SavedFilter` stores a JSON `query_spec` that is
turned into an ORM `Q` by `query_builder` (the queue/filter-builder backbone);
`Dashboard`/`Widget`/`DashboardShare` arrange chart/KPI/list widgets on a grid. **Status: BUILT** —
`backend/apps/itsm_dashboards/` has models in `models/models.py`
(`SavedFilter`/`Dashboard`/`Widget`/`DashboardShare`), migration `0001_initial`, and
serializers/views/urls. Note: the `query_builder` itself lives in
`backend/apps/itsm_tickets/services/query_builder.py`, **not** in `itsm_dashboards`. The
`itsm.dashboards` / `itsm.dashboard` RBAC modules are seeded.

## Backend app path
`backend/apps/itsm_dashboards/` (BUILT — models, migration `0001`, serializers/views/urls). The
`query_builder` it relies on lives in `backend/apps/itsm_tickets/services/query_builder.py`.

## Key concepts
- **`SavedFilter`** — named JSON `query_spec` → compiled to a Django `Q` by `query_builder`; powers
  saved queues, the filter builder, the bulk endpoint, and ticket-list widgets.
- **`Dashboard`** — a named grid of widgets (owner + optional shares).
- **`Widget`** — a tile: type (KPI / pie / bar / trend / SLA-gauge / ticket-list), a data source
  (a report aggregate or a saved filter), and grid layout (x/y/w/h via react-grid-layout).
- **`DashboardShare`** — share a dashboard with a user/role/group.
- **`query_builder` (`query_spec`→Q)** — the shared, safe translator from a JSON filter spec to an
  ORM query, used by dashboards, the ticket queue, and reporting. It lives in
  `itsm_tickets/services/query_builder.py` (`build_q(query_spec, user)` / `filtered_tickets(...)`),
  not in `itsm_dashboards`. **Helpdesk scoping:** `SavedFilter.results` and `WidgetViewSet.data` pass
  `accessible_helpdesk_ids=accessible_helpdesk_ids_cached(request)` into `query_builder` /
  `widget_data.resolve`, so saved-filter results and widget data never leak across helpdesks.

## Frontend path / pages (planned)
`dashboards/[id]` (+ `/edit`) using react-grid-layout + a widget registry (Recharts);
saved-queue/filter-builder UI on the ticket queue.

## API clients
- `saved-filters` (`SavedFilterViewSet`, module `itsm.tickets.queue`) — owned-or-shared; custom
  action `GET saved-filters/{id}/results/` runs the filter and returns matching tickets.
- `dashboards` (`DashboardViewSet`, module `itsm.dashboards`) — owned-or-shared.
- `widgets` (`WidgetViewSet`, module `itsm.dashboards`) — filterable by `dashboard`/`widget_type`;
  custom action `GET widgets/{id}/data/` resolves the widget's payload (delegates to
  `itsm_reporting.services.widget_data.resolve`).

## RBAC module codes
- Dashboard config (`saved-filters`/`dashboards`/`widgets`) → **`itsm.dashboards`**.
- The dashboard *view* surface → **`itsm.dashboard`**.
Agents have read/create/update on both (they build personal dashboards/queues).

## Key files
`models/models.py` (`SavedFilter`/`Dashboard`/`Widget`/`DashboardShare`), `migrations/0001_initial.py`,
`serializers.py`, `views.py`, `urls.py`. The `query_spec`→Q translator is
`itsm_tickets/services/query_builder.py`; the SavedFilter-consuming bulk-ticket endpoint
(`POST tickets/bulk/`, module `itsm.tickets.bulk`) and `?saved_filter=` ticket filtering live in
`itsm_tickets`.
