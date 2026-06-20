# itsm-sla — Architecture

## Current state
`backend/apps/itsm_sla/` is fully built and validated: models, the engine, business-time math, the
breach-sweep scheduler, serializers/views/urls, and a seed all exist, with
`migrations/0001_initial.py` applied. Models live in a single `models.py` module (not a `models/`
package). The design below (deliverable 10) is the shipped design.

## Layout
```
itsm_sla/
  models.py         # BusinessCalendar, BusinessHours, Holiday, SLAPolicy, SLAMetric, SLATarget,
                    # SLATracker, SLAPauseInterval, EscalationRule, SLAEscalationLog (one module)
  services/
    sla_engine.py     # start_trackers/on_status_change/pause/resume/stop/recompute/
                      # countdown_payload/scan_breaches
  business_time.py    # add_business_minutes, business_minutes_between (pure, unit-tested; app root)
  serializers.py / views.py / urls.py / seed.py
  scheduler.py        # breach-sweep job wiring
  apps.py             # AppConfig.ready() starts the breach-sweep job behind RUN_SCHEDULER
  migrations/0001_initial.py
```

## Design decisions
- **`SLATracker` is the runtime source of truth the UI reads** — one per ticket-per-metric, holding
  `started_at`, `due_at`, `state`, `breached`/`breached_at`, and paused remaining.
- **Business-time arithmetic is pure and unit-tested** (`business_time.py`): materialize working
  windows as sorted UTC intervals from `(timezone, business_days, hours, holidays)` via `ZoneInfo`
  (DST-correct). `add_business_minutes(start, budget) → due` uses a lazy day generator with a 2-year
  guard (`MisconfiguredCalendar`); `business_minutes_between(a, b) → int`.
- **Pause/resume recomputes from first principles.** Entering a pause status freezes `due_at` and
  opens an `SLAPauseInterval`; on resume,
  `due_at = add_business_minutes(started_at, budget + total_paused_business_minutes)` — robust to
  multiple pause cycles and to calendar edits.
- **Breach detection is hybrid.** Computed-on-read is authoritative for the UI; an APScheduler
  **breach sweep (~1 min)** flips `breached`, stamps `breached_at`, and fires escalations
  idempotently. Idempotency: `SLAEscalationLog` has a unique `(clock, threshold)` written in the
  action transaction.
- **Escalations at 75/90/100%** → notify / reassign (narrow `set_assignee`, no transition) /
  raise_priority (→ recompute).
- **Recompute triggers:** status change, assignment, priority change, calendar/holiday edit
  (+ a nightly safety sweep + cache-bust).
- **Countdown payload** returns an absolute `due_at` + `state` + `rag` + paused remaining so the
  client ticks locally — **no per-second server calls**.

## Integration seam
The engine is driven through the hooks in `itsm_core.services.hooks`
(`start_trackers`/`on_status_change`/`pause`/`resume`/`stop`), called post-commit from the ticket
and workflow services. Those functions are exposed on `apps.itsm_sla.services.sla_engine` and the
hooks now resolve to them (the lazy import succeeds, so the calls run live). Config snapshot
(design): the `Ticket` would snapshot its `sla_policy`/`calendar` at create time so later edits
don't strand in-flight clocks — those FKs are not present on `itsm_tickets.Ticket` yet, so the
engine currently resolves the policy/calendar at runtime.

## Scheduler wiring
`AppConfig.ready()` calls `should_run_scheduler()` and, when enabled, starts the scheduler. The
`sla.breach_sweep` job runs on an interval (default 1 min) via `BackgroundScheduler` + a
`DjangoJobStore`, with `replace_existing=True, max_instances=1, coalesce=True,
misfire_grace_time=60`. The gate (`apps.itsm_core.scheduler_boot.should_run_scheduler`) ties this to
`settings.RUN_SCHEDULER` and avoids management-command / double-start runs.
