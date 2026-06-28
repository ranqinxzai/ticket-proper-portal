# itsm-sla — DB Schema

**Status: built.** Tables are defined in `itsm_sla/models.py` (a single module) and created by
`migrations/0001_initial.py`. Models (all `BaseModel` unless noted); shapes from the approved plan.

## `BusinessCalendar` / `BusinessHours` / `Holiday`
- `BusinessCalendar`: `name`, `timezone` (IANA, used via `ZoneInfo`), `is_default`. **Global/shared** —
  no helpdesk FK. A project pins one via `itsm_projects.Project.calendar` (preferred by
  `sla_engine.start_trackers` over the policy/default calendar).
- `BusinessHours`: `calendar` (FK), `weekday` (0=Mon..6=Sun), `start_time`, `end_time`.
  **NO `(calendar, weekday)` unique constraint** — multiple windows per weekday are intentional
  (split shifts), aggregated by `business_time.spec_from_calendar` (`windows.setdefault(weekday, [])`).
  Editable via the `business-hours` endpoint; the serializer rejects `end_time <= start_time`.
- `Holiday`: `calendar` (FK), `date`, `name`, `recurring_annually`. Unique `(calendar, date)`. Excluded
  from working windows.

## `SLAPolicy` / `SLAMetric` / `SLATarget`
- `SLAPolicy`: `name`, `project` (FK, scope), `calendar` (FK).
- `SLAMetric`: `policy` (FK), `key` (first_response/resolution/…), pause-status mapping.
- `SLATarget`: `metric` (FK), `priority`, `minutes` (budget) — one per priority.

## `SLATracker` (runtime row the UI reads)
`ticket` (FK), `metric` (FK), `started_at`, `due_at`, `state`, `breached` (bool),
`breached_at`, `paused_remaining_minutes`. Likely unique `(ticket, metric)`.

## `SLAPauseInterval`
`tracker` (FK), `paused_at`, `resumed_at` (null while open). Resume recomputes `due_at` from
`started_at` + budget + total paused business minutes.

## `EscalationRule` / `SLAEscalationLog`
- `EscalationRule`: `metric` (FK), `threshold_pct` (75/90/100), `action`
  (notify/reassign/raise_priority), `config` JSON.
- `SLAEscalationLog`: `tracker`/`clock` (FK), `threshold`, `fired_at`. **Unique `(clock,
  threshold)`** → idempotent escalation firing.

## Indexes (intended)
`SLATracker(due_at)` + a partial index on un-breached open clocks for the breach sweep;
`(ticket, metric)`.

## Config snapshot
Design: snapshot `Ticket.sla_policy` + `Ticket.calendar` (FKs) so config edits don't strand
in-flight clocks. These FKs are **not yet present** on `itsm_tickets.Ticket`; the engine resolves
the active policy/calendar at runtime today, so this snapshot approach remains a design note.
