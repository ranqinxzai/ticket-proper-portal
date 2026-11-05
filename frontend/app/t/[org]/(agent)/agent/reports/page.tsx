"use client";

import { useEffect, useState } from "react";

import { PageHeader } from "@/components/shell/page-header";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { canReadModule, SLA_REPORTS_MODULE } from "@/components/reports/catalog";
import { reportsApi } from "@/lib/itsm/api";
import { useItsmAuth } from "@/lib/itsm/auth";
import { GLOBAL_DISTRIBUTION_HELP, GLOBAL_SLA_COMPLIANCE_HELP } from "@/lib/itsm/help/reports";
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
    <ul className="space-y-2 compact:space-y-1.5">
      {rows.map((r, i) => {
        const v = valueOf(r);
        return (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0 truncate capitalize text-muted-foreground" title={labelOf(r)}>
              {labelOf(r)}
            </span>
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

function Card({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5 text-card-foreground shadow-soft compact:p-3.5">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold compact:mb-2">
        {title}
        <InfoTip label={`About ${title}`}>{help}</InfoTip>
      </h2>
      {children}
    </section>
  );
}

export default function ReportsPage() {
  const { user, hasPerm } = useItsmAuth();
  // SLA compliance needs itsm.reports.sla on top of itsm.reports (API 403s otherwise).
  const canSla = canReadModule(
    user?.permissions as Record<string, { read?: boolean }> | undefined,
    hasPerm,
    SLA_REPORTS_MODULE,
  );
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
      canSla ? reportsApi.get("sla-compliance") : Promise.reject(new Error("no access")),
    ])
      .then(([s, p, g, sl]) => {
        if (s.status === "fulfilled") setByStatus(asRows(s.value.data));
        if (p.status === "fulfilled") setByPriority(asRows(p.value.data));
        if (g.status === "fulfilled") setByGroup(asRows(g.value.data));
        setSla(sl.status === "fulfilled" ? ((sl.value.data as Row) ?? null) : null);
      })
      .finally(() => setLoading(false));
  }, [canSla]);

  // `compliance_pct` is null when no SLA timer has finished yet — show "—", not a red 0%.
  const slaPct = sla && sla.compliance_pct != null ? Number(sla.compliance_pct) : null;
  const slaByMetric: Row[] = sla && Array.isArray(sla.by_metric) ? (sla.by_metric as Row[]) : [];

  return (
    <div className="space-y-6 compact:space-y-4">
      <PageHeader title="Reports" description="Live across all workspaces you can access." />

      {loading ? (
        <div className="grid gap-4 compact:gap-3 lg:grid-cols-2 2xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        // 4 cards side by side on wide screens (was 2 at every width); items-start so a
        // short card (SLA) doesn't stretch to its row-mate's height.
        <div className="grid items-start gap-4 compact:gap-3 lg:grid-cols-2 2xl:grid-cols-4">
          {sla ? (
            <Card title="SLA compliance" help={GLOBAL_SLA_COMPLIANCE_HELP}>
              <div className="flex items-end gap-6">
                <p
                  className={cn(
                    "text-4xl font-semibold",
                    slaPct == null
                      ? "text-muted-foreground"
                      : slaPct >= 90
                        ? "text-success"
                        : slaPct >= 75
                          ? "text-warning"
                          : "text-destructive",
                  )}
                >
                  {slaPct == null ? "—" : `${slaPct}%`}
                </p>
                <ul className="text-sm text-muted-foreground">
                  <li>
                    Tickets: {String(sla.met ?? 0)} met · {String(sla.breached ?? 0)} breached
                  </li>
                  {slaByMetric.map((m) => (
                    <li key={String(m.metric)}>
                      {String(m.label ?? m.metric)}:{" "}
                      {m.compliance_pct == null ? "—" : `${String(m.compliance_pct)}%`}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          ) : null}
          <Card title="Tickets by status" help={GLOBAL_DISTRIBUTION_HELP}>
            <BarList rows={byStatus} />
          </Card>
          <Card title="Tickets by priority" help={GLOBAL_DISTRIBUTION_HELP}>
            <BarList rows={byPriority} />
          </Card>
          <Card title="Tickets by team" help={`${GLOBAL_DISTRIBUTION_HELP} "Unassigned" = no team.`}>
            <BarList rows={byGroup} />
          </Card>
        </div>
      )}
    </div>
  );
}
