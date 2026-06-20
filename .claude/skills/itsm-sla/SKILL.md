# itsm-sla

## Purpose
Full SLA engine: business calendars + holidays, SLA policies/metrics/targets, per-ticket
runtime trackers with DST-correct business-time math, pause/resume, a breach sweep, and
escalations. **Status: built** — `backend/apps/itsm_sla/` is fully implemented and validated:
`models.py`, `services/sla_engine.py`, `business_time.py`, `serializers.py`, `views.py`,
`urls.py`, `seed.py`, `scheduler.py`, and `migrations/0001_initial.py`. This skill documents
the design (plan deliverable 10); the cross-engine hooks it satisfies live in `itsm_core` and
now drive this engine.

## Backend app path
`backend/apps/itsm_sla/` (built; models/services/urls/scheduler/seed all authored).

## Key concepts
- **`BusinessCalendar`/`BusinessHours`/`Holiday`** — timezone + working days/hours + holidays;
  materialized into sorted UTC working windows (DST-correct via `ZoneInfo`).
- **`SLAPolicy`/`SLAMetric`/`SLATarget`** — a policy bundles metrics (e.g. first-response,
  resolution) each with a per-priority target budget.
- **`SLATracker`** — the runtime row the UI reads, one per ticket-per-metric: `started_at`,
  `due_at`, `state`, `breached`/`breached_at`, paused remaining. `SLATrackerViewSet.get_queryset` is
  **helpdesk-scoped** — filters `ticket__project__helpdesk_id__in` to the requester's accessible
  helpdesks (superuser unrestricted), so an agent can't enumerate another helpdesk's SLA/breach state.
- **`SLAPauseInterval`** — open/closed pause windows; resume recomputes `due_at` from first
  principles.
- **`EscalationRule`/`SLAEscalationLog`** — thresholds (75/90/100%) → notify / reassign /
  raise_priority; the log's unique `(clock, threshold)` makes firing idempotent.
- **`sla_engine`** — `start_trackers`, `on_status_change`, `pause`, `resume`, `stop`, `recompute`,
  `scan_breaches`; `business_time.py` (`add_business_minutes`, `business_minutes_between`).

## The hooks it must implement (already called from itsm_core)
`sla_engine.start_trackers(ticket)`, `sla_engine.on_status_change(ticket, from_status, to_status)`,
`sla_engine.pause(ticket, metric)`, `sla_engine.resume(ticket, metric)`, `sla_engine.stop(ticket,
metric)` — invoked from `itsm_core.services.hooks`, which now resolve to this engine and drive it
live (lazy import succeeds; calls are no longer no-ops).

## Frontend path / pages (planned)
SLA Policy Editor (calendar + metrics + escalations); countdown / RAG widgets in the ticket detail
right pane (client ticks locally from an absolute `due_at` payload).

## API clients
`sla-policies`, `sla-metrics`, `sla-targets`, `business-calendars`, `holidays`, `sla-trackers`
(read-only), `escalation-rules`; plus `GET tickets/{id}/sla/` for the countdown payload.

## RBAC module codes
- Policies/metrics/trackers/escalations → **`itsm.sla.policies`** (or `itsm.sla`).
- Calendars/holidays → **`itsm.sla.calendars`**.
Agent: read-only on `itsm.sla`; Supervisor: full.

## Key files
`models.py` (single module: calendars, policies, trackers, escalations), `services/sla_engine.py`,
`business_time.py` (app root), `serializers.py`, `views.py`, `urls.py`, `seed.py`,
`scheduler.py`, `migrations/0001_initial.py`.
