/** Standard-reports catalog — the single source of truth for the workspace
 * Reports section. Each entry maps a backend report key to its display title,
 * context (one-line description), category, table columns, and a transform from
 * the raw report payload to table rows. Drives both the catalog index and the
 * per-report detail table. Keep keys in sync with `services/reports.STANDARD_REPORTS`.
 */

import { addMonths, format, isAfter, isValid, parseISO, startOfMonth } from "date-fns";

import type { ReportRow } from "@/components/reports/report-views";

export type ReportColumn = {
  key: string;
  header: string;
  align?: "left" | "right";
  fmt?: (v: unknown) => string;
};

export type ReportDef = {
  key: string;
  title: string;
  context: string;
  category: string;
  columns: ReportColumn[];
  /** When a report ships its own column manifest (dynamic columns, e.g. the raw
   * Ticket Data export), derive the columns from the payload instead of `columns`. */
  columnsFromData?: (data: unknown) => ReportColumn[];
  /** Raw report payload → table rows. Default: the payload if it's an array. */
  rows?: (data: unknown) => ReportRow[];
};

const asRows = (d: unknown): ReportRow[] => (Array.isArray(d) ? (d as ReportRow[]) : []);
const asObj = (d: unknown): ReportRow =>
  d && typeof d === "object" && !Array.isArray(d) ? (d as ReportRow) : {};

const cap = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
};
const num = (v: unknown): string => (v == null || v === "" ? "—" : String(v));
const pctFmt = (v: unknown): string => (v == null ? "—" : `${v}%`);
const dateTime = (v: unknown): string => {
  if (!v) return "—";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : format(d, "dd MMM yyyy, HH:mm");
};
const boolFmt = (v: unknown): string => (v === true ? "Yes" : v === false ? "No" : "—");

/** Columns for a report that ships its own `{columns:[{key,label,type}]}` manifest
 * (the raw Ticket Data export). Maps the backend `type` hint to a formatter/align. */
function dynamicColumns(data: unknown): ReportColumn[] {
  const cols = (asObj(data).columns as { key: string; label: string; type?: string }[]) ?? [];
  return cols.map((c) => ({
    key: c.key,
    header: c.label,
    align: c.type === "number" ? "right" : undefined,
    fmt: c.type === "datetime" ? dateTime : c.type === "bool" ? boolFmt : undefined,
  }));
}

/** Append a "% of total" value (`pct`) to each row, relative to `valueKey`. */
function withPct(arr: ReportRow[], valueKey = "value"): ReportRow[] {
  const total = arr.reduce((s, r) => s + Number(r[valueKey] ?? 0), 0) || 1;
  return arr.map((r) => ({ ...r, pct: `${Math.round((Number(r[valueKey] ?? 0) / total) * 100)}%` }));
}

export const REPORT_CATEGORIES = [
  "Ticket distribution",
  "Throughput",
  "Performance",
  "SLA",
  "Backlog",
] as const;

export const REPORT_DEFS: ReportDef[] = [
  {
    key: "ticket-data",
    title: "Ticket Data",
    context: "Raw export — every ticket field incl. system, SLA and custom fields.",
    category: "Ticket distribution",
    columns: [], // dynamic — resolved from the payload's column manifest
    columnsFromData: dynamicColumns,
    rows: (d) => asRows(asObj(d).rows),
  },
  {
    key: "by-status",
    title: "Tickets by Status",
    context: "How many tickets sit in each workflow status.",
    category: "Ticket distribution",
    columns: [
      { key: "label", header: "Status" },
      { key: "category", header: "Category", fmt: (v) => cap(String(v).replace(/_/g, " ")) },
      { key: "value", header: "Count", align: "right" },
      { key: "pct", header: "% of total", align: "right" },
    ],
    rows: (d) => withPct(asRows(d)),
  },
  {
    key: "by-priority",
    title: "Tickets by Priority",
    context: "Distribution of tickets across Critical / High / Medium / Low.",
    category: "Ticket distribution",
    columns: [
      { key: "label", header: "Priority", fmt: cap },
      { key: "value", header: "Count", align: "right" },
      { key: "pct", header: "% of total", align: "right" },
    ],
    rows: (d) => withPct(asRows(d)),
  },
  {
    key: "by-group",
    title: "Tickets by Team",
    context: "Workload split across assigned teams (including Unassigned).",
    category: "Ticket distribution",
    columns: [
      { key: "label", header: "Team" },
      { key: "value", header: "Count", align: "right" },
      { key: "pct", header: "% of total", align: "right" },
    ],
    rows: (d) => withPct(asRows(d)),
  },
  {
    key: "open-tickets",
    title: "Open Tickets by Project",
    context: "Currently open (not-done) tickets per project.",
    category: "Ticket distribution",
    columns: [
      { key: "project", header: "Project" },
      { key: "open", header: "Open", align: "right" },
    ],
    rows: (d) =>
      asRows(asObj(d).by_project).map((r) => ({
        project: r.project__key ?? "—",
        open: r.n ?? 0,
      })),
  },
  {
    key: "created-vs-resolved",
    title: "Created vs Resolved",
    context: "Tickets created vs resolved each day over the period, with net change.",
    category: "Throughput",
    columns: [
      { key: "date", header: "Date" },
      { key: "created", header: "Created", align: "right" },
      { key: "resolved", header: "Resolved", align: "right" },
      { key: "net", header: "Net", align: "right" },
    ],
    rows: (d) => asRows(d),
  },
  {
    key: "agent-performance",
    title: "Agent Performance",
    context: "Open, resolved and average resolution time per agent.",
    category: "Performance",
    columns: [
      { key: "agent", header: "Agent" },
      { key: "open_count", header: "Open", align: "right" },
      { key: "resolved_count", header: "Resolved", align: "right" },
      { key: "avg_resolution_hours", header: "Avg resolution (h)", align: "right", fmt: num },
    ],
    rows: (d) => asRows(d),
  },
  {
    key: "resolution-time-by-priority",
    title: "Resolution Time by Priority",
    context: "Average / min / max time-to-resolve, grouped by priority.",
    category: "Performance",
    columns: [
      { key: "priority", header: "Priority", fmt: cap },
      { key: "resolved_count", header: "Resolved", align: "right" },
      { key: "avg_hours", header: "Avg (h)", align: "right", fmt: num },
      { key: "min_hours", header: "Min (h)", align: "right", fmt: num },
      { key: "max_hours", header: "Max (h)", align: "right", fmt: num },
    ],
    rows: (d) => asRows(d),
  },
  {
    key: "sla-compliance",
    title: "SLA Compliance Summary",
    context: "SLA targets met vs breached, and overall compliance %.",
    category: "SLA",
    columns: [
      { key: "total", header: "Total", align: "right" },
      { key: "met", header: "Met", align: "right" },
      { key: "breached", header: "Breached", align: "right" },
      { key: "compliance_pct", header: "Compliance %", align: "right", fmt: pctFmt },
    ],
    rows: (d) => [asObj(d)],
  },
  {
    key: "sla-breach-list",
    title: "SLA Breach List",
    context: "Every ticket that breached its SLA, and by how long.",
    category: "SLA",
    columns: [
      { key: "ticket_number", header: "Ticket" },
      { key: "summary", header: "Summary" },
      { key: "metric", header: "SLA metric" },
      { key: "priority", header: "Priority", fmt: cap },
      { key: "team", header: "Team" },
      { key: "due_at", header: "Due", fmt: dateTime },
      { key: "breached_at", header: "Breached at", fmt: dateTime },
      { key: "minutes_overdue", header: "Mins overdue", align: "right", fmt: num },
    ],
    rows: (d) => asRows(d),
  },
  {
    key: "backlog-aging",
    title: "Backlog Aging",
    context: "Open tickets bucketed by how long ago they were created.",
    category: "Backlog",
    columns: [
      { key: "label", header: "Age bucket" },
      { key: "value", header: "Open", align: "right" },
    ],
    rows: (d) => asRows(d),
  },
];

export const REPORT_BY_KEY: Record<string, ReportDef> = Object.fromEntries(
  REPORT_DEFS.map((d) => [d.key, d]),
);

export const ALL_PROJECTS = "all";

/** Reports are run over an explicit From–To date range capped at this many months.
 * For a longer period (e.g. a full year) download it in parts. */
export const MAX_RANGE_MONTHS = 6;

export type DateRange = { from: string; to: string };

const ymd = (d: Date): string => format(d, "yyyy-MM-dd");

/** Default range: the current month so far (1st of this month → today). */
export function currentMonthRange(): DateRange {
  const now = new Date();
  return { from: ymd(startOfMonth(now)), to: ymd(now) };
}

/** The latest `to` allowed for a given `from` (the 6-month cap), as YYYY-MM-DD.
 * Empty string when `from` is unset/invalid (so the input sets no max). */
export function maxToDate(from: string): string {
  const f = parseISO(from);
  return from && isValid(f) ? ymd(addMonths(f, MAX_RANGE_MONTHS)) : "";
}

/** Validate a From–To range. Returns a human error string, or null when valid. */
export function rangeError(from: string, to: string): string | null {
  if (!from || !to) return "Pick a start and end date.";
  const f = parseISO(from);
  const t = parseISO(to);
  if (!isValid(f) || !isValid(t)) return "Enter valid dates.";
  if (isAfter(f, t)) return "Start date must be on or before the end date.";
  if (isAfter(t, addMonths(f, MAX_RANGE_MONTHS)))
    return `Range can't exceed ${MAX_RANGE_MONTHS} months — download a longer period in parts.`;
  return null;
}

/** Build the scope query passed to `reportsApi.get` / export, from project +
 * explicit From–To range (both YYYY-MM-DD). `to` is inclusive of that whole day
 * server-side (the backend uses date lookups). */
export function buildRangeScope(
  helpdeskId: string | undefined,
  projectId: string,
  from: string,
  to: string,
): Record<string, unknown> {
  return {
    helpdesk: helpdeskId,
    project: projectId && projectId !== ALL_PROJECTS ? projectId : undefined,
    date_from: from || undefined,
    date_to: to || undefined,
  };
}

/** Resolve table rows for a report def from its raw payload. */
export function reportRows(def: ReportDef, data: unknown): ReportRow[] {
  return def.rows ? def.rows(data) : Array.isArray(data) ? (data as ReportRow[]) : [];
}
