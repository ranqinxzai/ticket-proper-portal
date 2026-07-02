# itsm-sla — Interlinking

## Will depend on
- **itsm-core** — `BaseModel`; implements the functions `itsm_core.services.hooks` calls.
- **itsm-tickets** — `SLATracker.ticket`; reads first-class lifecycle timestamps
  (`first_responded_at`, `resolved_at`); `create_ticket` fires the hook into
  `sla_engine.start_trackers`.
- **itsm-workflows** — `on_status_change` drives start/stop/pause/resume; pause statuses + the
  `start/stop/pause/resume_sla` post-functions originate in the workflow seed/engine. Also reads
  **`Status.pauses_sla`** ("Exclude from SLA") to pause all clocks on a Hold-type state (unioned with
  `SLAMetric.pause_statuses` for resolution).
- **itsm-projects** — `SLAPolicy.project` scope; `Ticket` snapshots `sla_policy`/`calendar`.
- **itsm-notifications** — escalation `notify` action emits `SLAWarning`/`SLABreach` via the bus.

## Depended on by
- **itsm-tickets** — the detail right pane reads `tickets/{id}/sla/` countdown widgets.
- **itsm-reporting / itsm-dashboards** — the live `sla-compliance` report + SLA-gauge widgets
  aggregate tracker outcomes (live queries; no snapshot table).

## Hook contract (present in itsm_core)
`sla_engine.start_trackers / on_status_change / pause / resume / stop`. This app now exposes those
callables, so the hooks resolve to them and SLA is live across the ticket/workflow code without any
changes there.
