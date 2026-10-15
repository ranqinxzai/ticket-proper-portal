"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";
import type { FilterFieldMeta, QueueSlaEntry, RagState, TicketListItem, UserRef } from "@/lib/itsm/types";
import { PriorityTag } from "./priority-tag";
import { StatusBadge } from "./status-badge";

/** Which filter-registry entries may be offered as `cf:<key>` QUEUE COLUMNS.
 *  A custom field qualifies only when it is value-backed: column-backed system
 *  fields (`config.maps_to` — Priority / Requestor / Assignee / Assigned Group /
 *  Description / the ITIL set) keep their value on the Ticket column and have NO
 *  `FieldValue` row, so a `cf:` column for them renders permanently blank *and*
 *  duplicates the equivalent built-in column. They stay in the filter registry
 *  (this only gates the column pickers). */
export const isColumnEligibleCf = (f: FilterFieldMeta) => f.key.startsWith("cf:") && !f.maps_to;

/** The full catalogue of queue columns. `sortKey` (when present) is the
 *  `ordering=` param the server understands; columns without one aren't
 *  sortable. `defaultVisible` defines the built-in default layout — the current
 *  columns plus Requestor, Group and the two SLA bars (per the spec). */
export type QueueColumnKey =
  | "ticket_number"
  | "project"
  | "summary"
  | "status"
  | "priority"
  | "requestor"
  | "assignee"
  | "assigned_group"
  | "sla_response"
  | "sla_resolution"
  | "created_at"
  | "created_by"
  | "updated_at"
  | "updated_by";

export type QueueColumnDef = {
  key: QueueColumnKey;
  label: string;
  width?: string;
  sortKey?: string;
  defaultVisible: boolean;
};

// Widths go on both the header and body cells. Fixed columns narrow slightly in the
// agent app's compact density (`compact:w-…`); Summary is the one flexible column and
// keeps a 220px floor so it never collapses to its longest word when the fixed
// columns overflow — the pane then scrolls sideways instead (2026-10-14).
export const QUEUE_COLUMNS: QueueColumnDef[] = [
  { key: "ticket_number", label: "ID", width: "w-[120px] compact:w-[104px]", sortKey: "ticket_number", defaultVisible: true },
  // Project: which project a row belongs to — only shown in the combined ("All
  // tickets") queue; off by default in a single-project queue (it'd be redundant).
  { key: "project", label: "Project", width: "w-[150px] compact:w-[136px]", sortKey: "project", defaultVisible: false },
  { key: "summary", label: "Summary", width: "min-w-[220px]", sortKey: "summary", defaultVisible: true },
  { key: "status", label: "Status", width: "w-[140px] compact:w-[124px]", sortKey: "status", defaultVisible: true },
  { key: "priority", label: "Priority", width: "w-[90px] compact:w-[76px]", sortKey: "priority", defaultVisible: true },
  { key: "requestor", label: "Requestor", width: "w-[150px] compact:w-[136px]", sortKey: "requestor", defaultVisible: true },
  { key: "assignee", label: "Assignee", width: "w-[160px] compact:w-[136px]", sortKey: "assignee", defaultVisible: true },
  { key: "assigned_group", label: "Group", width: "w-[150px] compact:w-[136px]", sortKey: "assigned_group", defaultVisible: true },
  // SLA bars are computed per row from the tracker payload (no DB ordering target) —
  // deliberately not sortable.
  { key: "sla_response", label: "Response SLA", width: "w-[150px] compact:w-[132px]", defaultVisible: true },
  { key: "sla_resolution", label: "Resolution SLA", width: "w-[150px] compact:w-[132px]", defaultVisible: true },
  { key: "created_at", label: "Created", width: "w-[120px] compact:w-[112px]", sortKey: "created_at", defaultVisible: true },
  { key: "created_by", label: "Created by", width: "w-[150px] compact:w-[136px]", sortKey: "created_by", defaultVisible: false },
  { key: "updated_at", label: "Updated", width: "w-[120px] compact:w-[112px]", sortKey: "updated_at", defaultVisible: false },
  { key: "updated_by", label: "Updated by", width: "w-[150px] compact:w-[136px]", sortKey: "updated_by", defaultVisible: false },
];

export const QUEUE_COLUMN_MAP: Record<string, QueueColumnDef> = Object.fromEntries(
  QUEUE_COLUMNS.map((c) => [c.key, c]),
);

export const DEFAULT_QUEUE_COLUMNS: string[] = QUEUE_COLUMNS.filter((c) => c.defaultVisible).map(
  (c) => c.key,
);

/** Full ordered key list: the visible columns first (in their order), then every
 *  remaining column in registry order. Used by the per-agent picker and the
 *  project-default editor to render every column with its checkbox. */
export function orderedColumnKeys(visible: string[]): string[] {
  const known = visible.filter((k) => QUEUE_COLUMN_MAP[k]);
  const seen = new Set(known);
  return [...known, ...QUEUE_COLUMNS.map((c) => c.key).filter((k) => !seen.has(k))];
}

/** Resolve the effective column layout: the agent's own saved layout wins, then
 *  the project default, then the built-in default. Unknown static keys are dropped;
 *  custom-field columns (`cf:<key>`) survive by prefix (so a project-default custom
 *  column isn't lost before the field registry loads — a since-deleted field just
 *  renders a blank cell). */
export function resolveQueueColumns(
  userPref: string[] | null | undefined,
  projectDefault: string[] | null | undefined,
): string[] {
  const valid = (k: string) => !!QUEUE_COLUMN_MAP[k] || k.startsWith("cf:");
  const clean = (arr: string[] | null | undefined) =>
    arr && arr.length ? arr.filter(valid) : null;
  const chosen = clean(userPref) ?? clean(projectDefault) ?? DEFAULT_QUEUE_COLUMNS;
  return chosen.length ? chosen : DEFAULT_QUEUE_COLUMNS;
}

/** Built-in default layout for the COMBINED ("All tickets") queue — the standard
 *  set with the Project column pinned second so a cross-project row's origin is
 *  always visible. Custom-field columns are off by default (added via the picker). */
export const COMBINED_DEFAULT_COLUMNS: string[] = [
  "ticket_number", "project", "summary", "status", "priority",
  "assignee", "assigned_group", "sla_response", "sla_resolution", "created_at",
];

/** Column definition for any key — a built-in column, or a dynamic custom-field
 *  column (`cf:<key>`) whose label comes from the filter-field registry. Lets the
 *  combined queue render custom columns the static registry doesn't know.
 *
 *  A custom column is sortable only when the server published an `ordering_key`
 *  for it (`cfSortKeys`) — the backend owns that rule (`CF_SORTABLE_TYPES`: no
 *  multi-select / cascade / rich-text / attachment), so never infer it from the
 *  field type here. */
export function queueColumnDef(
  key: string,
  cfLabels?: Record<string, string>,
  cfSortKeys?: Record<string, string>,
): { key: string; label: string; width?: string; sortKey?: string } {
  const def = QUEUE_COLUMN_MAP[key];
  if (def) return def;
  if (key.startsWith("cf:"))
    return {
      key,
      label: cfLabels?.[key] ?? key.slice(3),
      width: "w-[160px] compact:w-[140px]",
      sortKey: cfSortKeys?.[key],
    };
  return { key, label: key };
}

/** Resolve the combined queue's column layout: the agent's own saved layout wins,
 *  then the helpdesk-level admin default, then the built-in combined default.
 *  Unknown static keys are dropped; custom-field columns (`cf:<key>`) survive by
 *  prefix (so a stored one isn't lost before the field registry loads — a
 *  since-deleted field just renders a blank cell). */
export function resolveCombinedColumns(
  userPref: string[] | null | undefined,
  helpdeskDefault?: string[] | null | undefined,
): string[] {
  const valid = (k: string) => !!QUEUE_COLUMN_MAP[k] || k.startsWith("cf:");
  const clean = (arr: string[] | null | undefined) => (arr && arr.length ? arr.filter(valid) : null);
  const chosen = clean(userPref) ?? clean(helpdeskDefault) ?? COMBINED_DEFAULT_COLUMNS;
  return chosen.length ? chosen : COMBINED_DEFAULT_COLUMNS;
}

const RAG_BAR: Record<RagState, string> = {
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-destructive",
  grey: "bg-muted-foreground",
};

export function fmtQueueDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function remainingLabel(dueIso: string, now: number) {
  const diffMin = Math.round((new Date(dueIso).getTime() - now) / 60000);
  const overdue = diffMin < 0;
  const m = Math.abs(diffMin);
  const h = Math.floor(m / 60);
  const txt = h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  return overdue ? `${txt} over` : `${txt} left`;
}

/** Compact SLA RAG bar + remaining/overdue label for a queue cell — one line (bar
 *  beside the label), so the SLA columns never set the row height. */
export function SlaBar({ entry, now }: { entry?: QueueSlaEntry | null; now: number }) {
  if (!entry) return <span className="text-xs text-muted-foreground">—</span>;
  // A breached clock that has *stopped* (response given late / resolved late) is
  // finished — show "Breached", not a live "Xh over" that keeps growing. A
  // breached clock still *running* (overdue, not yet stopped) keeps the live label.
  const done = entry.state === "met" || entry.state === "breached" || entry.state === "stopped";
  const start = new Date(entry.started_at).getTime();
  const due = new Date(entry.due_at).getTime();
  const span = due - start;
  const frac = span > 0 ? Math.min(1, Math.max(0, (now - start) / span)) : 1;
  const label = entry.paused
    ? "Paused"
    : done
      ? entry.breached
        ? "Breached"
        : "Met"
      : remainingLabel(entry.due_at, now);
  return (
    <div className="flex min-w-[96px] items-center gap-2">
      <div className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn("h-full rounded-full transition-all", RAG_BAR[entry.rag])}
          style={{ width: `${Math.round(frac * 100)}%` }}
        />
      </div>
      <span
        className={cn(
          "shrink-0 whitespace-nowrap text-[11px] leading-4",
          entry.breached ? "font-medium text-destructive" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

/** One-line person cell: the name, with the email in the hover tooltip and read
 *  out by screen readers (a second email line doubled every row's height and was
 *  truncated in the ~130px column anyway — 2026-10-14). The ticket detail view still
 *  shows the email beside the name. */
const person = (u: UserRef | null) => {
  if (!u) return <span className="text-sm text-muted-foreground">—</span>;
  const name = u.full_name || u.username;
  return (
    <span className="block truncate text-sm" title={u.email ? `${name} · ${u.email}` : name}>
      {name}
      {u.email ? <span className="sr-only">, {u.email}</span> : null}
    </span>
  );
};

/** Render one queue cell's content for the given column key. `ctx.href` is the
 *  row's ticket-detail link (per-row so the combined queue can route each row to
 *  its own project); `ctx.project` supplies the Project column's name/colour. A
 *  `cf:<key>` column reads its display value from the row's `custom_values` map. */
export function renderQueueCell(
  key: string,
  t: TicketListItem,
  ctx: {
    href: string;
    now: number;
    project?: { name: string; color?: string } | null;
    /** Whether the Group column is visible — an unassigned row only falls back to the
     *  group name in the Assignee cell when there's no Group column showing it. */
    groupVisible?: boolean;
  },
): React.ReactNode {
  const linkCls =
    "hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  if (key.startsWith("cf:")) {
    const v = t.custom_values?.[key];
    if (v === null || v === undefined || v === "")
      return <span className="text-sm text-muted-foreground">—</span>;
    const text = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
    return (
      <span className="line-clamp-1 text-sm" title={text}>
        {text}
      </span>
    );
  }
  switch (key) {
    case "ticket_number":
      return (
        <Link href={ctx.href} className={cn("font-mono text-xs text-primary", linkCls)}>
          {t.ticket_number}
        </Link>
      );
    case "project": {
      const name = ctx.project?.name ?? t.project_key;
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          {ctx.project?.color ? (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: ctx.project.color }}
              aria-hidden="true"
            />
          ) : null}
          <span className="truncate text-sm" title={name}>
            {name}
          </span>
        </span>
      );
    }
    case "summary":
      return (
        <Link href={ctx.href} className={cn("line-clamp-1", linkCls)} title={t.summary}>
          {t.summary}
        </Link>
      );
    case "status":
      return <StatusBadge name={t.status_name} category={t.status_category} color={t.status_color} />;
    case "priority":
      return <PriorityTag priority={t.priority} />;
    case "requestor":
      return person(t.requestor);
    case "assignee":
      if (t.assignee) return person(t.assignee);
      return (
        <span
          className="block truncate text-sm text-muted-foreground"
          title={t.assigned_group_name ? `Group: ${t.assigned_group_name}` : undefined}
        >
          {!ctx.groupVisible && t.assigned_group_name ? t.assigned_group_name : "Unassigned"}
        </span>
      );
    case "assigned_group":
      return (
        <span className="block truncate text-sm text-muted-foreground" title={t.assigned_group_name ?? undefined}>
          {t.assigned_group_name ?? "—"}
        </span>
      );
    case "sla_response":
      return <SlaBar entry={t.sla?.first_response} now={ctx.now} />;
    case "sla_resolution":
      return <SlaBar entry={t.sla?.resolution} now={ctx.now} />;
    case "created_at":
      return <span className="whitespace-nowrap text-sm text-muted-foreground">{fmtQueueDate(t.created_at)}</span>;
    case "created_by":
      return person(t.created_by);
    case "updated_at":
      return <span className="whitespace-nowrap text-sm text-muted-foreground">{fmtQueueDate(t.updated_at)}</span>;
    case "updated_by":
      return person(t.updated_by);
    default:
      return null;
  }
}
