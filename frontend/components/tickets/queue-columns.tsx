"use client";

import Link from "next/link";

import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { fullDateTime } from "@/lib/itsm/help/format";
import { QUEUE_COLUMN_HELP, QUEUE_PREVIEW_HELP } from "@/lib/itsm/help/queue";
import { SLA_NONE_HELP, slaTooltip } from "@/lib/itsm/help/sla";
import { statusTooltip } from "@/lib/itsm/help/status";
import type { FilterFieldMeta, QueueSlaEntry, RagState, TicketListItem, UserRef } from "@/lib/itsm/types";
import { PriorityTag } from "./priority-tag";
import { StatusBadge } from "./status-badge";

/** Which filter-registry entries may be offered as `cf:<key>` QUEUE COLUMNS.
 *  Value-backed custom fields always qualify. A column-backed system field
 *  (`config.maps_to`) qualifies only when the server flags it `column` — the ITIL
 *  set (Resolution Notes, Root Cause, Impact …), whose cells the server reads off
 *  the Ticket column. The rest (Description, and the Priority / Requestor / …
 *  duplicates of built-in columns) stay filter-only. */
export const isColumnEligibleCf = (f: FilterFieldMeta) =>
  f.key.startsWith("cf:") && (!f.maps_to || !!f.column);

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
  /** Hover help for the column header / picker row (QUEUE_COLUMN_HELP). */
  description?: string;
};

// Widths go on both the header and body cells. Fixed columns narrow slightly in the
// agent app's compact density (`compact:w-…`); Summary is the one flexible column and
// keeps a 220px floor so it never collapses to its longest word when the fixed
// columns overflow — the pane then scrolls sideways instead (2026-10-14).
const QUEUE_COLUMNS_BASE: Omit<QueueColumnDef, "description">[] = [
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

export const QUEUE_COLUMNS: QueueColumnDef[] = QUEUE_COLUMNS_BASE.map((c) => ({
  ...c,
  description: QUEUE_COLUMN_HELP[c.key],
}));

export const QUEUE_COLUMN_MAP: Record<string, QueueColumnDef> = Object.fromEntries(
  QUEUE_COLUMNS.map((c) => [c.key, c]),
);

export const DEFAULT_QUEUE_COLUMNS: string[] = QUEUE_COLUMNS.filter((c) => c.defaultVisible).map(
  (c) => c.key,
);

/** A stored column layout (`Project.queue_columns`, `Helpdesk.combined_queue_columns`,
 *  an agent's own pref) is the FULL ordered list the editor showed: a plain key is a
 *  visible column, a `!`-prefixed key is hidden but keeps its place — so a column you
 *  untick comes back where it was. Older layouts hold only the visible keys and decode
 *  exactly as before (hidden columns then fall back to registry order). Mirrors the
 *  backend `filter_fields.clean_queue_columns` (`HIDDEN_COLUMN_PREFIX`). */
export const HIDDEN_COL_PREFIX = "!";

/** Split a stored layout into its full order (hidden keys included, de-prefixed)
 *  and the visible keys (in order). */
export function decodeColumnLayout(stored: string[] | null | undefined): { order: string[]; visible: string[] } {
  const order: string[] = [];
  const visible: string[] = [];
  const seen = new Set<string>();
  for (const raw of stored ?? []) {
    if (typeof raw !== "string") continue;
    const hidden = raw.startsWith(HIDDEN_COL_PREFIX);
    const key = hidden ? raw.slice(HIDDEN_COL_PREFIX.length) : raw;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    order.push(key);
    if (!hidden) visible.push(key);
  }
  return { order, visible };
}

/** The storable layout for an ordered key list + the visible set. */
export function encodeColumnLayout(order: string[], visible: Set<string> | string[]): string[] {
  const vis = visible instanceof Set ? visible : new Set(visible);
  return order.map((k) => (vis.has(k) ? k : `${HIDDEN_COL_PREFIX}${k}`));
}

/** Full ordered key list: the stored order (hidden columns keep their place), then
 *  every remaining column in registry order. */
export function orderedColumnKeys(stored: string[]): string[] {
  const known = decodeColumnLayout(stored).order.filter((k) => QUEUE_COLUMN_MAP[k]);
  const seen = new Set(known);
  return [...known, ...QUEUE_COLUMNS.map((c) => c.key as string).filter((k) => !seen.has(k))];
}

const isValidColumnKey = (k: string) => !!QUEUE_COLUMN_MAP[k] || k.startsWith("cf:");

/** The first non-empty stored layout wins (agent pref → scope default); if it has no
 *  valid visible column, the built-in `fallback` applies — the same precedence the
 *  queue has always used. Returns both the winning stored layout (for the picker's
 *  order) and its visible keys (what the table renders). Unknown static keys are
 *  dropped; custom-field columns (`cf:<key>`) survive by prefix (so a stored one
 *  isn't lost before the field registry loads — a since-deleted field just renders a
 *  blank cell). */
function resolveLayoutFrom(
  candidates: (string[] | null | undefined)[],
  fallback: string[],
): { layout: string[]; visible: string[] } {
  for (const arr of candidates) {
    if (arr && arr.length) {
      const visible = decodeColumnLayout(arr).visible.filter(isValidColumnKey);
      return visible.length ? { layout: arr, visible } : { layout: fallback, visible: fallback };
    }
  }
  return { layout: fallback, visible: fallback };
}

/** Resolve the effective (visible) column layout: the agent's own saved layout wins,
 *  then the project default, then the built-in default. */
export function resolveQueueColumns(
  userPref: string[] | null | undefined,
  projectDefault: string[] | null | undefined,
): string[] {
  return resolveLayoutFrom([userPref, projectDefault], DEFAULT_QUEUE_COLUMNS).visible;
}

/** The stored layout behind `resolveQueueColumns` (hidden columns included) — the
 *  column picker uses it so hidden columns keep their order. */
export function resolveQueueLayout(
  userPref: string[] | null | undefined,
  projectDefault: string[] | null | undefined,
): string[] {
  return resolveLayoutFrom([userPref, projectDefault], DEFAULT_QUEUE_COLUMNS).layout;
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
): { key: string; label: string; width?: string; sortKey?: string; description?: string } {
  const def = QUEUE_COLUMN_MAP[key];
  if (def) return def;
  if (key.startsWith("cf:"))
    return {
      key,
      label: cfLabels?.[key] ?? key.slice(3),
      width: "w-[160px] compact:w-[140px]",
      sortKey: cfSortKeys?.[key],
      description: "Custom field",
    };
  return { key, label: key };
}

/** Resolve the combined queue's (visible) column layout: the agent's own saved
 *  layout wins, then the helpdesk-level admin default, then the built-in combined
 *  default. */
export function resolveCombinedColumns(
  userPref: string[] | null | undefined,
  helpdeskDefault?: string[] | null | undefined,
): string[] {
  return resolveLayoutFrom([userPref, helpdeskDefault], COMBINED_DEFAULT_COLUMNS).visible;
}

/** The stored layout behind `resolveCombinedColumns` (hidden columns included). */
export function resolveCombinedLayout(
  userPref: string[] | null | undefined,
  helpdeskDefault?: string[] | null | undefined,
): string[] {
  return resolveLayoutFrom([userPref, helpdeskDefault], COMBINED_DEFAULT_COLUMNS).layout;
}

export const RAG_BAR: Record<RagState, string> = {
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-destructive",
  grey: "bg-muted-foreground",
};

/** Tinted pill per RAG state (Modern docked queue). Text on its own tint, AA in both themes. */
const RAG_PILL: Record<RagState, string> = {
  green: "bg-success/10 text-success",
  amber: "bg-warning/15 text-warning",
  red: "bg-destructive/10 text-destructive",
  grey: "bg-muted text-muted-foreground",
};

export function fmtQueueDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export function remainingLabel(dueIso: string, now: number) {
  const diffMin = Math.round((new Date(dueIso).getTime() - now) / 60000);
  const overdue = diffMin < 0;
  const m = Math.abs(diffMin);
  const h = Math.floor(m / 60);
  const txt = h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  return overdue ? `${txt} over` : `${txt} left`;
}

/** Compact SLA RAG bar + remaining/overdue label for a queue cell — one line (bar
 *  beside the label), so the SLA columns never set the row height. */
export function SlaBar({
  entry,
  now,
  metric,
}: {
  entry?: QueueSlaEntry | null;
  now: number;
  /** `SLAMetric.kind` of this clock — adds "what this SLA measures" to the hover help. */
  metric?: "first_response" | "resolution";
}) {
  if (!entry)
    return (
      <span className="text-xs text-muted-foreground" title={SLA_NONE_HELP}>
        —
      </span>
    );
  // A breached clock that has *stopped* (response given late / resolved late) is
  // finished — show "Breached", not a live "Xh over" that keeps growing. A
  // breached clock still *running* (overdue, not yet stopped) keeps the live label.
  const done = entry.state === "met" || entry.state === "breached" || entry.state === "stopped";
  // Width = business-time share of the target used (server `percent_used`, the same
  // figure + colour as the detail panel — not a wall-clock fraction, which raced
  // ahead overnight and at weekends). A running clock past its due time is full + red
  // right away, even before the next refetch.
  const overdueNow = entry.state === "running" && now > new Date(entry.due_at).getTime();
  const pct = overdueNow ? 100 : Math.min(100, Math.max(0, entry.percent_used ?? 0));
  const rag: RagState = overdueNow ? "red" : entry.rag;
  const label = entry.paused
    ? "Paused"
    : done
      ? entry.breached
        ? "Breached"
        : "Met"
      : remainingLabel(entry.due_at, now);
  return (
    <Hint label={slaTooltip(entry, metric, { withBands: true })} wrap className="w-full">
    <div className="flex min-w-[96px] flex-1 items-center gap-2">
      <div className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn("h-full rounded-full transition-all", RAG_BAR[rag])}
          style={{ width: `${Math.round(pct)}%` }}
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
    </Hint>
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

/** The ticket-number hover card in the Modern queue (2026-11-05c): number · status,
 *  the summary and the first ~6 lines of the description (`description_preview`, plain
 *  text cut at 300 characters by the list serializer). Module-level (focus stability). */
function TicketPreviewCard({ t }: { t: TicketListItem }) {
  const text = (t.description_preview ?? "").trim();
  return (
    <span className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] text-muted-foreground">
        {t.ticket_number} · {t.status_name}
      </span>
      <span className="line-clamp-2 text-sm font-medium leading-5 text-foreground">{t.summary}</span>
      {text ? (
        <span className="line-clamp-6 whitespace-pre-line text-[13px] leading-[18px] text-foreground">{text}</span>
      ) : (
        <span className="text-xs text-muted-foreground">{QUEUE_PREVIEW_HELP.empty}</span>
      )}
    </span>
  );
}

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
    /** Modern queue (2026-11-05c): one-line status chips and the description preview on
     *  the ticket number. Classic never passes it, so its cells are unchanged. */
    modern?: boolean;
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
    case "ticket_number": {
      const link = (
        <Link
          href={ctx.href}
          className={cn("font-mono text-xs text-primary modern:text-muted-foreground modern:hover:text-foreground", linkCls)}
        >
          {t.ticket_number}
        </Link>
      );
      if (!ctx.modern) return link;
      // Hover the number: the first lines of the description, without opening it.
      return (
        <Hint
          label={<TicketPreviewCard t={t} />}
          side="right"
          align="start"
          delayDuration={400}
          contentClassName="w-80 max-w-sm border bg-popover p-3 text-popover-foreground shadow-md"
        >
          {link}
        </Hint>
      );
    }
    case "project": {
      const name = ctx.project?.name ?? t.project_key;
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          {ctx.project?.color ? (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: ctx.project.color }}
              title={`Project colour: ${name}`}
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
        <Link href={ctx.href} className={cn("line-clamp-1", linkCls)} title={t.summary} data-row-link="">
          {t.summary}
        </Link>
      );
    case "status":
      return (
        <StatusBadge name={t.status_name} category={t.status_category} color={t.status_color} truncate={ctx.modern} />
      );
    // Modern docked queue (step B4): the status as a coloured dot; the name is in the
    // tooltip and read out by screen readers (never colour alone).
    case "status_dot": {
      const fallback =
        t.status_category === "done"
          ? "hsl(var(--success))"
          : t.status_category === "in_progress"
            ? "hsl(var(--primary))"
            : "hsl(var(--muted-foreground))";
      return (
        <Hint label={statusTooltip(t.status_name, t.status_category)}>
          <span className="inline-flex h-4 w-4 items-center justify-center">
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: t.status_color || fallback }} />
            <span className="sr-only">{t.status_name}</span>
          </span>
        </Hint>
      );
    }
    case "priority":
      return <PriorityTag priority={t.priority} />;
    case "requestor":
      return person(t.requestor);
    case "assignee":
      if (t.assignee) return person(t.assignee);
      return (
        <span
          className="block truncate text-sm text-muted-foreground"
          title={
            t.assigned_group_name
              ? `Not assigned to a technician yet · Group: ${t.assigned_group_name}`
              : "Not assigned to a technician or group yet"
          }
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
    // Modern docked queue (step B4): the resolution clock as a small tinted pill with the
    // time only ("2h 10m", "35m over"); same state and colour rules as SlaBar.
    case "sla_compact": {
      const e = t.sla?.resolution;
      if (!e)
        return (
          <span className="text-xs text-muted-foreground" title={SLA_NONE_HELP}>
            —
          </span>
        );
      const done = e.state === "met" || e.state === "breached" || e.state === "stopped";
      const overdueNow = e.state === "running" && ctx.now > new Date(e.due_at).getTime();
      const rag: RagState = overdueNow ? "red" : e.rag;
      const label = e.paused
        ? "Paused"
        : done
          ? e.breached
            ? "Breached"
            : "Met"
          : remainingLabel(e.due_at, ctx.now).replace(/ left$/, "");
      return (
        <Hint label={slaTooltip(e, "resolution", { withBands: true })}>
          <span
            className={cn(
              "inline-flex h-[18px] items-center whitespace-nowrap rounded px-1.5 font-mono text-xs tabular-nums",
              RAG_PILL[e.paused || done ? "grey" : rag],
            )}
          >
            {label}
          </span>
        </Hint>
      );
    }
    case "sla_response":
      return <SlaBar entry={t.sla?.first_response} now={ctx.now} metric="first_response" />;
    case "sla_resolution":
      return <SlaBar entry={t.sla?.resolution} now={ctx.now} metric="resolution" />;
    case "created_at":
      return (
        <span className="whitespace-nowrap text-sm text-muted-foreground" title={fullDateTime(t.created_at)}>
          {fmtQueueDate(t.created_at)}
        </span>
      );
    case "created_by":
      return person(t.created_by);
    case "updated_at":
      return (
        <span className="whitespace-nowrap text-sm text-muted-foreground" title={fullDateTime(t.updated_at)}>
          {fmtQueueDate(t.updated_at)}
        </span>
      );
    case "updated_by":
      return person(t.updated_by);
    default:
      return null;
  }
}
