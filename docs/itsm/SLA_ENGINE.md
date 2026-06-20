# SLA Engine — ITSM Platform

Design for `itsm_sla` (planned, **M5**). Integration points exist today: ticket/workflow services call `hooks.sla_*` inside `transaction.on_commit`; those bridges lazily route to `sla_engine` and no‑op until the app is built. This is the highest‑risk engine (DST/holiday/pause math + idempotent breach sweep).

---

## 1. Data Model

| Entity | Purpose |
|---|---|
| **`BusinessCalendar`** | timezone + working‑day set; the basis for business‑time math. |
| **`BusinessHours`** | per‑weekday working windows (e.g. Mon–Fri 09:00–17:00). |
| **`Holiday`** | date(s) excluded from working time, tied to a calendar. |
| **`SLAPolicy`** | a named policy (per project / ticket type) bundling targets. |
| **`SLAMetric`** | a measurable clock, e.g. `first_response`, `resolution`. |
| **`SLATarget`** | budget (minutes) per metric per priority, + which calendar. |
| **`SLATracker`** | **the runtime row the UI reads** — one per `(ticket, metric)`: `started_at`, `due_at`, `paused`, `breached`, `breached_at`, `total_paused_minutes`, `state`. |
| **`SLAPauseInterval`** | an open/closed pause window for a tracker. |
| **`EscalationRule`** | threshold (75/90/100%) → action (notify / reassign / raise_priority). |
| **`SLAEscalationLog`** | idempotency ledger; **unique `(clock, threshold)`** so an escalation fires once. |

The ticket stores its **calendar snapshot** so calendar edits don't strand in‑flight clocks.

## 2. Business‑Time Arithmetic (`business_time.py` — pure, unit‑tested)

Materialize working windows as **sorted UTC intervals** from `(timezone, business_days, business_hours, holidays)` via `ZoneInfo` (DST‑correct). Two primitives:

```python
add_business_minutes(start, budget_minutes) -> due_datetime
business_minutes_between(a, b) -> int
```

- `add_business_minutes` uses a **lazy day generator** with a **2‑year guard** that raises `MisconfiguredCalendar` (e.g. a calendar with zero working days would otherwise loop forever).
- `business_minutes_between` sums only the overlap of `[a, b]` with the working windows.
- Edge cases the tests must cover: **DST spring‑forward / fall‑back**, a holiday landing inside a window, a budget spanning **multiple days**, a start time **inside a non‑working gap**, and the **0‑business‑day** guard.

## 3. Clock Lifecycle

`sla_engine` choke‑points (called via `hooks`):
| Function | When |
|---|---|
| `start_trackers(ticket)` | on create (and on reopen) → create `SLATracker`s for the policy's metrics; `due_at = add_business_minutes(started_at, budget)`. |
| `on_status_change(ticket, from, to)` | recompute on relevant status moves. |
| `pause(ticket, metric)` | entering a pause status. |
| `resume(ticket, metric)` | leaving a pause status. |
| `stop(ticket, metric)` | metric satisfied (e.g. resolved). |
| `recompute(...)` | on assignment / priority / calendar / holiday change. |
| `scan_breaches()` | the scheduler sweep. |

These are wired into the seeded Incident workflow: *Put on Hold* → `pause_sla(resolution)`, *Resume* → `resume_sla(resolution)`, *Resolve* → `stop_sla(resolution)`. First **public** comment stamps `first_responded_at` (the first‑response metric's stop signal).

## 4. Pause / Resume (recompute from first principles)

- **On pause:** freeze `due_at`, open an `SLAPauseInterval`.
- **On resume:** close the interval, then **recompute from scratch**:

```
due_at = add_business_minutes(started_at, budget + total_paused_business_minutes)
```

Recomputing from first principles (rather than incrementally nudging) is **robust to multiple pause/resume cycles and to calendar/holiday edits** mid‑flight.

## 5. Breach Detection — Hybrid

- **Computed‑on‑read is authoritative for the UI:** given `due_at`, `paused`, and the calendar, the client/serializer can tell whether a clock is breaching *right now* without waiting for a job.
- **A scheduler sweep** (`sla.breach_sweep`, ~1 min, `DjangoJobStore`) is the durable backstop: it flips `breached=True`, stamps `breached_at`, and fires escalations — **idempotently**. The `SLAEscalationLog` unique `(clock, threshold)` row is written in the same action transaction, so a re‑run can't double‑escalate.

## 6. Escalations

`EscalationRule` thresholds at **75% / 90% / 100%** of the budget trigger actions:
| Action | Effect |
|---|---|
| `notify` | emit `SLAWarning` (75/90) / `SLABreach` (100) → notification engine. |
| `reassign` | a **narrow `set_assignee`** (e.g. to group lead) — **not** a workflow transition, so it doesn't move status. |
| `raise_priority` | bump priority → triggers a **recompute** of the budget. |

Each escalation is gated by the idempotency ledger so it fires exactly once per `(clock, threshold)`.

## 7. Recompute Triggers
A tracker is recomputed when any input changes: **status**, **assignment**, **priority**, **calendar/holiday** edits — plus a **nightly safety sweep** (`sla.calendar_recompute_nightly`) that re‑derives clocks and busts caches.

## 8. Countdown Payload (`GET /tickets/{id}/sla`)

Returns enough for the client to **tick locally with no per‑second server calls**:

```jsonc
{
  "metrics": [
    {
      "metric": "resolution",
      "state": "running",            // running | paused | met | breached
      "due_at": "2026-06-18T15:00:00Z",
      "rag": "amber",                // green | amber | red, by % consumed
      "paused": false,
      "remaining_paused_minutes": 0  // when paused, the frozen remainder
    },
    { "metric": "first_response", "state": "met", "due_at": "…", "rag": "green" }
  ]
}
```

The UI computes the live countdown from the absolute `due_at` (and the frozen remainder when paused), so the server isn't polled every second.

## 9. Scheduler Jobs
| Job | Cadence | Purpose |
|---|---|---|
| `sla.breach_sweep` | ~1 min | flip `breached`, fire idempotent escalations. |
| `sla.calendar_recompute_nightly` | nightly | safety recompute + cache‑bust. |
All under one `DjangoJobStore`, `max_instances=1, coalesce=True, misfire_grace_time=60`, gated by `RUN_SCHEDULER`.

## 10. Audit Integration
SLA milestones are logged to the ticket activity feed via `log_event` (action enum already includes `sla_started`, `sla_paused`, `sla_resumed`, `sla_breached`), so the SLA timeline is visible in History.

## 11. Risk Checklist (from the plan)
- DST correctness (spring/fall) and holiday‑spanning windows.
- Recompute‑from‑first‑principles across multiple pause cycles + calendar edits.
- Idempotent sweep + escalation ledger (no double‑escalation).
- 0‑business‑day / misconfigured‑calendar guard.
- Countdown payload accuracy so the UI doesn't drift from the server.
