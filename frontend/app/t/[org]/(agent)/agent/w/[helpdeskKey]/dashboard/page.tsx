"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  AlarmClock,
  ArrowUpRight,
  CheckCircle2,
  Inbox,
  ShieldAlert,
  Star,
  Ticket as TicketIcon,
  Timer,
  TrendingUp,
  UserX,
} from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { PageHeader } from "@/components/shell/page-header";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTile,
  BarList,
  NowTag,
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
  AGENT_REPORTS_MODULE,
  canReadModule,
  SLA_REPORTS_MODULE,
} from "@/components/reports/catalog";
import {
  DrillDownSheet,
  type DrillRow,
  type DrillState,
} from "@/components/reports/drilldown-sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { reportsApi, ticketsApi } from "@/lib/itsm/api";
import { useItsmAuth } from "@/lib/itsm/auth";
import { DASHBOARD_HELP as HELP } from "@/lib/itsm/help/dashboard";
import { serializeSpec } from "@/components/tickets/filters/filter-utils";
import { useLivePoll } from "@/lib/itsm/use-live-poll";
import type { FilterCondition, Priority, TicketListItem } from "@/lib/itsm/types";

const PERIODS = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
];
const ALL_PROJECTS = "all";
/** Max ticket rows loaded into a drill-down slide-over (the queue link opens the rest). */
const DRILL_LIMIT = 50;
/** Re-compute at least this often even when no ticket changed, so the time-based
 *  "Now" tiles (Overdue, SLA at risk / breached) and the UTC day roll-over stay current. */
const REFRESH_FLOOR_MS = 5 * 60_000;
/** Open-backlog condition reused by every "open only" drill-down. */
const OPEN_COND: FilterCondition = {
  field: "status_category",
  op: "in",
  value: ["todo", "in_progress"],
};

/** Display order + segment colours for the priority breakdown. */
const PRIORITY_ORDER: Priority[] = ["p1", "p2", "p3", "p4"];
const PRIORITY_COLOR: Record<Priority, string> = {
  p1: "hsl(var(--destructive))",
  p2: "hsl(var(--warning))",
  p3: "hsl(var(--chart-6))", // matches the sky P3 badge, not brand pink
  p4: "hsl(var(--muted-foreground))",
};

const asRows = (d: unknown): ReportRow[] => (Array.isArray(d) ? (d as ReportRow[]) : []);
const asObj = (d: unknown): ReportRow =>
  d && typeof d === "object" && !Array.isArray(d) ? (d as ReportRow) : {};

/** Business-hours label: "45m" / "3.5h" / "26h". Never days — a business day isn't 24h. */
function fmtBizHours(h: number | null): string {
  if (h == null || !Number.isFinite(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 10) return `${h.toFixed(1)}h`;
  return `${Math.round(h)}h`;
}

const fmtPct = (v: unknown): string => (v == null ? "—" : `${v}%`);

/** ISO timestamp for `days` ago — used to build created-date drill windows. */
const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/** The UTC calendar day `offset` days before today, as YYYY-MM-DD. The backend
 *  buckets every report by UTC day (settings.TIME_ZONE = UTC), so the period split,
 *  the `date_from` sent to each report and the drill filters all use this one basis
 *  — never the browser's local date (which disagreed near midnight). */
const utcDay = (offset = 0) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

/** The selected period as UTC days: `start` = first day (N days incl. today),
 *  `prevStart` = first day of the previous N days, `boundary` = the day before
 *  `start` (for "after" drill filters), `dates` = every day of the period. */
type PeriodWindow = { start: string; prevStart: string; boundary: string; dates: string[] };
function periodWindow(days: number): PeriodWindow {
  return {
    start: utcDay(days - 1),
    prevStart: utcDay(days * 2 - 1),
    boundary: utcDay(days),
    dates: Array.from({ length: days }, (_, i) => utcDay(days - 1 - i)),
  };
}


/** Normalize a queue ticket row → a drill-down line (+ its detail deep link). */
function ticketToDrillRow(t: TicketListItem, org: string, helpdeskKey: string): DrillRow {
  return {
    id: t.id,
    ticketNumber: t.ticket_number,
    href: `/t/${org}/agent/w/${helpdeskKey}/p/${t.project_key}/${t.ticket_number}`,
    summary: t.summary,
    priority: t.priority,
    statusName: t.status_name,
    statusCategory: t.status_category,
    statusColor: t.status_color,
    assignee: t.assignee ? t.assignee.full_name || t.assignee.username : "",
    dueDate: t.due_date,
  };
}

/** Normalize an SLA drill-down report row → a drill-down line. */
function reportRowToDrillRow(r: ReportRow, org: string, helpdeskKey: string): DrillRow {
  const num = String(r.ticket_number ?? "");
  const key = String(r.project_key ?? "");
  return {
    id: num || key,
    ticketNumber: num,
    href: `/t/${org}/agent/w/${helpdeskKey}/p/${key}/${num}`,
    summary: String(r.summary ?? ""),
    priority: (r.priority as Priority) ?? null,
    statusName: r.status ? String(r.status) : null,
    assignee: r.assignee ? String(r.assignee) : "",
    dueDate: r.due_date ? String(r.due_date) : null,
  };
}

const CLOSED_DRILL: DrillState = {
  open: false,
  title: "",
  loading: false,
  error: false,
  rows: [],
  total: 0,
};

/** A drill-down request the dashboard resolves into ticket rows for the slide-over. */
type DrillIntent = {
  title: string;
  subtitle?: string;
  source:
    | { kind: "tickets"; conditions: FilterCondition[] }
    | { kind: "report"; report: string };
  queueHref?: string;
  queueLabel?: string;
  /** True match count when it's known independently of the (capped) report list —
   *  e.g. the accurate `attention-summary` count behind the SLA tiles, which the
   *  list reports cap at 500. Keeps the sheet header ("of N") equal to the tile. */
  knownTotal?: number;
};

export default function WorkspaceDashboard() {
  const { org, helpdeskKey, helpdesk, projects, loading: wsLoading } = useWorkspace();
  const { user, hasPerm } = useItsmAuth();
  const [periodKey, setPeriodKey] = useState("30");
  const [projectId, setProjectId] = useState(ALL_PROJECTS);
  const [data, setData] = useState<Record<string, unknown>>({});
  // The UTC window the current `data` was fetched for (kept with it so the split /
  // drills always match the numbers on screen, even across a UTC midnight).
  const [win, setWin] = useState<PeriodWindow>(() => periodWindow(30));
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<DrillState>(CLOSED_DRILL);

  const period = PERIODS.find((p) => p.key === periodKey) ?? PERIODS[1];
  // SLA / agent reports are gated by their own modules (403 otherwise) — hide those
  // tiles instead of rendering empty ones.
  const perms = user?.permissions as Record<string, { read?: boolean }> | undefined;
  const canSla = canReadModule(perms, hasPerm, SLA_REPORTS_MODULE);
  const canAgent = canReadModule(perms, hasPerm, AGENT_REPORTS_MODULE);

  // Point-in-time scope (no date filter → live current state).
  const scope = useMemo(
    () => ({
      helpdesk: helpdesk?.id,
      project: projectId === ALL_PROJECTS ? undefined : projectId,
    }),
    [helpdesk?.id, projectId],
  );

  // ── load all KPI/report data ────────────────────────────────────────────────
  // `silent` (a background live-refresh) swaps the numbers in place without the
  // loading skeleton; a monotonic seq drops a slow fetch superseded by a newer one.
  const fetchSeq = useRef(0);
  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!helpdesk?.id) return;
      const seq = ++fetchSeq.current;
      if (!silent) setLoading(true);

      // History tiles follow the Period (UTC days, from `start`); "Now" tiles get no
      // date filter (live). The trends start at `prevStart` so the previous period can
      // be split off for the % deltas.
      const w = periodWindow(period.days);
      const hist = { ...scope, date_from: w.start };
      const req: [string, Record<string, unknown>][] = [
        ["open-tickets", scope],
        ["attention-summary", scope],
        ["backlog-aging", scope],
        ["by-status", hist],
        ["by-priority", hist],
        ["by-group", hist],
        ["by-source", hist],
        ["resolution-time-by-priority", hist],
        ["csat-summary", hist],
        ["volume-trends", { ...scope, date_from: w.prevStart }],
        ["resolution-trends", { ...scope, date_from: w.prevStart }],
      ];
      if (canSla) req.push(["sla-compliance", hist]);
      if (canAgent) req.push(["agent-performance", hist]);

      try {
        const results = await Promise.allSettled(req.map(([k, p]) => reportsApi.get(k, p)));
        if (seq !== fetchSeq.current) return;
        const next: Record<string, unknown> = {};
        results.forEach((r, i) => {
          if (r.status === "fulfilled") next[req[i][0]] = r.value.data;
        });
        setData(next);
        setWin(w);
        setUpdatedAt(new Date());
      } finally {
        if (seq === fetchSeq.current && !silent) setLoading(false);
      }
    },
    [helpdesk?.id, scope, period.days, canSla, canAgent],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Silent live refresh — poll the cheap, scope-matched pulse token; on any ticket
  // change in this helpdesk/project, re-compute the KPIs in place (no skeleton).
  useLivePoll({
    enabled: !!helpdesk?.id,
    key: `${helpdesk?.id ?? ""}|${projectId}|${period.days}`,
    // The ticket change token, plus a 5-minute bucket: time alone moves the "Now"
    // tiles (a ticket becomes overdue / at risk without being edited), so the
    // numbers re-compute at least every REFRESH_FLOOR_MS even when nothing changed.
    pulse: async () =>
      `${(await ticketsApi.pulse({ helpdesk: helpdesk?.id, project: scope.project })).version}|${Math.floor(Date.now() / REFRESH_FLOOR_MS)}`,
    onChange: () => load({ silent: true }),
  });

  // ── derived views ─────────────────────────────────────────────────────────
  const openTickets = asObj(data["open-tickets"]);
  const attention = asObj(data["attention-summary"]);
  const byStatus = asRows(data["by-status"]);
  const byPriorityRaw = asRows(data["by-priority"]);
  const byGroup = asRows(data["by-group"]);
  const bySource = asRows(data["by-source"]);
  const backlog = asRows(data["backlog-aging"]);
  const sla = asObj(data["sla-compliance"]);
  const agents = asRows(data["agent-performance"]);
  const resolutionByPriority = asRows(data["resolution-time-by-priority"]);
  const volume = asRows(data["volume-trends"]);
  const resolution = asRows(data["resolution-trends"]);
  const csat = asObj(data["csat-summary"]);
  const csatPct = csat.csat_pct == null ? null : Number(csat.csat_pct);
  const csatResponses = Number(csat.responses ?? 0);

  const openTotal = Number(openTickets.total ?? attention.open_total ?? 0);
  const slaPct = sla.compliance_pct == null ? null : Number(sla.compliance_pct);
  const slaByMetric = asRows(sla.by_metric);

  // Split the trend (fetched from the previous period's first UTC day) into the
  // current N days vs the N days before, for the deltas. Current-period rows are
  // zero-filled over every day so the chart / sparkline span the whole period.
  const { boundary } = win;
  const split = (rows: ReportRow[]) => {
    const by = new Map(rows.map((r) => [String(r.date ?? ""), valueOf(r)]));
    let curr = 0;
    let prev = 0;
    by.forEach((v, d) => {
      if (d >= win.start) curr += v;
      else if (d >= win.prevStart) prev += v;
    });
    const currRows: ReportRow[] = win.dates.map((d) => ({ date: d, value: by.get(d) ?? 0 }));
    return { curr, prev, currRows };
  };
  const created = split(volume);
  const resolved = split(resolution);
  const net = created.curr - resolved.curr;

  // Avg resolution = weighted average of the per-priority business-hours averages —
  // every ticket resolved in the period (assigned or not), so the count equals Resolved.
  const mttr = useMemo(() => {
    let hours = 0;
    let n = 0;
    resolutionByPriority.forEach((r) => {
      const h = r.avg_hours;
      const c = Number(r.resolved_count ?? 0);
      if (typeof h === "number" && c > 0) {
        hours += h * c;
        n += c;
      }
    });
    return { avg: n > 0 ? hours / n : null, totalResolved: n };
  }, [resolutionByPriority]);

  /** Drill conditions for the period-scoped distribution charts: the slice's own
   *  condition + "created in the period", so the panel count equals the segment. */
  const inPeriod = (c: FilterCondition): FilterCondition[] => [
    c,
    { field: "created_at", op: "after", value: boundary },
  ];

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

  // Attention tile counts (server-side, accurate over the whole scoped backlog).
  const att = {
    unassigned: Number(attention.unassigned ?? 0),
    overdue: Number(attention.overdue ?? 0),
    atRisk: Number(attention.sla_at_risk ?? 0),
    breached: Number(attention.sla_breached ?? 0),
    slaPartial: attention.sla_partial === true,
  };

  // ── drill-down: click a chart/tile → load the matching tickets in a slide-over ─
  const wbase = `/t/${org}/agent/w/${helpdeskKey}`;
  const currentProjectKey =
    projectId === ALL_PROJECTS ? null : projects.find((p) => p.id === projectId)?.key ?? null;
  const queueBase = currentProjectKey ? `${wbase}/p/${currentProjectKey}` : `${wbase}/all`;
  const listScope = useMemo(
    () => (projectId === ALL_PROJECTS ? { helpdesk: helpdesk?.id } : { project: projectId }),
    [projectId, helpdesk?.id],
  );

  const queueUrl = useCallback(
    (conditions: FilterCondition[], viewKey?: string) => {
      // The queue hydrates its active filter from ?q only (see ticket-queue.tsx);
      // ?view is just the display label. So ALWAYS emit ?q (the real filter) and add
      // ?view alongside it when a matching system view exists (nicer chip label).
      const params = new URLSearchParams();
      const s = serializeSpec(conditions, "all");
      if (s) params.set("q", s);
      if (viewKey) params.set("view", viewKey);
      const qs = params.toString();
      return qs ? `${queueBase}?${qs}` : queueBase;
    },
    [queueBase],
  );

  const drillSeq = useRef(0);
  const openDrill = useCallback(
    async (intent: DrillIntent) => {
      const seq = ++drillSeq.current;
      setDrill({
        open: true,
        title: intent.title,
        subtitle: intent.subtitle,
        loading: true,
        error: false,
        rows: [],
        total: 0,
        queueHref: intent.queueHref,
        queueLabel: intent.queueLabel,
      });
      try {
        let rows: DrillRow[] = [];
        let total = 0;
        if (intent.source.kind === "tickets") {
          const q = serializeSpec(intent.source.conditions, "all");
          const paged = await ticketsApi.listPaged({ ...listScope, q, page_size: DRILL_LIMIT });
          rows = paged.results.map((t) => ticketToDrillRow(t, org, helpdeskKey));
          total = paged.count;
        } else {
          const res = await reportsApi.get(intent.source.report, scope);
          const rr = asRows(res.data);
          rows = rr.slice(0, DRILL_LIMIT).map((r) => reportRowToDrillRow(r, org, helpdeskKey));
          // Prefer the tile's accurate count — the SLA list reports cap at 500.
          total = intent.knownTotal ?? rr.length;
        }
        if (seq !== drillSeq.current) return;
        setDrill((d) => ({ ...d, loading: false, rows, total }));
      } catch {
        if (seq !== drillSeq.current) return;
        setDrill((d) => ({ ...d, loading: false, error: true }));
      }
    },
    [listScope, scope, org, helpdeskKey],
  );
  const closeDrill = useCallback(() => setDrill((d) => ({ ...d, open: false })), []);

  // Intent builders (share the queue-link + open-only semantics).
  const drillTickets = (
    title: string,
    conditions: FilterCondition[],
    opts: { viewKey?: string; subtitle?: string } = {},
  ) =>
    openDrill({
      title,
      subtitle: opts.subtitle,
      source: { kind: "tickets", conditions },
      queueHref: queueUrl(conditions, opts.viewKey),
      queueLabel: "Open in queue",
    });

  const busy = wsLoading || loading;
  const reportsHref = `${wbase}/reports`;
  const periodLc = period.label.toLowerCase();

  return (
    <div className="space-y-6 compact:space-y-4">
      {/* Header + filters. No subtitle — "Live overview for <helpdesk>" only repeated
          the helpdesk name the sidebar already shows. */}
      <PageHeader
        title="Dashboard"
        actions={
          // Own wrapping row so the controls wrap on a phone instead of overflowing.
          <div className="flex flex-wrap items-center justify-end gap-2">
            {updatedAt ? (
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                Updated {format(updatedAt, "HH:mm")}
                <InfoTip label="About Updated">{HELP.lastUpdated}</InfoTip>
              </span>
            ) : null}
            <Select value={periodKey} onValueChange={setPeriodKey}>
              <Hint label={HELP.period} side="bottom">
                <SelectTrigger className="w-[150px]" aria-label="Period">
                  <SelectValue />
                </SelectTrigger>
              </Hint>
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
              className="inline-flex h-[var(--ctl-h)] items-center gap-1 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Reports <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        }
      />

      {busy ? (
        <div className="space-y-6 compact:space-y-4">
          {/* Mirrors the loaded grid (5 KPI tiles) so the page doesn't jump on load. */}
          <div className="grid gap-4 compact:gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[9.75rem] rounded-xl compact:h-32" />
            ))}
          </div>
          <div className="grid gap-4 compact:gap-3 lg:grid-cols-3">
            <Skeleton className="h-72 rounded-xl lg:col-span-2" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
          <div className="grid gap-4 compact:gap-3 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Hero KPIs — the count tiles drill into their ticket list. */}
          <div className="grid gap-4 compact:gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <KpiCard
              label="Open tickets"
              value={openTotal}
              icon={<Inbox className="h-4 w-4" />}
              accent="text-primary"
              help={HELP.open}
              tag={<NowTag />}
              onClick={() => drillTickets("Open tickets", [OPEN_COND], { viewKey: "open" })}
              sub={
                net === 0 ? (
                  <span>Balanced this period</span>
                ) : net > 0 ? (
                  <span className="text-destructive">▲ {net} net opened · {periodLc}</span>
                ) : (
                  <span className="text-success">▼ {Math.abs(net)} net cleared · {periodLc}</span>
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
              help={HELP.created}
              onClick={() =>
                drillTickets("Created", [{ field: "created_at", op: "after", value: boundary }], {
                  subtitle: periodLc,
                })
              }
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
              help={HELP.resolved}
              onClick={() =>
                drillTickets("Resolved", [{ field: "resolved_at", op: "after", value: boundary }], {
                  subtitle: periodLc,
                })
              }
              sub={`vs ${resolved.prev} previous`}
            />
            <KpiCard
              label="Avg resolution"
              value={fmtBizHours(mttr.avg)}
              icon={<Timer className="h-4 w-4" />}
              help={HELP.avgResolution}
              sub={`${mttr.totalResolved} resolved · business hrs`}
            />
            <KpiCard
              label="CSAT"
              value={csatPct == null ? "—" : `${csatPct}%`}
              icon={<Star className="h-4 w-4" />}
              accent="text-amber-500"
              help={HELP.csat}
              sub={
                csatResponses > 0
                  ? `${csatResponses} response${csatResponses === 1 ? "" : "s"} · ${periodLc}`
                  : `No responses · ${periodLc}`
              }
            />
          </div>

          {/* Centerpiece: trend + SLA gauge */}
          <div className="grid gap-4 compact:gap-3 lg:grid-cols-3">
            <ReportCard
              title="Created vs resolved"
              hint={`${periodLc} · UTC days`}
              help={HELP.trend}
              className={canSla ? "lg:col-span-2" : "lg:col-span-3"}
            >
              <DualTrendChart
                seriesA={{ label: "Created", rows: created.currRows, color: "hsl(var(--chart-1))" }}
                seriesB={{ label: "Resolved", rows: resolved.currRows, color: "hsl(var(--chart-2))" }}
              />
            </ReportCard>
            {canSla ? (
              <ReportCard title="SLA compliance" hint={periodLc} help={HELP.slaCompliance}>
                <div className="flex h-full flex-col items-center justify-center py-2">
                  <GaugeChart
                    value={slaPct}
                    sub={
                      <div className="space-y-0.5 text-center">
                        <div>
                          {sla.total
                            ? `${sla.met} met · ${sla.breached} breached (tickets)`
                            : "No finished SLAs in this period"}
                        </div>
                        {slaByMetric.length ? (
                          <div>
                            {slaByMetric
                              .map((m) => `${String(m.label ?? m.metric ?? "")} ${fmtPct(m.compliance_pct)}`)
                              .join(" · ")}
                          </div>
                        ) : null}
                      </div>
                    }
                  />
                </div>
              </ReportCard>
            ) : null}
          </div>

          {/* Needs attention — accurate server counts; each tile drills to its tickets. */}
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Needs attention
              <InfoTip label="About Needs attention">{HELP.needsAttention}</InfoTip>
              <NowTag />
            </h3>
            <div className={canSla ? "grid gap-3 compact:gap-2 sm:grid-cols-2 lg:grid-cols-4" : "grid gap-3 compact:gap-2 sm:grid-cols-2"}>
              <AlertTile
                label="Unassigned (open)"
                value={att.unassigned}
                tone="info"
                icon={<UserX className="h-5 w-5" />}
                help={HELP.unassigned}
                emptyHint={HELP.nothingToShow}
                onClick={() =>
                  drillTickets("Unassigned tickets", [
                    OPEN_COND,
                    { field: "assignee", op: "is_empty" },
                  ])
                }
              />
              <AlertTile
                label="Overdue (past due date)"
                value={att.overdue}
                tone="warning"
                icon={<AlarmClock className="h-5 w-5" />}
                help={HELP.overdue}
                emptyHint={HELP.nothingToShow}
                onClick={() =>
                  drillTickets("Overdue tickets", [{ field: "due_date", op: "overdue" }], {
                    viewKey: "overdue",
                  })
                }
              />
              {canSla ? (
              <>
              <AlertTile
                label="SLA at risk"
                value={att.atRisk}
                tone="warning"
                icon={<Timer className="h-5 w-5" />}
                help={HELP.slaAtRisk}
                emptyHint={HELP.nothingToShow}
                warning={att.slaPartial ? HELP.slaPartial : undefined}
                onClick={() =>
                  openDrill({
                    title: "SLA at risk",
                    subtitle: "≥75% of the SLA elapsed",
                    source: { kind: "report", report: "sla-at-risk-list" },
                    knownTotal: att.atRisk,
                  })
                }
              />
              <AlertTile
                label="SLA breached (open)"
                value={att.breached}
                tone="danger"
                icon={<ShieldAlert className="h-5 w-5" />}
                help={HELP.slaBreached}
                emptyHint={HELP.nothingToShow}
                warning={att.slaPartial ? HELP.slaPartial : undefined}
                onClick={() =>
                  openDrill({
                    title: "SLA breached (open)",
                    subtitle: "Open tickets past their SLA",
                    source: { kind: "report", report: "sla-breached-open-list" },
                    knownTotal: att.breached,
                    queueHref: `${reportsHref}/sla-breach-list`,
                    queueLabel: "View SLA breach report",
                  })
                }
              />
              </>
              ) : null}
            </div>
          </div>

          {/* Distributions — every segment drills into its tickets. */}
          <div className="grid gap-4 compact:gap-3 lg:grid-cols-3">
            <ReportCard title="Tickets by status" hint={`created · ${periodLc}`} help={HELP.byStatus}>
              <DonutChart
                rows={byStatus}
                centerLabel="tickets"
                onSlice={(r) => {
                  const id = r.status_id ? String(r.status_id) : null;
                  if (!id) return;
                  drillTickets(`Status: ${r.label ?? "—"}`, inPeriod({ field: "status", op: "eq", value: id }), {
                    subtitle: `created · ${periodLc}`,
                  });
                }}
              />
            </ReportCard>
            <ReportCard title="Tickets by priority" hint={`created · ${periodLc}`} help={HELP.byPriority}>
              <BarList
                rows={priorityRows}
                capitalize
                onBar={(r) =>
                  drillTickets(
                    `Priority: ${String(r.label).toUpperCase()}`,
                    inPeriod({ field: "priority", op: "eq", value: String(r.label) }),
                    { subtitle: `created · ${periodLc}` },
                  )
                }
              />
            </ReportCard>
            <ReportCard title="Tickets by team" hint={`created · ${periodLc}`} help={HELP.byTeam}>
              <BarList
                rows={byGroup}
                onBar={(r) => {
                  const gid = r.group_id ? String(r.group_id) : null;
                  drillTickets(
                    `Team: ${r.label ?? "Unassigned"}`,
                    inPeriod(
                      gid
                        ? { field: "assigned_group", op: "eq", value: gid }
                        : { field: "assigned_group", op: "is_empty" },
                    ),
                    { subtitle: `created · ${periodLc}` },
                  );
                }}
              />
            </ReportCard>
          </div>

          {/* Next-level widgets: backlog aging, intake source, resolution speed. */}
          <div className="grid gap-4 compact:gap-3 lg:grid-cols-3">
            <ReportCard title="Backlog aging" hint="now · open tickets by age" help={HELP.backlog}>
              <BarList
                rows={backlog}
                onBar={(r) => {
                  const lo = Number(r.lo ?? 0);
                  const hiRaw = r.hi;
                  const conditions: FilterCondition[] = [OPEN_COND];
                  if (hiRaw == null) {
                    conditions.push({ field: "created_at", op: "before", value: daysAgoIso(lo) });
                  } else {
                    conditions.push({
                      field: "created_at",
                      op: "between",
                      value: [daysAgoIso(Number(hiRaw)), daysAgoIso(lo)],
                    });
                  }
                  drillTickets(`Backlog: ${r.label ?? ""} old`, conditions);
                }}
              />
            </ReportCard>
            <ReportCard title="Tickets by source" hint={`created · ${periodLc}`} help={HELP.bySource}>
              {bySource.length > 0 ? (
                <DonutChart
                  rows={bySource.map((r) => ({ ...r, label: cap(String(r.label)) }))}
                  centerLabel="tickets"
                  onSlice={(r) =>
                    drillTickets(
                      `Source: ${cap(String(r.label))}`,
                      inPeriod({ field: "source", op: "eq", value: String(r.label).toLowerCase() }),
                      { subtitle: `created · ${periodLc}` },
                    )
                  }
                />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">No data yet.</p>
              )}
            </ReportCard>
            <ReportCard
              title="Resolution time by priority"
              hint={`resolved · ${periodLc}`}
              help={HELP.resolutionByPriority}
            >
              <MiniTable
                columns={[
                  { key: "priority", header: "Priority", fmt: (v) => String(v ?? "").toUpperCase() },
                  { key: "resolved_count", header: "Resolved", align: "right" },
                  {
                    key: "avg_hours",
                    header: "Avg",
                    align: "right",
                    fmt: (v) => fmtBizHours(typeof v === "number" ? v : null),
                  },
                  {
                    key: "max_hours",
                    header: "Max",
                    align: "right",
                    fmt: (v) => fmtBizHours(typeof v === "number" ? v : null),
                  },
                ]}
                rows={resolutionByPriority}
              />
            </ReportCard>
          </div>

          {/* Leaderboard + projects */}
          <div className="grid gap-4 compact:gap-3 lg:grid-cols-3">
            {canAgent ? (
              <ReportCard
                title="Agent leaderboard"
                hint={`resolved · ${periodLc} · open now`}
                help={HELP.leaderboard}
                className="lg:col-span-2"
              >
                <MiniTable
                  columns={[
                    { key: "agent", header: "Agent" },
                    { key: "resolved_count", header: "Resolved", align: "right" },
                    { key: "open_count", header: "Open (now)", align: "right" },
                    {
                      key: "avg_resolution_hours",
                      header: "Avg resolution",
                      align: "right",
                      help: HELP.leaderboardAvg,
                      fmt: (v) => fmtBizHours(typeof v === "number" ? v : null),
                    },
                  ]}
                  rows={agents.slice(0, 8)}
                />
              </ReportCard>
            ) : null}
            <ReportCard
              title="Projects"
              hint="open now"
              help={HELP.projects}
              className={canAgent ? undefined : "lg:col-span-3"}
            >
              <ul className="space-y-2">
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`${wbase}/p/${p.key}`}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 truncate font-medium" title={p.name}>
                        {p.name}
                      </span>
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

      <DrillDownSheet state={drill} onClose={closeDrill} />
    </div>
  );
}

/** Capitalise the first letter (source codes → display labels). */
function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
