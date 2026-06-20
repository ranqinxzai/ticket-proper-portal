"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { PriorityTag } from "@/components/tickets/priority-tag";
import { ticketsApi } from "@/lib/itsm/api";
import { cn } from "@/lib/utils";
import type { Priority, TicketListItem } from "@/lib/itsm/types";

const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

export default function WorkspaceDashboard() {
  const { helpdeskKey, projects, loading } = useWorkspace();
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  useEffect(() => {
    if (projects.length === 0) return;
    let cancelled = false;
    setTicketsLoading(true);
    Promise.all(projects.map((p) => ticketsApi.list({ project: p.id })))
      .then((lists) => !cancelled && setTickets(lists.flat()))
      .catch(() => !cancelled && setTickets([]))
      .finally(() => !cancelled && setTicketsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const kpis = useMemo(() => {
    const open = tickets.filter((t) => t.status_category !== "done").length;
    const inProgress = tickets.filter((t) => t.status_category === "in_progress").length;
    const done = tickets.filter((t) => t.status_category === "done").length;
    const byPriority = PRIORITIES.map((p) => ({
      p,
      n: tickets.filter((t) => t.priority === p && t.status_category !== "done").length,
    }));
    return { total: tickets.length, open, inProgress, done, byPriority };
  }, [tickets]);

  const busy = loading || ticketsLoading;

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold">Dashboard</h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Open" value={kpis.open} busy={busy} accent="text-primary" />
        <Kpi label="In progress" value={kpis.inProgress} busy={busy} accent="text-warning" />
        <Kpi label="Resolved / closed" value={kpis.done} busy={busy} accent="text-success" />
        <Kpi label="Total" value={kpis.total} busy={busy} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">Open by priority</h3>
          {busy ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ul className="space-y-2">
              {kpis.byPriority.map(({ p, n }) => {
                const max = Math.max(1, ...kpis.byPriority.map((x) => x.n));
                return (
                  <li key={p} className="flex items-center gap-3 text-sm">
                    <span className="w-20 shrink-0">
                      <PriorityTag priority={p} />
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${(n / max) * 100}%` }} />
                    </span>
                    <span className="w-6 text-right font-medium tabular-nums">{n}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">Projects</h3>
          <ul className="space-y-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/agent/w/${helpdeskKey}/p/${p.key}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.key}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  busy,
  accent,
}: {
  label: string;
  value: number;
  busy: boolean;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-3xl font-semibold tabular-nums", accent)}>{busy ? "—" : value}</p>
    </div>
  );
}
