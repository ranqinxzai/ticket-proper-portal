# itsm-sla — User Flows

## Flow A — Supervisor defines an SLA
1. Create a `BusinessCalendar` (tz, working days/hours) + `Holiday`s.
2. Create an `SLAPolicy` for a project, with `SLAMetric`s (first-response, resolution) and
   per-priority `SLATarget` budgets.
3. Attach escalation rules (75/90/100% → notify/reassign/raise_priority).

## Flow B — Clock runs on a ticket
1. On create, the `itsm_core` hook calls `sla_engine.start_trackers(ticket)`; `due_at` computed via
   business time.
2. The ticket detail shows countdown + RAG widgets ticking locally from the absolute `due_at`.
3. Moving to a pause status freezes `due_at` and opens a pause interval; resuming recomputes it.
4. A public first reply stamps `first_responded_at`, stopping the first-response clock.
5. Resolving stops the resolution clock.

## Flow C — Breach + escalation
1. The ~1-min sweep flips `breached`, stamps `breached_at`.
2. At each threshold it fires the escalation action once (idempotent via the escalation log) —
   e.g. emits `SLAWarning`/`SLABreach`, reassigns, or raises priority (→ recompute).

## Flow D — Reporting
SLA compliance feeds the live `sla-compliance` report and the SLA-compliance / gauge widgets
(reporting runs live queries over tracker outcomes; there is no snapshot table).
