# itsm-sla

## Purpose
Full SLA engine: business calendars + holidays, SLA policies/metrics/targets, per-ticket
runtime trackers with DST-correct business-time math, pause/resume, a breach sweep, and
escalations. **Status: built** — `backend/apps/itsm_sla/` is fully implemented and validated:
`models.py`, `services/sla_engine.py`, `business_time.py`, `serializers.py`, `views.py`,
`urls.py`, `seed.py`, `scheduler.py`, and `migrations/0001_initial.py`. This skill documents
the design (plan deliverable 10); the cross-engine hooks it satisfies live in `itsm_core` and
now drive this engine.

## Update (2026-07-02) — per-status "Exclude from SLA" pauses ALL clocks
- `on_status_change` now honors a new per-status flag **`itsm_workflows.Status.pauses_sla`**: entering a
  flagged status pauses **all** of the ticket's running clocks (resolution **and** first_response **and**
  assignment) and resumes them on leaving. This is the UI-driven provision for a **Hold** state — the
  admin ticks "Exclude from SLA" on the status (Workflow settings tab), no `pause_sla` post-function
  needed. File: `services/sla_engine.py`.
- The flag is read with `getattr(to_status, "pauses_sla", False)` (the cross-engine hook swallows
  errors, so a missing attribute would silently disable pausing). For the **resolution** clock the pause
  decision is the **union** of the flag and the legacy per-metric `SLAMetric.pause_statuses` (so the
  seeded `pending` behavior is unchanged); first_response/assignment pause on the **flag only**.
- Idempotent with the seeded `pending` `pause_sla`/`resume_sla` post-functions: `pause()`/`resume()` are
  state-guarded, so the hook + post-function on the same status produce exactly one pause/resume.
- Known pre-existing quirk (unchanged): `stop()` does not close a still-open `SLAPauseInterval`, so
  resolving directly from a paused state leaves that final window uncounted in `total_paused_minutes`.
- Tests: `itsm_sla.tests.SlaPauseFlagTests`. (Also fixed the pre-existing `FirstResponseStopTests` to
  run its `create_ticket`/transitions inside `captureOnCommitCallbacks` — SLA side-effects fire on
  `transaction.on_commit`, which `TestCase` does not run otherwise.)

## Update (2026-06-23) — First response: in-progress no longer counts as "responded"
- **Behaviour change:** `sla_engine.on_status_change` used to stop the **first-response** clock when
  the ticket entered *either* `in_progress` *or* `done`. So simply clicking **Start Progress** (no
  reply to the requester) marked **Time to First Response = Met** while `first_responded_at` stayed
  `None` — overstating the metric (repro: ITINC-606, created → Assign → Start Progress in ~55s, zero
  comments, yet "Met").
- **Now:** the `first_response` status branch is **`done`-only** (mirrors `resolution`, keyed off
  `to_done`). First response is satisfied by the **first public reply** (`add_comment` → `sla_stop`)
  *or* by **resolving** the ticket; moving to in-progress leaves the clock **running**. File:
  `backend/apps/itsm_sla/services/sla_engine.py`. Regression test:
  `itsm_sla.tests.FirstResponseStopTests`. See BUG_LOG (ITINC-606).

## Update (2026-06-23) — Stopped clocks render their outcome, not a live countdown
- **Bug fixed:** a first-response clock stopped as **breached** (the agent replied, but *late*) showed
  in the detail **SLA panel** as a red **"12h 0m overdue"** — indistinguishable from a still-running,
  unanswered overdue clock — so it looked like the reply hadn't registered. Root cause was **display
  only**: the engine was correct (`add_comment` stamps `first_responded_at` + calls
  `sla_stop(ticket, "first_response")`; `stop()` ends it `met` if `now<=due_at` else `breached`, and
  freezes `stopped_at`). A late first response is *legitimately breached* — responding does not
  un-breach a missed SLA.
- **Fix:** both renderers now key off the tracker `state`. A **stopped** clock (`met` / `breached` /
  `stopped`) shows its **outcome** — "Met" / "Breached"; only a **running** clock shows the live
  "Xh left" / "Xh overdue". Files: `frontend/components/tickets/sla-panel.tsx` (`statusLabel`, detail
  pane) and `frontend/components/tickets/queue-columns.tsx` (`SlaBar` — its `done` check was missing
  `breached`, so a breached-stopped clock fell through to a live, ever-growing "Xh over"). No backend
  change; `countdown_payload` already returns `state`. See BUG_LOG (ITINC-605).

## Update (2026-06-21) — SLA config UI + queue bars (frontend)
- **Config UI built** — project settings → **SLA** tab (`components/settings/sla-editor.tsx`).
  Supervisors (`itsm.sla.policies`) create the project policy + First Response & Resolution metrics
  with per-priority minute targets (e.g. Critical 30m response, Low 4h) and a calendar; CRUD via the
  existing `/sla-policies/ /sla-metrics/ /sla-targets/` endpoints (frontend `slaPoliciesApi /
  slaMetricsApi / slaTargetsApi`). The engine auto-starts clocks on ticket create
  (`hooks.sla_start_for_ticket` → `resolve_policy` → `start_trackers`); no model change.
- **Queue SLA bars** — the ticket list serializer returns a compact per-metric `sla` payload
  (Response + Resolution) rendered as RAG progress bars in the queue (see itsm-tickets). The bar's RAG
  is a cheap wall-clock fraction; the exact business-time figure stays on `/tickets/{id}/sla/`.

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
