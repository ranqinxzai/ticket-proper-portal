# itsm-sla — API Contracts

**Status: built.** `itsm_sla/urls.py` registers the router below; endpoints are live under
`/api/v1/itsm/`. Shapes follow the approved plan.

## Business calendars / holidays / hours — `itsm.sla.calendars`
- `GET|POST business-calendars` — `{ id, name, timezone, is_default, hours (RO nested), holidays (RO nested) }`.
- `GET|POST|PATCH|DELETE business-hours` `?calendar=&weekday=` — `{ id, calendar, weekday (0=Mon..6=Sun),
  start_time, end_time }`. **Per-row CRUD** (the calendar serializer nests `hours` read-only). **Multiple
  rows per weekday are allowed** (split shifts) — there is deliberately **no `(calendar, weekday)` unique
  constraint**; `business_time.spec_from_calendar` aggregates them. `400` if `end_time <= start_time`.
- `GET|POST|PATCH|DELETE holidays` `?calendar=` — `{ id, calendar, date, name, recurring_annually }`.

The settings calendar editor (`/agent/w/[key]/settings/calendar`) drives these. Calendars are a **shared
global library** (no helpdesk FK); a project picks which calendar its SLA clocks use via `Project.calendar`
(see itsm-projects), which `sla_engine.start_trackers` prefers over the policy/default calendar.

## SLA policies / metrics — `itsm.sla.policies`
- `GET|POST sla-policies` — `{ id, name, project, calendar, metrics:[SLAMetric] }`.
- `GET|POST sla-metrics` — `{ id, policy, key:"first_response|resolution|...", targets:[{priority,
  minutes}] }`.
- `GET|POST sla-targets` — `{ id, metric, priority, minutes }` (per-priority budget rows).

## Escalations — `itsm.sla.policies`
- `GET|POST escalation-rules` — `{ id, metric, threshold_pct, action:"notify|reassign|
  raise_priority", config }`.

## Trackers (read-only) — `itsm.sla`
- `GET sla-trackers` (RO) `?ticket=&metric=` — `{ id, ticket, metric, started_at, due_at, state,
  rag, breached, breached_at, paused_remaining_minutes }`.

## Ticket countdown
- `GET tickets/{id}/sla/` → array of metric clocks with absolute `due_at` + `state` + `rag` +
  paused remaining (client ticks locally; no per-second polling).

## Error codes (intended)
- `400` — calendar with no business hours; target budget invalid.
- `422`/`MisconfiguredCalendar` — `add_business_minutes` can't resolve a due date within the 2-year
  guard (e.g. zero working days).
- `403` — Agent attempting policy/calendar writes.
