# itsm-reporting — Bug Log / Gotchas

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
