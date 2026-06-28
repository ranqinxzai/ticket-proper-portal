"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, subDays } from "date-fns";
import {
  AlarmClock,
  ArrowUpRight,
  CheckCircle2,
  Inbox,
  Loader2,
  ShieldAlert,
  Ticket as TicketIcon,
  Timer,
  TrendingUp,
  UserX,
} from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import {
  AlertTile,
  BarList,
  DonutChart,
  DualTrendChart,
  GaugeChart,
  KpiCard,
  MiniTable,
  ReportCard,
  pctChange,
  valueOf,
  type ReportRow,
} from "@/components/reports/report-views";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { reportsApi, ticketsApi } from "@/lib/itsm/api";
import type { Priority, TicketListItem } from "@/lib/itsm/types";

const PERIODS = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
];
const ALL_PROJECTS = "all";

/** Display order + segment colours for the priority breakdown. */
const PRIORITY_ORDER: Priority[] = ["critical", "high", "medium", "low"];
const PRIORITY_COLOR: Record<Priority, string> = {
  critical: "hsl(var(--destructive))",
  high: "hsl(var(--warning))",
  medium: "hsl(var(--chart-1))",
  low: "hsl(var(--muted-foreground))",
};

const asRows = (d: unknown): ReportRow[] => (Array.isArray(d) ? (d as ReportRow[]) : []);
const asObj = (d: unknown): ReportRow =>
  d && typeof d === "object" && !Array.isArray(d) ? (d as ReportRow) : {};

/** Compact "Xh" / "X.Xd" label for a duration given in hours. */
function fmtHours(h: number | null): string {
  if (h == null || !Number.isFinite(h)) return "—";
  if (h < 1) return "<1h";
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export default function WorkspaceDashboard() {
  const { org, helpdeskKey, helpdesk, projects, loading: wsLoading } = useWorkspace();
  const [periodKey, setPeriodKey] = useState("30");
  const [projectId, setProjectId] = useState(ALL_PROJECTS);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const period = PERIODS.find((p) => p.key === periodKey) ?? PERIODS[1];

  // Point-in-time scope (no date filter → live current state).
  const scope = useMemo(
    () => ({
      helpdesk: helpdesk?.id,
      project: projectId === ALL_PROJECTS ? undefined : projectId,
    }),
    [helpdesk?.id, projectId],
  );

  useEffect(() => {
    if (!helpdesk?.id) return;
    let cancelled = false;
    setLoading(true);

    const since = format(subDays(new Date(), period.days), "yyyy-MM-dd");
    const trendDays = period.days * 2; // fetch 2× window so we can derive deltas
    const projList =
      projectId === ALL_PROJECTS ? projects : projects.filter((p) => p.id === projectId);

    const reportsP = Promise.allSettled([
      reportsApi.get("open-tickets", scope),
      reportsApi.get("by-status", scope),
      reportsApi.get("by-priority", scope),
      reportsApi.get("by-group", scope),
      reportsApi.get("sla-compliance", scope),
      reportsApi.get("agent-performance", { ...scope, date_from: since }),
      reportsApi.get("volume-trends", { ...scope, days: trendDays }),
      reportsApi.get("resolution-trends", { ...scope, days: trendDays }),
    ]);
    const KEYS = [
      "open-tickets",
      "by-status",
      "by-priority",
      "by-group",
      "sla-compliance",
      "agent-performance",
      "volume-trends",
      "resolution-trends",
    ];
    const ticketsP = Promise.all(projList.map((p) => ticketsApi.list({ project: p.id })))
      .then((lists) => lists.flat())
      .catch(() => [] as TicketListItem[]);

    Promise.all([reportsP, ticketsP])
      .then(([results, ticketList]) => {
        if (cancelled) return;
        const next: Record<string, unknown> = {};
        results.forEach((r, i) => {
          if (r.status === "fulfilled") next[KEYS[i]] = r.value.data;
        });
        setData(next);
        setTickets(ticketList);
      })
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [helpdesk?.id, scope, projects, projectId, period.days]);

  // ── derived views ─────────────────────────────────────────────────────────
  const openTickets = asObj(data["open-tickets"]);
  const byStatus = asRows(data["by-status"]);
  const byPriorityRaw = asRows(data["by-priority"]);
  const byGroup = asRows(data["by-group"]);
  const sla = asObj(data["sla-compliance"]);
  const agents = asRows(data["agent-performance"]);
  const volume = asRows(data["volume-trends"]);
  const resolution = asRows(data["resolution-trends"]);

  const openTotal = Number(openTickets.total ?? 0);
  const slaPct = sla.compliance_pct == null ? null : Number(sla.compliance_pct);

  // Split the 2×-window trend into current vs previous to compute deltas.
  const boundary = format(subDays(new Date(), period.days), "yyyy-MM-dd");
  const split = (rows: ReportRow[]) => {
    let curr = 0;
    let prev = 0;
    const currRows: ReportRow[] = [];
    rows.forEach((r) => {
      const d = String(r.date ?? "");
      if (d > boundary) {
        curr += valueOf(r);
        currRows.push(r);
      } else {
        prev += valueOf(r);
      }
    });
    return { curr, prev, currRows };
  };
  const created = split(volume);
  const resolved = split(resolution);
  const net = created.curr - resolved.curr;

  // Weighted average resolution time across agents (MTTR proxy).
  const mttr = useMemo(() => {
    let hours = 0;
    let n = 0;
    agents.forEach((a) => {
      const h = a.avg_resolution_hours;
      const c = Number(a.resolved_count ?? 0);
      if (typeof h === "number" && c > 0) {
        hours += h * c;
        n += c;
      }
    });
    const totalResolved = agents.reduce((s, a) => s + Number(a.resolved_count ?? 0), 0);
    return { avg: n > 0 ? hours / n : null, totalResolved };
  }, [agents]);

  // Priority breakdown in fixed order, with colours + capitalised labels.
  const priorityRows = useMemo(() => {
    const by = new Map(byPriorityRaw.map((r) => [String(r.label), valueOf(r)]));
    return PRIORITY_ORDER.filter((p) => by.has(p)).map((p) => ({
      label: p,
      value: by.get(p) ?? 0,
      color: PRIORITY_COLOR[p],
    }));
  }, [byPriorityRaw]);

  // Open count per project for the project cards.
  const openByProject = useMemo(() => {
    const m = new Map<string, number>();
    asRows(openTickets.by_project).forEach((r) => m.set(String(r.project__key ?? ""), Number(r.n ?? 0)));
    return m;
  }, [openTickets]);

  // "Needs attention" — derived from the live ticket list.
  const attention = useMemo(() => {
    const now = Date.now();
    const open = tickets.filter((t) => t.status_category !== "done");
    const isBreached = (t: TicketListItem) =>
      !!(t.sla?.resolution?.breached || t.sla?.first_response?.breached);
    return {
      unassigned: open.filter((t) => !t.assignee).length,
      overdue: open.filter((t) => t.due_date && new Date(t.due_date).getTime() < now).length,
      breached: open.filter(isBreached).length,
      atRisk: open.filter(
        (t) =>
          !isBreached(t) &&
          (t.sla?.resolution?.rag === "amber" || t.sla?.first_response?.rag === "amber"),
      ).length,
    };
  }, [tickets]);

  const busy = wsLoading || loading;
  const reportsHref = `/t/${org}/agent/w/${helpdeskKey}/reports`;

  return (
    <div className="space-y-6">
      {/* Header + filters */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Dashboard</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {helpdesk ? `Live overview for ${helpdesk.name}.` : "Live workspace overview."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={periodKey} onValueChange={setPeriodKey}>
            <SelectTrigger className="w-[150px]" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.key} value={p.key}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-[170px]" aria-label="Project">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Link
            href={reportsHref}
            className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Reports <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {busy ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading dashboard…
        </div>
      ) : (
        <>
          {/* Hero KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Open tickets"
              value={openTotal}
              icon={<Inbox className="h-4 w-4" />}
              accent="text-primary"
              sub={
                net === 0 ? (
                  <span>Balanced this period</span>
                ) : net > 0 ? (
                  <span className="text-destructive">▲ {net} net opened · {period.label.toLowerCase()}</span>
                ) : (
                  <span className="text-success">▼ {Math.abs(net)} net cleared · {period.label.toLowerCase()}</span>
                )
              }
            />
            <KpiCard
              label="Created"
              value={created.curr}
              icon={<TicketIcon className="h-4 w-4" />}
              delta={pctChange(created.curr, created.prev)}
              deltaDir="neutral"
              spark={created.currRows.map(valueOf)}
              sparkColor="hsl(var(--chart-1))"
              sub={`vs ${created.prev} previous`}
            />
            <KpiCard
              label="Resolved"
              value={resolved.curr}
              icon={<CheckCircle2 className="h-4 w-4" />}
              accent="text-success"
              delta={pctChange(resolved.curr, resolved.prev)}
              deltaDir="up-good"
              spark={resolved.currRows.map(valueOf)}
              sparkColor="hsl(var(--chart-2))"
              sub={`vs ${resolved.prev} previous`}
            />
            <KpiCard
              label="Avg resolution"
              value={fmtHours(mttr.avg)}
              icon={<Timer className="h-4 w-4" />}
              sub={`${mttr.totalResolved} resolved · ${period.label.toLowerCase()}`}
            />
          </div>

          {/* Centerpiece: trend + SLA gauge */}
          <div className="grid gap-4 lg:grid-cols-3">
            <ReportCard title="Created vs resolved" hint={period.label.toLowerCase()} className="lg:col-span-2">
              <DualTrendChart
                seriesA={{ label: "Created", rows: created.currRows, color: "hsl(var(--chart-1))" }}
                seriesB={{ label: "Resolved", rows: resolved.currRows, color: "hsl(var(--chart-2))" }}
              />
            </ReportCard>
            <ReportCard title="SLA compliance">
              <div className="flex h-full flex-col items-center justify-center py-2">
                <GaugeChart
                  value={slaPct}
                  sub={
                    sla.total
                      ? `${sla.met} met · ${sla.breached} breached`
                      : "No SLA data yet"
                  }
                />
              </div>
            </ReportCard>
          </div>

          {/* Needs attention */}
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <TrendingUp className="h-4 w-4 text-muted-foreground" /> Needs attention
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <AlertTile label="Unassigned (open)" value={attention.unassigned} tone="info" icon={<UserX className="h-5 w-5" />} />
              <AlertTile label="Overdue (past due date)" value={attention.overdue} tone="warning" icon={<AlarmClock className="h-5 w-5" />} />
              <AlertTile label="SLA at risk" value={attention.atRisk} tone="warning" icon={<Timer className="h-5 w-5" />} />
              <AlertTile label="SLA breached (open)" value={attention.breached} tone="danger" icon={<ShieldAlert className="h-5 w-5" />} />
            </div>
          </div>

          {/* Distributions */}
          <div className="grid gap-4 lg:grid-cols-3">
            <ReportCard title="Tickets by status" className="lg:col-span-1">
              <DonutChart rows={byStatus} centerLabel="tickets" />
            </ReportCard>
            <ReportCard title="Tickets by priority">
              <BarList rows={priorityRows} capitalize />
            </ReportCard>
            <ReportCard title="Tickets by team">
              <BarList rows={byGroup} />
            </ReportCard>
          </div>

          {/* Leaderboard + projects */}
          <div className="grid gap-4 lg:grid-cols-3">
            <ReportCard title="Agent leaderboard" hint="resolved in period" className="lg:col-span-2">
              <MiniTable
                columns={[
                  { key: "agent", header: "Agent" },
                  { key: "resolved_count", header: "Resolved", align: "right" },
                  { key: "open_count", header: "Open", align: "right" },
                  {
                    key: "avg_resolution_hours",
                    header: "Avg resolution",
                    align: "right",
                    fmt: (v) => fmtHours(typeof v === "number" ? v : null),
                  },
                ]}
                rows={agents.slice(0, 8)}
              />
            </ReportCard>
            <ReportCard title="Projects">
              <ul className="space-y-2">
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/t/${org}/agent/w/${helpdeskKey}/p/${p.key}`}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 truncate font-medium">{p.name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
                          {openByProject.get(p.key) ?? 0} open
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">{p.key}</span>
                      </span>
                    </Link>
                  </li>
                ))}
                {projects.length === 0 ? (
                  <li className="py-4 text-center text-sm text-muted-foreground">No projects yet.</li>
                ) : null}
              </ul>
            </ReportCard>
          </div>
        </>
      )}
    </div>
  );
}
