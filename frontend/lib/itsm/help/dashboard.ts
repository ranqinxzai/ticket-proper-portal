/**
 * Command-center dashboard hover help. Every definition is grounded in
 * backend/apps/itsm_reporting/services/reports.py (the report each tile reads),
 * services/business_hours.py (business-hours measurement) and, for CSAT,
 * itsm_surveys/models.py `SCALES` (the "satisfied" top-box rule).
 *
 * History tiles get `date_from` = the period's first UTC day; "Now" tiles get no date
 * filter (see dashboard/page.tsx `load`). Updated 2026-10-18 (M1–M4, M6, B18).
 */

export const DASHBOARD_HELP = {
  period:
    "Drives every history tile: Created, Resolved, Avg resolution, Created vs resolved, SLA compliance, CSAT, the status / priority / team / source charts (tickets created in the period) and the Agent leaderboard. Tiles marked NOW (Open, Needs attention, Backlog aging, Projects) are live and ignore it.\nDays are UTC calendar days, the same daily buckets the reports use: \"Last 7 days\" = today (UTC) and the 6 days before.",
  lastUpdated:
    "When these numbers were last computed (your local time). The dashboard re-computes by itself when a ticket in this scope changes — checked every 15 seconds while this tab is open — and at least every 5 minutes, so the time-based Now tiles stay current.",
  open:
    "Tickets not in a Done status (e.g. Resolved / Closed) right now — live, not affected by the period. The line below is the net change in the period: created minus resolved.",
  created:
    "Tickets created in the period (UTC days). The % compares with the same number of days just before it.",
  resolved:
    "Tickets resolved in the period, whenever they were created (UTC days). The % compares with the same number of days just before it.",
  avgResolution:
    "Average time from creation to resolution, in business hours, for every ticket resolved in the period — assigned or not, so the count matches Resolved. Measured on each ticket's SLA calendar (the project's calendar, else its SLA policy's, else the default calendar): nights, weekends and holidays don't count; time on hold does. With no calendar at all, round-the-clock hours.",
  csat:
    "Share of surveys submitted in the period that were rated satisfied: 4–5 on a 1–5 scale, thumbs up, or 7+ on 0–10.",
  trend:
    "Tickets created and tickets resolved per UTC day over the period (days with none show as 0). Hover the chart to see one day's numbers.",
  slaCompliance:
    "Share of tickets created in the period that met their SLAs, out of those whose outcome is known. A ticket counts as met when every first-response and resolution SLA it had finished on time, and as breached as soon as any of them breached (finished late, or still running past its due time). Clocks still running on time aren't counted yet; assignment SLAs and cancelled clocks never are. The line below gives the same figure per SLA.\nGreen ≥ 90%, amber ≥ 75%, red below.",
  needsAttention: "Live counts over all open tickets right now (not affected by the period). Click a tile to see its tickets.",
  unassigned:
    "Open tickets with no individual assignee. They may still be assigned to a team.",
  overdue:
    "Open tickets whose own Due date has passed. This is the ticket's Due date field, not the SLA.",
  slaAtRisk:
    "Open tickets whose first-response or resolution SLA has used 75% or more of its time window and hasn't breached yet. Uses each ticket's worst timer, the same way the queue's SLA bars do; the assignment SLA is ignored.",
  slaBreached:
    "Open tickets with a breached first-response or resolution SLA — including timers still running past their due time.",
  slaPartial: "Count may be incomplete (very large backlog).",
  byStatus: "Tickets created in the period, by their current status. Click a slice to see them.",
  byPriority: "Tickets created in the period, by priority. Click a bar to see them.",
  byTeam:
    "Tickets created in the period, by assigned team. \"Unassigned\" = no team. Click a bar to see them.",
  bySource:
    "Tickets created in the period, by how they came in (agent, portal, email, …). Click a slice to see them.",
  backlog: "Open tickets right now, grouped by how long ago they were created. Live — not affected by the period.",
  resolutionByPriority:
    "For every ticket resolved in the period (assigned or not): average and longest time from creation to resolution, per priority, in business hours on each ticket's SLA calendar.",
  leaderboard:
    "Agents with tickets resolved in the period or open tickets right now — most resolved first, top 8. Resolved = tickets assigned to them and resolved in the period. Open = their open tickets right now, whenever created. Shows the full name (or username when none is set).",
  leaderboardAvg:
    "Average business hours from creation to resolution for this agent's tickets resolved in the period, on each ticket's SLA calendar.",
  projects: "Every project in this workspace with its open-ticket count right now.",
  /** Shown on a 0-value attention tile (not clickable). */
  nothingToShow: "Nothing to show — no open tickets match right now",
} as const;
