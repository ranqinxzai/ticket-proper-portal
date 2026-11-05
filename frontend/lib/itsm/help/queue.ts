/**
 * Hover help for the agent ticket queue (list view): column headers, system views,
 * priority chips and the toolbar. Grounded in:
 *  - backend/apps/itsm_tickets/views.py (synthetic ordering annotations)
 *  - backend/apps/itsm_tickets/services/search.py (queue search: matching + ranking)
 *  - backend/apps/itsm_tickets/services/filter_fields.py (`ORDERING_ALIASES`, `SYSTEM_VIEWS`)
 *  - backend/apps/itsm_tickets/services/query_builder.py (`overdue` / `due_today` / `this_week`)
 * Copy must describe what the system actually does (docs/QA_CHECKLIST.md → "Hover help").
 */
import type { Priority } from "@/lib/itsm/types";
import { SLA_METRIC_HELP } from "./sla";

/** What each built-in queue column shows (and how it sorts, where that's not obvious). */
export const QUEUE_COLUMN_HELP: Record<string, string> = {
  ticket_number: "The ticket's number: the project key plus a running number. Click it to open the ticket.",
  project: "The project the ticket belongs to. Sorts by project name.",
  summary: "The ticket's one-line title. Click it to open the ticket.",
  status: "Where the ticket is in its workflow. Sorts in the workflow's status order, not alphabetically.",
  priority: "P1 (most urgent) to P4. Sorts by severity: ascending puts P1 first.",
  requestor: "The person who raised the ticket and receives its email updates. Sorts by name.",
  assignee: "The technician working on the ticket. \"Unassigned\" = no technician yet. Sorts by name.",
  assigned_group: "The team responsible for the ticket. Sorts by team name.",
  // Bar width = itsm_sla timer_snapshot percent_used (business time), not wall-clock.
  sla_response: `${SLA_METRIC_HELP.first_response}\nBar = share of the target used, in business hours.`,
  sla_resolution: `${SLA_METRIC_HELP.resolution}\nBar = share of the target used, in business hours.`,
  created_at: "When the ticket was created. Hover a date for the exact time.",
  created_by:
    "Who created the ticket: the agent, the requestor (portal) or the email system user (email). Sorts by name.",
  updated_at: "When the ticket was last changed. Hover a date for the exact time.",
  updated_by: "Who made the most recent change to the ticket. Sorts by name.",
};

/** Second header line for a column that the server can't sort (SLA bars, some custom fields). */
export const NOT_SORTABLE_HELP = "Not sortable";

/** Header tooltip line describing what the next click on a sortable header does.
 *  Mirrors `cycleSort` in ticket-queue.tsx: none → ascending → descending → default. */
export function sortActionHelp(dir: "asc" | "desc" | null, descIsDefault = false): string {
  if (dir === "asc") return "Sorted ascending · click to sort descending";
  if (dir === "desc" && descIsDefault) return "Sorted newest first (the default) · click to sort ascending";
  if (dir === "desc") return "Sorted descending · click to reset to the default order (newest first)";
  return "Click to sort ascending (click again for descending, a third time to reset)";
}

/** What each built-in (system) view shows, keyed by `SystemView.key`. */
export const VIEW_HELP: Record<string, string> = {
  all: "Every ticket in this queue, newest first. No filters.",
  open: "Tickets in a To do or In progress status (anything not Done).",
  unassigned: "Tickets with no technician assigned, whatever their status (includes resolved ones).",
  my_open: "Open tickets (To do / In progress) assigned to you.",
  resolved: "Tickets in a Done status (e.g. Resolved / Closed).",
  due_today:
    "Tickets whose Due date falls today, whatever their status. Uses the ticket's Due date field, not the SLA.",
  overdue:
    "Open tickets whose Due date has passed. Uses the ticket's Due date field, not the SLA — tickets without a Due date never appear.",
  created_this_week: "Tickets created since Monday 00:00 (this week).",
  recently_updated: "All tickets, sorted by last update (most recent first). It only re-sorts — no filter.",
};

/** One-line meaning of each priority, shown under the full label on the priority chip. */
export const PRIORITY_MEANING: Record<Priority, string> = {
  p1: "Critical — major outage, act immediately",
  p2: "High — significant impact",
  p3: "Medium — moderate impact, a workaround exists",
  p4: "Low — minor issue",
};

export const QUEUE_SEARCH_HELP =
  "Searches ticket number, summary, description and comments (internal notes only if you can read them). Forgiving of typos and word endings. Best matches first (exact ticket number, then relevance) unless you sort by a column. 1–2 characters match only ticket number and summary. Combined with the active filters.";

/** Shown on the default-sort column while a search is relevance-ranked — the
 *  backend ignores the default `-created_at` and orders best matches first
 *  (itsm_tickets/services/search.py `has_explicit_ordering`). */
export const RELEVANCE_SORT_HELP =
  "While you search, results are ordered by best match (exact ticket number, then relevance), not by this column · click to sort oldest first instead";
export const RELEVANCE_SORT_NOTE = "sorted by best match";

export const QUEUE_REFRESH_HELP =
  "New activity arrived while you were working — click to load it and jump to the top";

// TicketViewSet.create checks `itsm.tickets.create` (Create) since 2026-10-18.
export const NO_CREATE_TICKET_PERMISSION =
  "Your role can't raise tickets here — ask an admin for Create Ticket (Create) in Roles & Permissions";

// Saved views (itsm_dashboards.SavedFilterViewSet scoping, 2026-10-18).
export const SAVED_VIEW_HELP = {
  starOff:
    "Make this your default view — opens automatically when you come back to this queue in a new session",
  starOn:
    "Your default view. Click to stop using it as your default — the queue then opens on the default view your admin set",
  onlyMeProject: "Only you see this view, under My filters in this project's queue",
  onlyMeAll: "Only you see this view, under My filters in this helpdesk's All Tickets",
  shareProject: "Everyone who can open this project's queue sees it under Project filters",
  shareAll:
    "Everyone in this helpdesk sees it under Helpdesk filters — in All Tickets and in each of its project queues",
  deleteShared: "Also removes it for everyone it's shared with",
  allViews: "All views: switch views, star one to make it your default, or delete your own saved views",
} as const;

/** Modern queue (step B3, 2026-11-05): view tabs, Find, Filters, the loaded-count footer.
 *  Grounded in ticket-queue.tsx (25 tickets per batch, server-side search, 15 s pulse)
 *  and view-tabs.tsx (counts = `tickets/pulse/` per view, cached 60 s). */
export const MODERN_QUEUE_HELP = {
  tabCount:
    "Tickets in this view right now. Counts refresh when the list changes, and at most once a minute otherwise.",
  find: "Find in this view (/)",
  findDetail: "Searches number, summary, description and comments on the server, within the view's filters.",
  findClose: "Clear the search and close (Esc)",
  filters: "Filters (F)",
  filtersDetail: "Show or hide the filter chips for this view.",
  live: "The list checks for changes every 15 seconds while this tab is open.",
  top: "Back to the first ticket",
  loadState: "Tickets load 25 at a time as you scroll.",
} as const;

/** "26 of 127 tickets" — the Modern footer count. */
export function loadedCountLabel(loaded: number, total: number): string {
  return `${loaded.toLocaleString()} of ${total.toLocaleString()} ${total === 1 ? "ticket" : "tickets"}`;
}

/** Modern queue: the ticket-number hover card (2026-11-05c). The text is
 *  `TicketListSerializer.description_preview` (itsm_core/services/html.html_to_preview):
 *  the description as plain text, line breaks kept, cut at 300 characters. */
export const QUEUE_PREVIEW_HELP = {
  empty: "No description.",
} as const;
