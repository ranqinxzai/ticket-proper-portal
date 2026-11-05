/**
 * Standard-reports hover help (workspace Reports catalog + detail table + the global
 * Reports page). Grounded in backend/apps/itsm_reporting/services/reports.py and
 * views.py (date filters, row caps, the combined export) — keep in sync.
 */
import { SLA_STATE_HELP } from "./sla";

/** Catalog "Date range" column header — which date each report filters on. */
export const REPORT_DATE_RANGE_HELP =
  "Most reports count tickets created in the range. Created vs Resolved uses each event's own date; Resolution Time by Priority and Agent Performance the resolved date (Agent Performance's Open column is live); SLA Breach List the breach time; and CSAT the survey sent / submitted date. Days are UTC; the range can be up to 6 months.";

/** Per-report note on what the date range filters (detail page, beside the title). */
export const REPORT_RANGE_BASIS: Record<string, string> = {
  "ticket-data": "Tickets created in the range (UTC days). At most 5,000 rows.",
  "by-status": "Tickets created in the range, by their current status (UTC days).",
  "by-priority": "Tickets created in the range, by priority (UTC days).",
  "by-group": "Tickets created in the range, by assigned team (UTC days).",
  "open-tickets":
    "Tickets created in the range that are still open now (UTC days) — older open tickets aren't counted.",
  "created-vs-resolved":
    "Per UTC day: tickets created that day and tickets resolved that day, whenever they were created.",
  "agent-performance":
    "Resolved and Avg resolution: tickets resolved in the range (UTC days). Open: each agent's open tickets right now, whenever created. Agents with open work but nothing resolved are listed too.",
  "resolution-time-by-priority":
    "Tickets resolved in the range (UTC days), whenever created — assigned or not. Times are business hours on each ticket's SLA calendar.",
  "sla-compliance":
    "SLA clocks on tickets created in the range (UTC days). Only clocks that finished, or are already past due, count; assignment SLAs and cancelled clocks are left out.",
  "sla-breach-list": "Breaches recorded in the range (by breach time, UTC days).",
  "backlog-aging":
    "Tickets created in the range that are still open now, by age (UTC days) — older open tickets aren't counted.",
  "csat-summary": "Sent = surveys sent in the range; everything else = surveys submitted in the range (UTC days).",
  "csat-responses": "Surveys submitted in the range (UTC days).",
};

/** One-line explanation of each catalog category chip. */
export const REPORT_CATEGORY_HELP: Record<string, string> = {
  "Ticket distribution": "How tickets split across statuses, priorities, teams and projects",
  Throughput: "How many tickets come in and go out over time",
  Performance: "How fast tickets get resolved, per agent and per priority",
  SLA: "Whether SLA targets were met",
  Backlog: "How old the open tickets are",
  Satisfaction: "Customer satisfaction survey results",
};

/** Rows silently capped by the backend (reports.py) — shown as a note near the table. */
export const REPORT_ROW_CAP: Record<string, number> = {
  "sla-breach-list": 1000,
  "csat-responses": 2000,
};

const SLA_STATE_LEGEND = ["running", "paused", "met", "breached", "stopped"]
  .map((s) => SLA_STATE_HELP[s])
  .join("\n");

const BUSINESS_HOURS =
  "Business hours from creation to resolution, for tickets resolved in the range — measured on each ticket's SLA calendar (the project's calendar, else its SLA policy's, else the default). Nights, weekends and holidays don't count; time on hold does. No calendar at all = round-the-clock hours.";

/** Column-header help, keyed by catalog report key → column key. */
export const REPORT_COLUMN_HELP: Record<string, Record<string, string>> = {
  "by-status": {
    category:
      "The status's category. To do and In progress count as open; Done means resolved or closed.",
  },
  "open-tickets": {
    open: "Tickets not in a Done status, among those created in the range.",
  },
  "created-vs-resolved": {
    created: "Tickets created that day (UTC).",
    resolved: "Tickets resolved that day (UTC), whenever they were created.",
    net: "Created minus resolved that day. Positive = the backlog grew.",
  },
  "agent-performance": {
    agent:
      "Agents with a ticket resolved in the range or an open ticket right now — full name, or username when none is set. Tickets with no assignee are left out.",
    open_count: "Open tickets assigned to this agent right now, whenever created — not limited by the range.",
    resolved_count: "Tickets assigned to this agent and resolved in the range, whenever created.",
    avg_resolution_hours: `Average for this agent's resolved tickets. ${BUSINESS_HOURS}`,
  },
  "resolution-time-by-priority": {
    resolved_count: "Tickets resolved in the range, whenever created — assigned or not.",
    avg_hours: `Average. ${BUSINESS_HOURS}`,
    min_hours: `Fastest. ${BUSINESS_HOURS}`,
    max_hours: `Slowest. ${BUSINESS_HOURS}`,
  },
  "sla-compliance": {
    label:
      "Overall counts each ticket once across its first-response and resolution SLAs: met only if every one was met, breached if any breached. The other rows are per SLA. Assignment SLAs aren't included.",
    total:
      "Tickets whose outcome is known (Met + Breached). Clocks still running on time aren't counted yet; cancelled clocks never are.",
    met: "Tickets whose SLA finished before its due time.",
    breached: "Tickets whose SLA finished late, or is still running past its due time.",
    compliance_pct: "Met ÷ (Met + Breached).",
  },
  "sla-breach-list": {
    metric: "Which SLA timer breached (e.g. First response, Resolution). A ticket shows once per breached timer.",
    due_at: "When the SLA target was due.",
    breached_at:
      "When the breach was recorded (by the SLA check that runs every minute, so usually just after the due time). The date range filters on this.",
    finished_at: "When the SLA clock stopped. \"—\" = still running (or paused), so Overdue by keeps growing.",
    minutes_overdue:
      "How late the SLA was, in business time on the ticket's SLA calendar: from the due time to when the clock stopped — or to now while it's still running. Paused time doesn't count. The export gives it in business minutes.",
  },
  "backlog-aging": {
    label: "How long ago the ticket was created (0–1 day, 1–3 days, …). Live.",
    value: "Tickets not in a Done status.",
  },
  "csat-summary": {
    responses: "Surveys submitted in the range.",
    sent: "Surveys sent in the range.",
    csat_pct: "Share of submitted surveys rated satisfied: 4–5 on 1–5, thumbs up, or 7+ on 0–10.",
    avg_score: "Average rating rescaled to 0–100, so different survey scales can be combined.",
    response_rate:
      "Responses ÷ Sent. Each counts by its own date, so surveys sent before the range but answered in it can push this up.",
  },
  "csat-responses": {
    rating: "The answer on the survey's own scale (1–5, thumbs 1–2, or 0–10).",
    satisfied: "Yes when the rating counts as satisfied: 4–5 on 1–5, thumbs up, or 7+ on 0–10.",
  },
  "ticket-data": {
    status_category: "To do and In progress count as open; Done means resolved or closed.",
    due_date: "The ticket's own Due date field — not an SLA due time.",
    reopen_count: "How many times the ticket was reopened after being resolved.",
  },
};

/** Help for one report column; handles the Ticket Data dynamic `sla_<kind>_*` columns. */
export function reportColumnHelp(reportKey: string, colKey: string): string | undefined {
  const fixed = REPORT_COLUMN_HELP[reportKey]?.[colKey];
  if (fixed) return fixed;
  if (reportKey !== "ticket-data") return undefined;
  if (/^sla_.+_state$/.test(colKey)) return SLA_STATE_LEGEND;
  if (/^sla_.+_target_minutes$/.test(colKey)) return "The SLA target, in business minutes of the project's calendar.";
  if (/^sla_.+_breached_at$/.test(colKey)) return "When the breach was recorded (usually just after the due time).";
  if (/^sla_.+_due$/.test(colKey)) return "When this SLA timer is (or was) due.";
  return undefined;
}

/** Global Reports page — SLA compliance card (no date filter there). */
export const GLOBAL_SLA_COMPLIANCE_HELP =
  "Share of tickets that met their SLAs, all-time, across every workspace you can access — the same rule as the dashboard. A ticket is met when every first-response and resolution SLA it had finished on time, breached as soon as any finished late or is running past due. Clocks still running on time, assignment SLAs and cancelled clocks aren't counted.\nGreen ≥ 90%, amber ≥ 75%, red below.";

/** Global Reports page — distribution cards (no date filter there). */
export const GLOBAL_DISTRIBUTION_HELP =
  "All tickets, all-time, across every workspace you can access.";
