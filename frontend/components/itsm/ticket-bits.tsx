"use client";

/** Small shared presentational bits for ITSM ticket UI. */

import { ChevronsUp, ChevronUp, Equal, ChevronDown, Pause } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { Priority, RagState, SlaEntry, UserRef } from "@/lib/itsm/types";

// ---- priority -------------------------------------------------------------

const PRIORITY_META: Record<Priority, { label: string; icon: typeof ChevronUp; className: string }> = {
  critical: { label: "Critical", icon: ChevronsUp, className: "text-rose-600" },
  high: { label: "High", icon: ChevronUp, className: "text-orange-500" },
  medium: { label: "Medium", icon: Equal, className: "text-amber-500" },
  low: { label: "Low", icon: ChevronDown, className: "text-slate-400" },
};

export const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

export function PriorityIcon({ priority, withLabel }: { priority: Priority; withLabel?: boolean }) {
  const meta = PRIORITY_META[priority] ?? PRIORITY_META.medium;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1", meta.className)} title={meta.label}>
      <Icon className="h-4 w-4 shrink-0" />
      {withLabel && <span className="text-sm">{meta.label}</span>}
    </span>
  );
}

export function priorityLabel(p: Priority): string {
  return PRIORITY_META[p]?.label ?? p;
}

// ---- status ---------------------------------------------------------------

export function StatusBadge({
  name,
  color,
}: {
  name: string;
  color?: string | null;
}) {
  const bg = color || "#64748b";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${bg}1a`, color: bg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: bg }} />
      {name}
    </span>
  );
}

// ---- SLA RAG --------------------------------------------------------------

const RAG_CLASS: Record<RagState, string> = {
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-rose-100 text-rose-700",
  grey: "bg-slate-100 text-slate-500",
};

const RAG_DOT: Record<RagState, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  grey: "bg-slate-400",
};

/** Derive a RAG bucket from a due_date relative to now. */
export function ragFromDue(due: string | null | undefined): { rag: RagState; label: string } {
  if (!due) return { rag: "grey", label: "—" };
  const ms = new Date(due).getTime() - Date.now();
  if (Number.isNaN(ms)) return { rag: "grey", label: "—" };
  const label = ms <= 0 ? `Overdue ${humanizeMs(-ms)}` : `${humanizeMs(ms)} left`;
  let rag: RagState = "green";
  if (ms <= 0) rag = "red";
  else if (ms <= 60 * 60 * 1000) rag = "amber"; // < 1h
  return { rag, label };
}

export function RagPill({
  rag,
  label,
  paused,
}: {
  rag: RagState;
  label: string;
  paused?: boolean;
}) {
  if (paused) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
        <Pause className="h-3 w-3" /> Paused
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", RAG_CLASS[rag])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", RAG_DOT[rag])} />
      {label}
    </span>
  );
}

export function slaRag(entry: SlaEntry): { rag: RagState; label: string } {
  if (entry.breached) return { rag: "red", label: "Breached" };
  if (entry.due_at) return ragFromDue(entry.due_at);
  return { rag: entry.rag ?? "grey", label: entry.state ?? "—" };
}

// ---- misc -----------------------------------------------------------------

export function initials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
}

export function UserPill({ user }: { user: UserRef | null }) {
  if (!user) return <span className="text-muted-foreground">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700">
        {initials(user.full_name || user.username)}
      </span>
      <span className="truncate">{user.full_name || user.username}</span>
    </span>
  );
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

export function humanizeMs(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH ? `${days}d ${remH}h` : `${days}d`;
}
