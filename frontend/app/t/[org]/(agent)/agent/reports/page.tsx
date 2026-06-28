"use client";

import { useEffect, useState } from "react";

import { reportsApi } from "@/lib/itsm/api";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown>;

function labelOf(r: Row): string {
  return String(
    r.status ?? r.priority ?? r.group ?? r.group_name ?? r.project ?? r.project_key ?? r.agent ?? r.label ?? "—",
  );
}
function valueOf(r: Row): number {
  const v = r.value ?? r.n ?? r.count ?? r.total ?? 0;
  return typeof v === "number" ? v : Number(v) || 0;
}

function BarList({ rows }: { rows: Row[] }) {
  const max = Math.max(1, ...rows.map(valueOf));
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No data.</p>;
  return (
    <ul className="max-w-2xl space-y-2">
      {rows.map((r, i) => {
        const v = valueOf(r);
        return (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0 truncate capitalize text-muted-foreground">{labelOf(r)}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${(v / max) * 100}%` }} />
            </span>
            <span className="w-8 text-right font-medium tabular-nums">{v}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function ReportsPage() {
  const [byStatus, setByStatus] = useState<Row[]>([]);
  const [byPriority, setByPriority] = useState<Row[]>([]);
  const [byGroup, setByGroup] = useState<Row[]>([]);
  const [sla, setSla] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const asRows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
    Promise.allSettled([
      reportsApi.get("by-status"),
      reportsApi.get("by-priority"),
      reportsApi.get("by-group"),
      reportsApi.get("sla-compliance"),
    ])
      .then(([s, p, g, sl]) => {
        if (s.status === "fulfilled") setByStatus(asRows(s.value.data));
        if (p.status === "fulfilled") setByPriority(asRows(p.value.data));
        if (g.status === "fulfilled") setByGroup(asRows(g.value.data));
        if (sl.status === "fulfilled") setSla((sl.value.data as Row) ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  const slaPct = sla ? Number(sla.compliance_pct ?? 0) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live across all workspaces you can access.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sla ? (
            <Card title="SLA compliance">
              <div className="flex items-end gap-6">
                <p className={cn("text-4xl font-semibold", slaPct >= 90 ? "text-success" : slaPct >= 75 ? "text-warning" : "text-destructive")}>
                  {slaPct}%
                </p>
                <ul className="text-sm text-muted-foreground">
                  <li>Total: {String(sla.total ?? 0)}</li>
                  <li>Met: {String(sla.met ?? 0)}</li>
                  <li>Breached: {String(sla.breached ?? 0)}</li>
                </ul>
              </div>
            </Card>
          ) : null}
          <Card title="Tickets by status">
            <BarList rows={byStatus} />
          </Card>
          <Card title="Tickets by priority">
            <BarList rows={byPriority} />
          </Card>
          <Card title="Tickets by group">
            <BarList rows={byGroup} />
          </Card>
        </div>
      )}
    </div>
  );
}
