"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";
import type { QueueSlaEntry, RagState, TicketListItem, UserRef } from "@/lib/itsm/types";
import { PriorityTag } from "./priority-tag";
import { StatusBadge } from "./status-badge";

/** The full catalogue of queue columns. `sortKey` (when present) is the
 *  `ordering=` param the server understands; columns without one aren't
 *  sortable. `defaultVisible` defines the built-in default layout — the current
 *  columns plus Requestor, Group and the two SLA bars (per the spec). */
export type QueueColumnKey =
  | "ticket_number"
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

export const QUEUE_COLUMNS: QueueColumnDef[] = [
  { key: "ticket_number", label: "ID", width: "w-[120px]", sortKey: "ticket_number", defaultVisible: true },
  { key: "summary", label: "Summary", sortKey: "summary", defaultVisible: true },
  { key: "status", label: "Status", width: "w-[140px]", sortKey: "status", defaultVisible: true },
  { key: "priority", label: "Priority", width: "w-[90px]", sortKey: "priority", defaultVisible: true },
  { key: "requestor", label: "Requestor", width: "w-[150px]", defaultVisible: true },
  { key: "assignee", label: "Assignee", width: "w-[160px]", sortKey: "assignee", defaultVisible: true },
  { key: "assigned_group", label: "Group", width: "w-[150px]", defaultVisible: true },
  { key: "sla_response", label: "Response SLA", width: "w-[150px]", defaultVisible: true },
  { key: "sla_resolution", label: "Resolution SLA", width: "w-[150px]", defaultVisible: true },
  { key: "created_at", label: "Created", width: "w-[120px]", sortKey: "created_at", defaultVisible: true },
  { key: "created_by", label: "Created by", width: "w-[150px]", defaultVisible: false },
  { key: "updated_at", label: "Updated", width: "w-[120px]", sortKey: "updated_at", defaultVisible: false },
  { key: "updated_by", label: "Updated by", width: "w-[150px]", defaultVisible: false },
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
 *  the project default, then the built-in default. Unknown keys are dropped so a
 *  stale preference can never break the table. */
export function resolveQueueColumns(
  userPref: string[] | null | undefined,
  projectDefault: string[] | null | undefined,
): string[] {
  const clean = (arr: string[] | null | undefined) =>
    arr && arr.length ? arr.filter((k) => QUEUE_COLUMN_MAP[k]) : null;
  const chosen = clean(userPref) ?? clean(projectDefault) ?? DEFAULT_QUEUE_COLUMNS;
  return chosen.length ? chosen : DEFAULT_QUEUE_COLUMNS;
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

/** Compact SLA RAG bar + remaining/overdue label for a queue cell. */
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
    <div className="flex min-w-[110px] flex-col gap-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn("h-full rounded-full transition-all", RAG_BAR[entry.rag])}
          style={{ width: `${Math.round(frac * 100)}%` }}
        />
      </div>
      <span className={cn("text-[11px]", entry.breached ? "font-medium text-destructive" : "text-muted-foreground")}>
        {label}
      </span>
    </div>
  );
}

const person = (u: UserRef | null) => {
  if (!u) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-sm">{u.full_name || u.username}</span>
      {u.email ? <span className="truncate text-xs text-muted-foreground">{u.email}</span> : null}
    </span>
  );
};

/** Render one queue cell's content for the given column key. */
export function renderQueueCell(
  key: string,
  t: TicketListItem,
  ctx: { base: string; now: number },
): React.ReactNode {
  const linkCls =
    "hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  switch (key) {
    case "ticket_number":
      return (
        <Link href={`${ctx.base}/${t.ticket_number}`} className={cn("font-mono text-xs text-primary", linkCls)}>
          {t.ticket_number}
        </Link>
      );
    case "summary":
      return (
        <Link href={`${ctx.base}/${t.ticket_number}`} className={cn("line-clamp-1", linkCls)} title={t.summary}>
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
      return t.assignee ? (
        person(t.assignee)
      ) : (
        <span className="text-sm text-muted-foreground">{t.assigned_group_name ?? "Unassigned"}</span>
      );
    case "assigned_group":
      return <span className="text-sm text-muted-foreground">{t.assigned_group_name ?? "—"}</span>;
    case "sla_response":
      return <SlaBar entry={t.sla?.first_response} now={ctx.now} />;
    case "sla_resolution":
      return <SlaBar entry={t.sla?.resolution} now={ctx.now} />;
    case "created_at":
      return <span className="text-sm text-muted-foreground">{fmtQueueDate(t.created_at)}</span>;
    case "created_by":
      return person(t.created_by);
    case "updated_at":
      return <span className="text-sm text-muted-foreground">{fmtQueueDate(t.updated_at)}</span>;
    case "updated_by":
      return person(t.updated_by);
    default:
      return null;
  }
}
