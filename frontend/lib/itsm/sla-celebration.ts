import type { SlaEntry } from "./types";

/**
 * "SLA win" celebration logic. When an agent resolves a ticket comfortably
 * within its Resolution SLA, we reward them with a tiered animation. The tier is
 * driven by how much of the SLA budget was STILL LEFT at resolution — the faster
 * they resolved, the bigger the celebration. A breached (or absent) resolution
 * SLA produces nothing.
 */

export type CelebrationTier = "legendary" | "excellent" | "great" | "ontime" | "justintime";

export interface CelebrationResult {
  tier: CelebrationTier;
  /** 0..100 — percentage of the Resolution-SLA budget still remaining. */
  pctLeft: number;
  metricName: string;
  targetMinutes: number;
  elapsedMinutes: number;
  remainingMinutes: number;
}

// Bands by % of SLA budget remaining at resolution (fast → bigger party).
const BANDS: { min: number; tier: CelebrationTier }[] = [
  { min: 90, tier: "legendary" },
  { min: 70, tier: "excellent" },
  { min: 50, tier: "great" },
  { min: 30, tier: "ontime" },
  { min: 0.0001, tier: "justintime" }, // any positive slack, down to "1%"
];

/** Map "% of SLA budget remaining" to a celebration tier. */
export function tierForPct(pctLeft: number): CelebrationTier | null {
  for (const b of BANDS) if (pctLeft >= b.min) return b.tier;
  return null;
}

/** Pick the Resolution SLA entry from a ticket's SLA list. Prefers the canonical
 *  `resolution` metric key, then anything whose name reads like "resolution", and
 *  finally — only if there's a single metric — that one. */
function pickResolution(entries: SlaEntry[]): SlaEntry | null {
  const byKey = entries.find((e) => (e.metric ?? "").toLowerCase() === "resolution");
  if (byKey) return byKey;
  const byName = entries.find((e) => /resol/i.test(e.metric_name ?? ""));
  if (byName) return byName;
  const nonFirstResponse = entries.filter((e) => (e.metric ?? "").toLowerCase() !== "first_response");
  return nonFirstResponse.length === 1 ? nonFirstResponse[0] : null;
}

/**
 * Compute the celebration for a just-resolved ticket, or `null` when there is
 * nothing to celebrate (SLA breached, no resolution SLA, or resolved with no
 * measurable slack). `pctLeft` is derived from elapsed vs target so it reflects
 * the at-completion slack regardless of how the API reports `remaining_minutes`.
 */
export function slaCelebration(entries: SlaEntry[] | null | undefined): CelebrationResult | null {
  if (!entries?.length) return null;
  const e = pickResolution(entries);
  if (!e || e.breached) return null;

  const target = e.target_minutes;
  const elapsed = e.elapsed_minutes;
  if (!target || target <= 0 || elapsed == null || elapsed < 0) return null;

  const pctLeft = Math.max(0, Math.min(100, (1 - elapsed / target) * 100));
  const tier = tierForPct(pctLeft);
  if (!tier) return null; // resolved exactly at (or past) the deadline → no slack, no party

  return {
    tier,
    pctLeft,
    metricName: e.metric_name || "Time to Resolution",
    targetMinutes: target,
    elapsedMinutes: elapsed,
    remainingMinutes: e.remaining_minutes ?? Math.max(0, target - elapsed),
  };
}
