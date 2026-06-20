# itsm-reporting — Architecture

## Current state
`backend/apps/itsm_reporting/` is **BUILT** for the live query services: `services/reports.py`
(the `REPORTS` dict of live aggregate functions) and `services/widget_data.py`
(`resolve(widget, user)`), exposed through `ReportViewSet` (`views.py` / `urls.py`). It has **no
models and no tables** — reports compute live over `Ticket`/`SLATracker`. The nightly snapshot tier
described below is a **future optimization that is not yet built** (no `aggregate_nightly` job
exists).

## Layout (current + planned snapshot tier)
```
itsm_reporting/
  services/
    reports.py       # BUILT — live aggregate queries (REPORTS dict)
    widget_data.py   # BUILT — resolve(widget, user) for dashboard widgets
  views.py / urls.py # BUILT — ReportViewSet, module itsm.reports
  models/            # EMPTY today; planned snapshot tables (TicketDailyStat,
                     # AgentDailyStat, SLAComplianceStat) remain a deferred optimization
  # planned (not built): nightly aggregation job + scheduler wiring
```

## Design decisions
- **Two-tier design: live aggregates (built) + nightly snapshots (deferred).** All reports —
  including trends — currently run **live** aggregates over the indexed `Ticket`/`SLATracker`
  columns. The planned second tier (pre-computed snapshot tables read by trend reports to avoid
  re-scanning the hot table) is **not built**; the API shape is stable so it can be added later
  without changing the contract.
- **One RO action per standard report** returning chart-ready JSON (series + labels) so the frontend
  `ReportShell` + Recharts can render without reshaping. CSV export reuses the same query.
- **Uniform filter contract** — every report accepts date range + project/group + group-by; the
  service applies them consistently. Leverages the same `query_builder` (`query_spec`→Q) the
  dashboards saved-filters use for ad-hoc slices.
- **Snapshots populated nightly (planned, not built).** When added, snapshots would be populated by a
  nightly `aggregate_nightly` job via the scheduler, one namespaced `DjangoJobStore` job, idempotent
  per day (upsert by date key) so a re-run or catch-up doesn't double-count. No such job exists today.
- **Reads first-class columns + SLA trackers.** Because standard ITIL fields live on `Ticket` and SLA
  outcomes on `SLATracker`, reporting joins indexed columns — custom-field reporting is the
  perf-sensitive extension (GIN indexes).

## Standard report set (plan)
Ticket volume/trend, by-status, by-priority, by-group, SLA compliance, agent performance
(throughput/first-response/resolution), average resolution time, backlog/aging, reopen rate.

## Scheduler wiring (planned, not built)
The snapshot tier would have `AppConfig.ready()` start `reporting.aggregate_nightly` behind
`settings.RUN_SCHEDULER` (`max_instances=1, coalesce=True, misfire_grace_time=60`). This is not
implemented — there is no `aggregate_nightly` job and `apps.py` does not start one.
