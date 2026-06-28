# itsm-sla — Bug Log / Gotchas

- **Built and live.** The engine is implemented; the `itsm_core` hooks now resolve to
  `sla_engine` and drive `start_trackers`/`on_status_change`/`pause`/`resume`/`stop` for real.
  The caveats below are live operational gotchas for the built engine.
- **Resume must recompute from first principles**, not by adding elapsed pause time to a frozen
  `due_at`. `due_at = add_business_minutes(started_at, budget + total_paused_business_minutes)` — the
  only formula robust to multiple pause cycles AND calendar edits mid-clock.
- **DST and holidays are the classic traps.** Materialize working windows in the calendar's tz via
  `ZoneInfo`, then convert to UTC — never do naive wall-clock arithmetic. Test spring-forward,
  fall-back, a holiday spanning a window, a budget > 1 day, and a start that lands in a non-working
  gap.
- **Zero-working-day calendars must fail loudly.** The lazy day generator needs a 2-year guard
  raising `MisconfiguredCalendar`, or `add_business_minutes` loops forever.
- **Breach sweep must be idempotent.** Two sweep ticks (or a sweep racing a computed-on-read flip)
  must not double-escalate — enforce via `SLAEscalationLog` unique `(clock, threshold)` written in
  the same transaction as the action.
- **Computed-on-read is authoritative for the UI; the sweep just persists `breached`.** Don't let the
  ~1-min sweep latency make the UI show "not breached" past `due_at` — compute on read.
- **The countdown payload is absolute.** Return `due_at` (not "seconds remaining") so the client can
  tick locally and stay correct across clock skew and tab sleep; no per-second server calls.
- **Hooks swallow errors.** Because `itsm_core.hooks` wraps SLA calls in `_safe`, a bug in
  `sla_engine` won't fail the ticket write — check the `itsm` log, not the API response.
- **A *stopped* clock must not render as a live countdown (fixed 2026-06-23).** `stop()` ends a
  metric as `met` (`now <= due_at`) or `breached` (`now > due_at`) — both freeze `stopped_at`, so
  `elapsed_minutes`/`remaining_minutes` are frozen too. The first-response clock is stopped by
  `add_comment` (first public reply) and by `on_status_change` (→ done; see ITINC-606 below); a late
  first response therefore ends **breached** (correct ITSM — a missed SLA stays missed; replying late
  does not un-breach it). The bug was UI-only: the detail **SLA panel** (`sla-panel.tsx`) ignored
  `state` and the queue **SLA bar** (`queue-columns.tsx`) treated only `met`/`stopped` (not
  `breached`) as "done", so a breached-then-stopped metric showed a red **"12h 0m overdue"** that
  looked like it was still ticking and unanswered — even though the agent *had* replied. Both now
  key off `state`: a stopped clock (`met`/`breached`/`stopped`) shows its **outcome** ("Met" /
  "Breached"), and only a *running* clock shows the live "Xh left / Xh overdue". Repro: ITINC-605
  (response 12 business-h late → breached; resolution met). When debugging "SLA still overdue after
  I responded", first check the tracker's `state`/`stopped_at` — `breached`+`stopped` is a finished,
  legitimately-missed clock, not a live one.
- **First response no longer counts an in-progress status as "responded" (changed 2026-06-23).**
  `on_status_change` used to stop the first-response clock when the ticket entered *either*
  `in_progress` *or* `done` — so merely clicking **Start Progress** (e.g. ITINC-606: created → Assign
  → Start Progress within ~55s, no comment ever posted) marked **Time to First Response = Met** with
  `first_responded_at` still `None`. That overstated the metric: picking a ticket up is not a reply to
  the requester. The status branch is now `done`-only (mirrors `resolution`); first response is
  satisfied by the **first public reply** (`add_comment` → `sla_stop`) *or* by **resolving** the
  ticket. Moving to in-progress leaves the clock **running**. File:
  `sla_engine.py::on_status_change` (`first_response` branch now keys off `to_done`). Regression:
  `itsm_sla.tests.FirstResponseStopTests`.
