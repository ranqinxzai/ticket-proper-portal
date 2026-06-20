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
