# itsm-sla

## Update (2026-11-05c) — Approval pauses (labelled); one "should pause" rule
- **Who pauses:** a status (`pauses_sla` / `pause_statuses`), a `pause_sla` post-function, or now a pending approval whose
  request has `pause_sla` (`_approval_pauses`). Approval kinds: first_response, resolution, assignment (`_APPROVAL_KINDS`).
- **Labels:** pauses the approval makes carry `SLAPauseInterval.reason = "approval"`; status / post-function pauses stay "".
  Ending the approval (`sync_pauses`) releases ONLY approval-labelled pauses (relabel "" if the status still pauses, else
  resume + `_sync_due_date`). `pause()` takes over an approval pause (→ ""); `resume()` is a no-op while an approval holds the
  clock (relabels it "approval"). `on_status_change` → `_apply_pause(status_pause, approval)` (identical to before when there
  is no approval); `start_trackers` starts clocks paused when an approval already holds them (create-transition approvals start
  first); `on_priority_change` pauses started / restored clocks the same way. `_should_pause(ticket, metric, approval)` =
  `_status_pauses(...)` or approval.
- **Read:** `countdown_payload(..., with_reason=True)` adds `pause_reason` ("approval" | None) — only `tickets/{id}/sla/`
  asks (one query per clock); the queue list doesn't.
- **Audit:** `sla_paused` / `sla_resumed` payload `reason: "approval"` for approval pauses.
- **Known (pre-existing, logged):** `resume()` doesn't refresh `Ticket.due_date`; `sync_pauses` does.
- **Correction:** the 2026-07-02 note "`stop()` does not close a still-open pause" is out of date — `stop()` closes it (C3,
  2026-10-18), so a first reply during an approval meets the response clock with the hold excluded.
- Tests: `itsm_approvals.tests.ApprovalSlaPauseTests` / `SentApprovalSlaPauseTests`.

## Update (2026-10-29) — Deleted tickets: clocks stop, the sweep skips them
- **`sla_engine.withdraw_for_ticket(ticket)`** freezes every unfinished clock as `stopped` (open pause closed, `stopped_at` = now). Neither met nor breached; reporting already excludes `stopped`. Called only by `ticket_service.delete_ticket`.
- **`scan_breaches`** sweeps `SLATracker.objects.filter(state="running", ticket__is_deleted=False)`. Before, a deleted ticket's clock kept breaching and emailing SLABreach/SLAWarning (GridCrest REQ14).
- Each tracker runs in `_scan_tracker` inside its own `transaction.atomic()` + try/except (`logger.exception`). One bad clock (e.g. an escalation hitting `DoesNotExist`) no longer aborts the rest of the org's sweep.
- Old deletes are cleaned by `itsm_tickets/0013_quiesce_deleted_tickets`. See itsm-tickets 2026-10-29.

## Update (2026-10-18) — Bug-fix batch: blank target = no SLA, priority re-targeting, recurring holidays, hours-less calendars, one progress function
- **Blank target = no SLA (B8).** `_target_minutes` returns `None` and no tracker starts. The `metric.targets.first()` / 480-min fallback is gone. `start_trackers` checks with `all_objects`.
- **Priority changes re-target (B8).** Use `sla_engine.on_priority_change(ticket, old, new, *, start_missing=True)`, called only via `hooks.sla_priority_changed`:
  - re-targets unfinished clocks, keeping their start and pauses
  - withdraws a clock whose new target is blank (soft delete + `due_date` cleared, so it never counts as met)
  - restores a withdrawn clock
  - starts missing clocks backdated to the start, unless the stop event already happened; paused at once if the current status pauses
  - leaves finished clocks untouched
  - re-derives `breached`, as in JSM

  Audit: `field_changed` with key `sla`. It locks with `select_for_update(of=("self",))`. Call sites:
  - `update_ticket._after`, which also covers impact×urgency, automation `set_field` and bulk
  - `move_ticket` (`start_missing=False`)
  - escalation `raise_priority` (now goes through `update_ticket`)
  - the workflow engine's `set_priority` / screen priority
- **Recurring holidays (B7).** `CalendarSpec.annual_holidays` + `is_holiday` (`business_time.py`). A recurring holiday applies from the entered year on; 29 Feb → 28 Feb. `spec_from_calendar` is the only place holidays are evaluated.
- **Hours-less calendars (B9/C1).**
  - Treated as 24×7 in the calendar's tz (`always_open_spec()`) plus a warning. `_due()` falls back to wall clock and never returns "due now".
  - This fixes the tenant-wide breach-sweep crash and the `/tickets/{id}/sla/` 500.
  - `services/calendars.ensure_default_hours` (Mon–Fri 09–17) runs on create + seed.
  - UI: "No working hours" badge/suffix; amber warning in the SLA editor.
- **One progress function (M5).** `sla_engine.timer_snapshot(tracker, now=None, calendar_cache=None)` → `{elapsed_minutes, percent_used, breached, rag}`.
  - Used by `countdown_payload`, the queue list `sla` entry (calendar cache shared through serializer context), `scan_breaches` and reporting's `_open_sla_index`.
  - Paused elapsed time freezes at `paused_at`. `SlaBar` renders `percent_used`; past due turns red locally.
- **C2:** `_create_or_revive` for holidays and targets (re-adding a deleted row revives it, no 500).
- **C3:** `_close_open_pause` before stop (hold time no longer causes a false breach).
- **C7 (bulk):** values are validated, and the write goes through `update_ticket`.
- **U1:** confirms on holiday delete, window delete / day off (warns about 24×7), and an SLA save that clears a target.
- **Prod data effect:**
  - Old fallback clocks keep their targets until the next priority change.
  - Trackers already breached on hours-less calendars stay breached.
  - Recurring holidays apply from deploy.
- **Open:**
  - The `applies_to.priority` policy switch isn't followed.
  - A withdrawn period counts as elapsed.
  - Lowering priority can clear a breach (by design).
  - There's no dedicated `sla_recalculated` audit action.
- Supersedes:
  - the 2026-10-18 hover-help bullets "a blank target does NOT switch the SLA off", "a new calendar has no hours" and "Repeats annually is NOT honoured"
  - the 2026-06-21 "the bar's RAG is a cheap wall-clock fraction"
- Batch context: `docs/BUG_LOG.md` "2026-10-18 — Bug-fix batch"; QA: `docs/QA_CHECKLIST.md` "Bug-fix batch (added 2026-10-18)".

## Update (2026-10-18) — SLA hover help (`lib/itsm/help/sla.ts`)
- **Helpers:** `SLA_METRIC_HELP` (what stops each clock), `SLA_STATE_HELP` (running/paused/met/breached/stopped), `SLA_RAG_HELP` (green < 75%, amber ≥ 75%, red past due), and `slaTooltip(entry, kind, {withBands})`.
- **Where they're used:** the queue SLA bars, the detail SLA panel and the Ticket Data report legend.
- **The SLA editor says:**
  - The policy calendar is used only when the project has none. With no calendar at all, clocks run 24/7 in UTC.
  - A blank target does NOT switch the SLA off; it falls back to an arbitrary other priority's target, or 480 min.
  - Changes apply to new tickets only.
- **Calendar and holiday editors:**
  - A new calendar has no hours, so SLAs on it fall due immediately.
  - "Repeats annually" is NOT honoured by `business_time.py:98`; add next year's date too.
- Primitives: `ui/hint.tsx` (`Hint`), `ui/icon-button.tsx` (`IconButton`), `ui/info-tip.tsx` (`InfoTip`); copy in `lib/itsm/help/*`. Rules + verification: `docs/QA_CHECKLIST.md` "Hover help / tooltips (2026-10-18)". Behaviour mismatches found (not fixed) are listed in `docs/BUG_LOG.md` 2026-10-18 — tooltips describe the REAL behaviour.

## Update (2026-07-24) — "No SLA by default" pattern (Problem projects)
- An imported **Problem** project gets a project-scoped `SLAPolicy` named `"<KEY> — No SLA (default)"`
  with **zero metrics** and **`is_default=False`** (`itsm_projects.standard_projects._ensure_no_sla_policy`).
  Because `resolve_policy` matches a project-scoped policy **before** falling through to the
  tenant-global default, `start_trackers` finds no metrics and **no clocks start** on problem tickets
  (ITIL/JSM practice: problems are long-running RCA work with no response/resolution SLA). Admins opt
  in later by adding metrics/targets to that policy in the project's **SLA** settings tab — nothing
  else special-cases `project_type`.
- ⚠️ **Never flag a project-scoped policy `is_default=True`.** `resolve_policy`'s tenant-wide fallback
  matched ANY `is_default` policy and `.first()` orders by pk — a random UUID — so a second default
  (e.g. the Problem policy, or a hand-made project policy) would coin-flip SLA resolution off for
  EVERY project without its own policy. The fallback is now hardened to
  `filter(project__isnull=True, is_default=True, is_active=True)` (`services/sla_engine.py`
  `resolve_policy`), so only the true tenant default can ever be the fallback. Covered by
  `StandardProjectImportTests.test_problem_ticket_starts_no_sla_clocks` (with an incident control).

## Update (2026-07-03) — SLA clocks are KEPT on a project move (not restarted)
When a ticket is moved to another project (`ticket_service.move_ticket`, see **itsm-tickets**), its
existing `SLATracker` rows are **left untouched** and **no** new trackers are started — a deliberate
product decision ("keep existing clocks"). The move does **not** call `sla_start_for_ticket`. This
also avoids the duplicate-clock hazard: the `(ticket, metric)` uniqueness is per **metric row**, so
starting the target policy's trackers would add a *second* clock per kind. Consequence to note: a
moved ticket keeps being measured against the **source** project's policy/targets/calendar.

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
