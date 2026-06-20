# itsm-sla — API Contracts

**Status: built.** `itsm_sla/urls.py` registers the router below; endpoints are live under
`/api/v1/itsm/`. Shapes follow the approved plan.

## Business calendars / holidays — `itsm.sla.calendars`
- `GET|POST business-calendars` — `{ id, name, timezone, business_days, hours, is_default }`.
- `GET|POST holidays` — `{ id, calendar, date, name }`.

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
