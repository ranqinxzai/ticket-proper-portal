"use client";

import Link from "next/link";
import { ArrowUpRight, Inbox } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PriorityTag } from "@/components/tickets/priority-tag";
import { StatusBadge } from "@/components/tickets/status-badge";
import type { Priority, StatusCategory } from "@/lib/itsm/types";

/** One ticket line in a drill-down list, normalized from either a `ticketsApi.list`
 *  row or a report row (the SLA drill-down lists) by the dashboard. */
export type DrillRow = {
  id: string;
  ticketNumber: string;
  /** Ticket-detail deep link (built by the dashboard from org/helpdesk/project). */
  href: string;
  summary: string;
  priority?: Priority | null;
  statusName?: string | null;
  statusCategory?: StatusCategory | null;
  statusColor?: string | null;
  assignee?: string | null;
  dueDate?: string | null;
};

export type DrillState = {
  open: boolean;
  title: string;
  subtitle?: string;
  loading: boolean;
  error: boolean;
  rows: DrillRow[];
  /** True match count (may exceed the capped `rows`). */
  total: number;
  /** "Open all in queue / full report" link, when the category maps to one. */
  queueHref?: string;
  queueLabel?: string;
};

/** Right-side slide-over listing the tickets behind a clicked chart segment / KPI /
 *  attention tile — the answer to "which tickets are these?" — with a link out to
 *  the full, filterable queue (or report). Presentational: the dashboard owns the
 *  fetch and passes normalized rows. Closes on Esc / overlay click (Radix). */
export function DrillDownSheet({
  state,
  onClose,
}: {
  state: DrillState;
  onClose: () => void;
}) {
  const { open, title, subtitle, loading, error, rows, total, queueHref, queueLabel } = state;
  const capped = total > rows.length;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 p-0">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {loading
              ? "Loading…"
              : error
                ? "Could not load these tickets."
                : total === 0
                  ? "No matching tickets."
                  : capped
                    ? `Showing ${rows.length} of ${total} tickets${subtitle ? ` · ${subtitle}` : ""}`
                    : `${total} ticket${total === 1 ? "" : "s"}${subtitle ? ` · ${subtitle}` : ""}`}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <ul className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i}>
                  <Skeleton className="h-14 w-full rounded-lg" />
                </li>
              ))}
            </ul>
          ) : error ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Something went wrong loading these tickets. Try again.
            </p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Inbox className="size-6" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-foreground">Nothing here right now</p>
              <p className="text-xs text-muted-foreground">No tickets match this selection.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link
                    href={r.href}
                    onClick={onClose}
                    className="flex flex-col gap-1.5 px-5 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:bg-accent"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-medium text-primary">{r.ticketNumber}</span>
                      {r.priority ? <PriorityTag priority={r.priority} /> : null}
                      {r.statusName ? (
                        <span className="ml-auto">
                          <StatusBadge
                            name={r.statusName}
                            category={r.statusCategory ?? "todo"}
                            color={r.statusColor}
                          />
                        </span>
                      ) : null}
                    </div>
                    <p className="line-clamp-2 text-sm text-foreground">{r.summary}</p>
                    {r.assignee || r.dueDate ? (
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {r.assignee ? <span className="truncate">{r.assignee}</span> : <span className="italic">Unassigned</span>}
                        {r.dueDate ? (
                          <span className="ml-auto tabular-nums">
                            Due {new Date(r.dueDate).toLocaleDateString()}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {queueHref && !loading && !error && rows.length > 0 ? (
          <div className="border-t p-4">
            <Link
              href={queueHref}
              onClick={onClose}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {queueLabel ?? "Open in queue"}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
