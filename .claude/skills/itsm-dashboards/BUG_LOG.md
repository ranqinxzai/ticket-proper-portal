# itsm-dashboards — Bug Log / Gotchas

- **Built.** `SavedFilter`/`Dashboard`/`Widget`/`DashboardShare` models + migration `0001` exist;
  serializers/views/urls wired. The `query_builder` it depends on lives in
  `itsm_tickets/services/query_builder.py` (`build_q` / `filtered_tickets`), not in this app.
- **`query_spec` must be whitelist-translated, never `eval`'d.** `query_builder` is a security
  boundary: only allow known fields + operators (`eq/in/isnull/gte/lte/contains/...`). An arbitrary
  field path or operator must 400, not reach the ORM. This is the #1 thing to get right here.
- **Shared dashboards don't bypass RBAC.** A share grants visibility of the dashboard layout, not the
  data — each widget's underlying query is still gated by the viewer's permissions. Don't render
  tickets a viewer couldn't see in the queue.
- **Bulk ops reuse the same selection semantics.** `POST tickets/bulk/` (override module
  `itsm.tickets.bulk`) selects via a `SavedFilter`/`query_spec`; if the queue and bulk use different
  filter logic, "select all matching" silently diverges. Share `query_builder` between them.
- **Custom-field filters are the perf trap** (same as reporting): `query_spec` conditions on a
  `FieldValue` need prefetch + GIN indexes; standard-column conditions are cheap.
- **Widget data source must validate its target.** A widget pointing at a deleted `SavedFilter` or an
  unknown report key should degrade gracefully (empty/error tile), not 500 the whole dashboard.
- **Grid geometry round-trips on save.** Persist `x/y/w/h` per widget so a drag/resize survives a
  reload; don't recompute layout server-side.
