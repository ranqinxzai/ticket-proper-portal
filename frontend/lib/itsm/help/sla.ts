/**
 * SLA hover help — shared by the queue's SLA bars and the ticket detail SLA panel.
 * Grounded in backend/apps/itsm_sla/services/sla_engine.py (pause / resume / stop,
 * `on_status_change`, `on_priority_change`) and `timer_snapshot` (business-time % used +
 * RAG, shared by the queue bar via itsm_tickets/serializers.py `_list_sla_entry` and the
 * detail panel via `countdown_payload`).
 */
import { fullDateTime, humanMinutes } from "./format";

/** What each SLA metric measures, keyed by `SLAMetric.kind`. */
export const SLA_METRIC_HELP: Record<string, string> = {
  first_response:
    "Time to First Response — stops at the first public reply to the requestor (or when the ticket is resolved). Internal notes don't count.",
  resolution: "Time to Resolution — stops when the ticket reaches a Done status (e.g. Resolved / Closed).",
  assignment: "Time to Assignment — stops when a technician is assigned.",
};

/** Meaning of each tracker state. */
export const SLA_STATE_HELP: Record<string, string> = {
  running:
    "The clock is running, in business hours of the project's calendar. Changing the priority switches it to that priority's target (time already used is kept).",
  paused:
    "Paused — the ticket is in a status marked \"Exclude from SLA\" (e.g. On hold), a workflow step paused it, or an approval with \"Pause SLA while waiting\" is pending. It resumes when the status is left or the approval is decided.",
  paused_approval:
    "Paused while awaiting approval — the approval's policy has \"Pause SLA while waiting\". The clock resumes when the approval is approved, rejected or withdrawn.",
  met: "Met — finished before the due time.",
  breached: "Breached — the due time passed before the clock finished.",
  stopped: "Stopped — the clock was closed without a met / breached outcome.",
};

/** Colour bands of the queue bar (business-time share of the target used — sla_engine.timer_snapshot). */
export const SLA_RAG_HELP =
  "Bar = share of the target used so far, in business hours (as of the last refresh). Green < 75%, amber ≥ 75%, red at 100% or once the due time passes. The label counts down to the due time.";

/** Queue cell with no SLA clock for this metric (sla_engine.start_trackers / on_priority_change). */
export const SLA_NONE_HELP =
  "No SLA clock: the project has no SLA for this, or the ticket's priority has no target (a blank target means no SLA for that priority).";

type Entry = {
  state: string;
  pause_reason?: string | null;
  due_at?: string | null;
  target_minutes?: number | null;
  breached?: boolean;
  paused?: boolean;
  remaining_minutes?: number | null;
  percent_used?: number | null;
};

/** Multi-line tooltip for one SLA clock: state meaning, due time, target. */
export function slaTooltip(entry: Entry, metricKind?: string, opts: { withBands?: boolean } = {}): string {
  const lines: string[] = [];
  if (metricKind && SLA_METRIC_HELP[metricKind]) lines.push(SLA_METRIC_HELP[metricKind]);
  const state = entry.paused
    ? entry.pause_reason === "approval" ? "paused_approval" : "paused"
    : entry.state === "running" && entry.breached ? "overdue" : entry.state;
  lines.push(
    state === "overdue"
      ? "Overdue — the due time has passed and the clock is still running."
      : (SLA_STATE_HELP[state] ?? `State: ${entry.state}`),
  );
  const due = fullDateTime(entry.due_at);
  if (due) lines.push(`Due: ${due}`);
  if (entry.target_minutes) lines.push(`Target: ${humanMinutes(entry.target_minutes)} (business time)`);
  if (entry.percent_used != null) lines.push(`Used: ${Math.round(entry.percent_used)}% of the target`);
  if (opts.withBands && (entry.state === "running" || entry.paused)) lines.push(SLA_RAG_HELP);
  return lines.join("\n");
}
