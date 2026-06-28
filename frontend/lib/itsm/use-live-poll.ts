"use client";

import { useEffect, useRef } from "react";

export type UseLivePollArgs = {
  /** Fetch a cheap version token for the current scope (the backend `pulse` action). */
  pulse: () => Promise<string>;
  /** Called when the token differs from the last-seen baseline — fetch + apply fresh
   *  data here (silently, no loading spinner). */
  onChange: () => void | Promise<void>;
  /** Re-seed the baseline whenever this changes (e.g. the active filters / page), so a
   *  scope change never fires a spurious `onChange`. */
  key: string;
  /** Poll cadence in ms. Default 15s — matches Jira's board freshness, cheap on the
   *  3-worker sync pool. */
  intervalMs?: number;
  /** Gate the whole poller (e.g. until the initial view has resolved). */
  enabled?: boolean;
};

/**
 * Silent "live refresh" poller (Jira-style). Polls a cheap `pulse()` version token on
 * an interval; when the token changes from the last-seen baseline it calls `onChange()`
 * so the caller can fetch + apply fresh data WITHOUT a loading spinner.
 *
 * - Pauses while the tab is hidden (Page Visibility) to save load/battery, and runs one
 *   immediate catch-up poll when the tab becomes visible again.
 * - Re-seeds its baseline whenever `key` changes (active filters/page), so changing a
 *   filter never fires a spurious onChange.
 * - In-flight guard: a slow poll can't stack on top of the next tick.
 *
 * The manual equivalent of TanStack Query's refetchInterval + refetchOnWindowFocus +
 * pause-when-hidden, without the dependency — and the same shape as the existing
 * setInterval poll in `components/shell/notification-bell.tsx`.
 */
export function useLivePoll({
  pulse,
  onChange,
  key,
  intervalMs = 15_000,
  enabled = true,
}: UseLivePollArgs) {
  // Keep the latest closures in refs so the interval always calls current `pulse`/
  // `onChange` without resetting the timer every render.
  const pulseRef = useRef(pulse);
  const onChangeRef = useRef(onChange);
  pulseRef.current = pulse;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let running = false;
    let baseline: string | null = null; // last-seen version; null until seeded

    const tick = async () => {
      if (cancelled || running) return;
      // Pause when the tab is hidden — no point polling a backgrounded queue.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      running = true;
      try {
        const version = await pulseRef.current();
        if (cancelled) return;
        if (baseline === null) {
          baseline = version; // seed silently — never fire onChange on the first read
        } else if (version !== baseline) {
          baseline = version;
          await onChangeRef.current();
        }
      } catch {
        /* transient poll failure — keep current data, retry next tick */
      } finally {
        running = false;
      }
    };

    void tick(); // immediate seed of the baseline for this scope
    const id = setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick(); // catch up on refocus
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `key` re-seeds the baseline when the scope (filters/page) changes.
  }, [enabled, key, intervalMs]);
}
