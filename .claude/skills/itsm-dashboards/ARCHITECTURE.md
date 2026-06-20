# itsm-dashboards — Architecture

## Current state
`backend/apps/itsm_dashboards/` is **BUILT**: models in `models/models.py`
(`SavedFilter`/`Dashboard`/`Widget`/`DashboardShare`), `migrations/0001_initial.py`, plus
`serializers.py` / `views.py` / `urls.py` (router registers `saved-filters`/`dashboards`/`widgets`).
The `query_spec`→`Q` translator is **not** in this app — it lives in
`backend/apps/itsm_tickets/services/query_builder.py` and is shared by dashboards, the queue, and
reporting's widget data.

## Layout
```
itsm_dashboards/
  models/models.py   # SavedFilter, Dashboard, Widget, DashboardShare
  migrations/0001_initial.py
  serializers.py / views.py / urls.py
# query_builder lives in itsm_tickets/services/query_builder.py (build_q / filtered_tickets)
```

## Design decisions
- **`query_spec` → `Q`, never raw SQL/eval.** `query_builder` (in
  `itsm_tickets/services/query_builder.py`) walks a JSON spec and builds an ORM `Q` from a known set
  of allowed fields/operators. This is the single safe choke-point for ad-hoc filtering, shared by
  the queue/filter-builder, dashboard widgets, and reporting. Never `eval` user input.
- **SavedFilter lands first (M2).** Saved queues + the filter builder + the bulk endpoint depend only
  on `SavedFilter` + `query_builder`, so they ship before the full dashboard grid (M10).
- **Widgets reference a data source, not inline queries.** A `Widget` points at either a report
  aggregate (itsm-reporting) or a `SavedFilter`, plus a chart type and grid geometry. The frontend
  widget registry maps type → Recharts component; the backend returns the data for the chosen source.
- **Grid geometry stored per widget** (`x/y/w/h`) so react-grid-layout round-trips a drag/resize via a
  single dashboard save.
- **Sharing via `DashboardShare`** to user/role/group; the viewer's RBAC still gates the underlying
  data (a shared dashboard can't surface tickets the viewer couldn't otherwise see).
- **Owner-scoped by default.** A dashboard/saved-filter belongs to its creator; sharing is explicit.

## Bulk operations
The bulk ticket endpoint (`POST tickets/bulk/`, module override `itsm.tickets.bulk`) consumes a
`SavedFilter`/`query_spec` to select the target set, then applies an action (assign, transition,
set priority) — reusing `query_builder` so the selection semantics match the queue.
