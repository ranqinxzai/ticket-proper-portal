/** Standard-reports catalog — the single source of truth for the workspace
 * Reports section. Each entry maps a backend report key to its display title,
 * context (one-line description), category, table columns, and a transform from
 * the raw report payload to table rows. Drives both the catalog index and the
 * per-report detail table. Keep keys in sync with `services/reports.STANDARD_REPORTS`.
 */

import { addMonths, format, isAfter, isValid, parseISO, startOfMonth } from "date-fns";

import type { ReportRow } from "@/components/reports/report-views";
import { priorityLabel } from "@/lib/itsm/priority";

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
  /** Child RBAC module the API additionally checks for this report (403 without it). */
  module?: string;
};

/** Parent module of every report; the child modules inherit from it. */
export const REPORTS_MODULE = "itsm.reports";
export const SLA_REPORTS_MODULE = "itsm.reports.sla";
export const AGENT_REPORTS_MODULE = "itsm.reports.agent";

type PermMap = Record<string, { read?: boolean }> | undefined;

/** Read access to a module the way the API checks it (closest ancestor wins): the
 * role's own grant on `code` when it has a row for it, else the parent's grant.
 * (Superusers: `hasPerm` is always true.) */
export function canReadModule(
  perms: PermMap,
  hasPerm: (code: string, action: "read") => boolean,
  code: string,
  parent: string = REPORTS_MODULE,
): boolean {
  if (hasPerm(code, "read")) return true;
  return !(perms && code in perms) && hasPerm(parent, "read");
}

/** Whether the user may run a catalog report (its child module, if any). */
export function canReadReport(
  def: ReportDef,
  perms: PermMap,
  hasPerm: (code: string, action: "read") => boolean,
): boolean {
  return !def.module || canReadModule(perms, hasPerm, def.module);
}

const asRows = (d: unknown): ReportRow[] => (Array.isArray(d) ? (d as ReportRow[]) : []);
const asObj = (d: unknown): ReportRow =>
  d && typeof d === "object" && !Array.isArray(d) ? (d as ReportRow) : {};

const cap = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
};
const num = (v: unknown): string => (v == null || v === "" ? "—" : String(v));
const pctFmt = (v: unknown): string => (v == null ? "—" : `${v}%`);
const priorityFmt = (v: unknown): string => (v == null || v === "" ? "—" : priorityLabel(String(v)));
const dateTime = (v: unknown): string => {
  if (!v) return "—";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : format(d, "dd MMM yyyy, HH:mm");
};
const boolFmt = (v: unknown): string => (v === true ? "Yes" : v === false ? "No" : "—");
/** Business minutes → "2h 15m" / "45m" (hours, never days — a business day isn't 24h). */
const bizMinutes = (v: unknown): string => {
  if (v == null || v === "") return "—";
  const m = Math.round(Number(v));
  if (!Number.isFinite(m)) return String(v);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};

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
  "Satisfaction",
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
    context: "Distribution of tickets across P1 / P2 / P3 / P4.",
    category: "Ticket distribution",
    columns: [
      { key: "label", header: "Priority", fmt: priorityFmt },
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
    context: "Open (not-done) tickets per project, among those created in the range.",
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
    context: "Per agent: tickets resolved in the range, open now, and average resolution time (business hours).",
    category: "Performance",
    columns: [
      { key: "agent", header: "Agent" },
      { key: "open_count", header: "Open (now)", align: "right" },
      { key: "resolved_count", header: "Resolved", align: "right" },
      { key: "avg_resolution_hours", header: "Avg resolution (business h)", align: "right", fmt: num },
    ],
    module: AGENT_REPORTS_MODULE,
    rows: (d) => asRows(d),
  },
  {
    key: "resolution-time-by-priority",
    title: "Resolution Time by Priority",
    context: "Average / fastest / slowest business hours to resolve, per priority, for tickets resolved in the range.",
    category: "Performance",
    columns: [
      { key: "priority", header: "Priority", fmt: priorityFmt },
      { key: "resolved_count", header: "Resolved", align: "right" },
      { key: "avg_hours", header: "Avg (business h)", align: "right", fmt: num },
      { key: "min_hours", header: "Min (business h)", align: "right", fmt: num },
      { key: "max_hours", header: "Max (business h)", align: "right", fmt: num },
    ],
    rows: (d) => asRows(d),
  },
  {
    key: "sla-compliance",
    title: "SLA Compliance Summary",
    context: "Tickets that met vs breached their SLAs — overall (per ticket) and per SLA.",
    category: "SLA",
    columns: [
      { key: "label", header: "SLA" },
      { key: "total", header: "Measured", align: "right" },
      { key: "met", header: "Met", align: "right" },
      { key: "breached", header: "Breached", align: "right" },
      { key: "compliance_pct", header: "Compliance %", align: "right", fmt: pctFmt },
    ],
    rows: (d) => {
      const o = asObj(d);
      return [{ ...o, label: "Overall (per ticket)" }, ...asRows(o.by_metric)];
    },
    module: SLA_REPORTS_MODULE,
  },
  {
    key: "sla-breach-list",
    title: "SLA Breach List",
    context: "Every SLA breach, and how late it was (business time).",
    category: "SLA",
    columns: [
      { key: "ticket_number", header: "Ticket" },
      { key: "summary", header: "Summary" },
      { key: "metric", header: "SLA metric" },
      { key: "priority", header: "Priority", fmt: priorityFmt },
      { key: "team", header: "Team" },
      { key: "due_at", header: "Due", fmt: dateTime },
      { key: "breached_at", header: "Breached at", fmt: dateTime },
      { key: "finished_at", header: "Finished", fmt: dateTime },
      { key: "minutes_overdue", header: "Overdue by", align: "right", fmt: bizMinutes },
    ],
    module: SLA_REPORTS_MODULE,
    rows: (d) => asRows(d),
  },
  {
    key: "backlog-aging",
    title: "Backlog Aging",
    context: "Open tickets created in the range, bucketed by how long ago they were created.",
    category: "Backlog",
    columns: [
      { key: "label", header: "Age bucket" },
      { key: "value", header: "Open", align: "right" },
    ],
    rows: (d) => asRows(d),
  },
  {
    key: "csat-summary",
    title: "CSAT Summary",
    context: "Customer satisfaction: score, response rate and rating distribution.",
    category: "Satisfaction",
    columns: [
      { key: "responses", header: "Responses", align: "right" },
      { key: "sent", header: "Sent", align: "right" },
      { key: "csat_pct", header: "CSAT %", align: "right", fmt: pctFmt },
      { key: "avg_score", header: "Avg score", align: "right", fmt: num },
      { key: "response_rate", header: "Response rate", align: "right", fmt: pctFmt },
    ],
    rows: (d) => [asObj(d)],
  },
  {
    key: "csat-responses",
    title: "CSAT Responses",
    context: "Every submitted survey — rating and comment, newest first.",
    category: "Satisfaction",
    columns: [
      { key: "ticket", header: "Ticket" },
      { key: "project", header: "Project" },
      { key: "requestor", header: "Requestor" },
      { key: "rating", header: "Rating", align: "right" },
      { key: "satisfied", header: "Satisfied", fmt: boolFmt },
      { key: "comment", header: "Comment" },
      { key: "submitted_at", header: "Submitted", fmt: dateTime },
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
