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

## Update (2026-06-28) — Command-center dashboard KPIs auto-refresh (live, silent)
The workspace command-center dashboard (`app/t/[org]/(agent)/agent/w/[helpdeskKey]/dashboard/page.tsx`)
no longer fetches its report/KPI data only once on mount — it now **auto-refreshes silently**. Its data
fetch was refactored into a `load({silent})` callback and wired to the shared `useLivePoll` hook
(`lib/itsm/use-live-poll.ts`): every ~15s it polls the cheap `ticketsApi.pulse({helpdesk, project})`
change-token (see itsm-tickets) and, only when a ticket actually changed in scope, re-computes all KPIs
**in place with no loading skeleton** (a monotonic `fetchSeq` drops superseded fetches). Polling pauses
while the tab is hidden and catches up on refocus. No banner/pill here (there are no rows to clobber) —
the numbers just swap. No new infra (polling, not SSE/WebSockets; the app runs gunicorn 3 sync workers).

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
- **Per-user queue preferences (per `(owner, project)`, unique alive row, upserting POST):**
  - **`QueueColumnPreference`** — the agent's own ticket-queue **column** layout (overrides
    `Project.queue_columns`).
  - **`QueueViewPreference`** (added 2026-06-22, migration `0004_queueviewpreference`) — the agent's own
    **default queue view** (`view_key` = a system view key like `"open"`/`"all"` or `"saved:<uuid>"`).
    The queue resolves a fresh visit as **this pref → `Project.default_view_key` → product default
    (`"open"`) → All tickets**. Set from the queue view dropdown's star; the project-level default + the
    custom-filter management UI live on the project **Filters** settings tab (see itsm-projects).
- **`query_builder` (`query_spec`→Q)** — the shared, safe translator from a JSON filter spec to an
  ORM query, used by dashboards, the ticket queue, and reporting. It lives in
  `itsm_tickets/services/query_builder.py` (`build_q(query_spec, user)` / `filtered_tickets(...)`),
  not in `itsm_dashboards`. **Helpdesk scoping:** `SavedFilter.results` and `WidgetViewSet.data` pass
  `accessible_helpdesk_ids=accessible_helpdesk_ids_cached(request)` into `query_builder` /
  `widget_data.resolve`, so saved-filter results and widget data never leak across helpdesks.

## Frontend path / pages
- **BUILT — workspace "command center" dashboard**: `app/t/[org]/(agent)/agent/w/[helpdeskKey]/dashboard/page.tsx`
  is the helpdesk landing tab. It is **not** built on the `Dashboard`/`Widget` models — it is a curated,
  fixed layout that **consumes the `itsm-reporting` report endpoints** (`reportsApi` — the 8 keys) plus a
  scoped `ticketsApi.list` for the "Needs attention" tiles. Hero KPIs with period-over-period deltas, a
  Created-vs-Resolved trend, an SLA gauge, status/priority/team distributions, an agent leaderboard and a
  projects list. Charts are the dependency-free SVG primitives in `components/reports/report-views.tsx`
  (`KpiCard`/`DonutChart`/`GaugeChart`/`DualTrendChart`/`AlertTile`/`Sparkline`). See **itsm-reporting**
  for the data-flow details (state vs trend scoping, the `days × 2` delta split, SLA-RAG attention logic).
- **PLANNED — configurable builder**: `dashboards/[id]` (+ `/edit`) using react-grid-layout + a widget
  registry; this is the surface that would actually use the `Dashboard`/`Widget`/`DashboardShare` models
  and the `widgets/{id}/data/` resolver. Not built yet; saved-queue/filter-builder UI on the ticket queue
  is likewise pending.

## API clients
- `saved-filters` (`SavedFilterViewSet`, module `itsm.tickets.queue`) — owned-or-shared; custom
  action `GET saved-filters/{id}/results/` runs the filter and returns matching tickets.
- `dashboards` (`DashboardViewSet`, module `itsm.dashboards`) — owned-or-shared.
- `widgets` (`WidgetViewSet`, module `itsm.dashboards`) — filterable by `dashboard`/`widget_type`;
  custom action `GET widgets/{id}/data/` resolves the widget's payload (delegates to
  `itsm_reporting.services.widget_data.resolve`).
- `queue-columns` (`QueueColumnPreferenceViewSet`, module `itsm.tickets.queue`) — the caller's own
  column layout per project; `POST` upserts, list is owner-clamped.
- `queue-view` (`QueueViewPreferenceViewSet`, module `itsm.tickets.queue`) — the caller's own default
  queue view per project; `POST` upserts (`{ project, view_key }`), list is owner-clamped.

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
