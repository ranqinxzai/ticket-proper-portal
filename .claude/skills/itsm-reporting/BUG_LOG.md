# itsm-reporting — Bug Log / Gotchas

- **`?format=xlsx|csv` exports 404'd before the view ran (FIXED 2026-06-24).** `?format=` collides
  with DRF's `URL_FORMAT_OVERRIDE` (default `'format'`): content negotiation in `initial()` looked for
  an `xlsx`/`csv` renderer, found none, and raised `Http404` — so **every** report Download/Export-all
  silently 404'd (it had never worked). Fix: `ReportViewSet` pins `renderer_classes=[JSONRenderer]` and
  a `ReportContentNegotiation.select_renderer` that always returns the JSON renderer; the view reads
  `format` from the query itself. Lesson: don't name an app query param `format` on a DRF view (or
  override negotiation if you must). Covered by `tests.ReportRangeGuardViewTests.test_export_single_returns_file_not_404`.
- **`date_to` was exclusive of its own day (FIXED 2026-06-24).** `created_at__lte=<date>` compares
  against midnight, dropping everything created on the `to` day. Switched `_base` (and `sla_breach_list`/
  `sla_compliance`) to `__date__gte`/`__date__lte` so the range is day-inclusive. The boundary truncates
  in the **server tz** (`settings.TIME_ZONE` = UTC), i.e. the UTC calendar day — not the viewer's local
  (IST) day. Tickets within a few hours of a tz day-edge attribute to the adjacent UTC day; acceptable
  given UTC storage everywhere. If reports must align to the IST business day, set a per-connection
  `TIME_ZONE` on `DATABASES['default']` (app-wide change — out of scope here).
- **6-month range cap.** `_validate_range` 400s when **both** bounds are present and span > 186 days
  (or reversed/invalid). It must NOT fire on the dashboard's open-ended `days`-only calls — guard on
  *both* bounds being present. For a full year, the UI downloads in two ≤6-month parts.
- **Trend reports take an explicit window OR `days`.** `volume-trends`/`resolution-trends`/
  `created-vs-resolved` use `_window(days, date_from, date_to)` → explicit range wins, else `days` back
  from today (open-ended). Don't reintroduce a `days`-only `_daily` — it ignored the per-report range.
- **Built (live query services).** The report actions are built and live: `ReportViewSet` exposes
  `reports/` + `reports/<name>/` over the `REPORTS` dict in `services/reports.py`.
- **No snapshot tables (by design, deferred).** There are no `TicketDailyStat`/`AgentDailyStat`/
  `SLAComplianceStat` tables and no `aggregate_nightly` job — trends compute live today.
- **Snapshot job (when built) must be idempotent per day.** Upsert by the `(date, dimensions)` key so
  a re-run or a catch-up after downtime doesn't double-count. Never blind-insert daily rows.
- **"Open" / "done" depend on status category, not status name.** Backlog/aging must filter by
  `status__category__key` (`done` vs not), consistent with the rest of ITSM — custom statuses
  miscategorized will skew counts.
- **Live trend reports over the hot table get slow.** Use the nightly snapshots for trends; reserve
  live aggregates for point-in-time slices. Don't scan 90 days of `Ticket` on every page load.
- **Date ranges are timezone-sensitive.** Bucketing by day must agree with the SLA business calendar
  / project tz, or counts straddle midnight boundaries inconsistently.
- **Custom-field reporting is the perf trap.** Grouping by a `FieldValue` (esp. multiselect/json)
  needs GIN indexes + prefetch; standard-column reports are cheap because those are indexed Ticket
  columns.
- **Reports are read-only.** No report endpoint should mutate; the only writer is the nightly
  `aggregation_job`.
