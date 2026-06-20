"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, BarChart3, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { reportsApi, projectsApi } from "@/lib/itsm/api";
import type { Project } from "@/lib/itsm/types";
import { ItsmApiError } from "@/lib/itsm/client";
import { BarChart, GaugePct, KpiCard, PieChart, TrendChart, type Series } from "@/components/itsm/charts";

// ---- report shapes --------------------------------------------------------

type LabelValue = { label: string; value: number };
type ByStatusRow = { label: string; color: string | null; category: string; value: number };
type OpenTickets = { total: number; by_project: { project__key: string; n: number }[] };
type AgentRow = { agent: string; resolved_count: number; open_count: number; avg_resolution_hours: number | null };
type Sla = { total: number; met: number; breached: number; compliance_pct: number | null };
type TrendPoint = { date: string; value: number };

type ReportData =
  | LabelValue[]
  | ByStatusRow[]
  | OpenTickets
  | AgentRow[]
  | Sla
  | TrendPoint[];

type ReportResponse = { report: string; data: ReportData };

const TREND_REPORTS = new Set(["resolution-trends", "volume-trends"]);

const TITLES: Record<string, string> = {
  "open-tickets": "Open Tickets",
  "by-status": "By Status",
  "by-priority": "By Priority",
  "by-group": "By Group",
  "agent-performance": "Agent Performance",
  "sla-compliance": "SLA Compliance",
  "resolution-trends": "Resolution Trends",
  "volume-trends": "Volume Trends",
};

// ---- CSV ------------------------------------------------------------------

function toCsv(rows: (string | number | null)[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = cell == null ? "" : String(cell);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}

function buildCsvRows(name: string, data: ReportData): (string | number | null)[][] {
  if (name === "open-tickets") {
    const d = data as OpenTickets;
    return [["project", "open"], ...d.by_project.map((r) => [r.project__key, r.n])];
  }
  if (name === "sla-compliance") {
    const d = data as Sla;
    return [
      ["metric", "value"],
      ["total", d.total],
      ["met", d.met],
      ["breached", d.breached],
      ["compliance_pct", d.compliance_pct ?? ""],
    ];
  }
  if (name === "agent-performance") {
    const d = data as AgentRow[];
    return [
      ["agent", "resolved_count", "open_count", "avg_resolution_hours"],
      ...d.map((r) => [r.agent, r.resolved_count, r.open_count, r.avg_resolution_hours]),
    ];
  }
  if (TREND_REPORTS.has(name)) {
    const d = data as TrendPoint[];
    return [["date", "value"], ...d.map((r) => [r.date, r.value])];
  }
  // label/value style (by-status, by-priority, by-group)
  const d = data as LabelValue[];
  return [["label", "value"], ...d.map((r) => [r.label, r.value])];
}

function downloadCsv(name: string, data: ReportData) {
  const csv = toCsv(buildCsvRows(name, data));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- page -----------------------------------------------------------------

export default function ReportViewerPage() {
  const params = useParams<{ name: string }>();
  const name = params.name;
  const isTrend = TREND_REPORTS.has(name);

  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<string>("__all__");
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    projectsApi
      .list()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const queryParams: Record<string, unknown> = {};
    if (project !== "__all__") queryParams.project = project;
    if (isTrend) queryParams.days = days;
    reportsApi
      .get<ReportResponse>(name, queryParams)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ItsmApiError ? e.message : "Failed to load report");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name, project, days, isTrend]);

  return (
    <div className="space-y-4">
      <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to reports
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-indigo-500" />
          <h1 className="text-xl font-semibold">{TITLES[name] ?? name}</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!data}
          onClick={() => {
            if (data) downloadCsv(name, data);
          }}
        >
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      {/* filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-3">
        <div className="space-y-1">
          <Label className="text-xs">Project</Label>
          <Select value={project} onValueChange={setProject}>
            <SelectTrigger className="h-8 w-48">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isTrend && (
          <div className="space-y-1">
            <Label className="text-xs">Days</Label>
            <Input
              type="number"
              min={1}
              className="h-8 w-28"
              value={String(days)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n) && n > 0) setDays(n);
              }}
            />
          </div>
        )}
      </div>

      {/* body */}
      <div className="rounded-lg border bg-white p-4">
        {loading ? (
          <div className="grid min-h-[200px] place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="grid min-h-[200px] place-items-center gap-1 text-center text-sm text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        ) : data ? (
          <ReportBody name={name} data={data} />
        ) : (
          <div className="grid min-h-[200px] place-items-center text-sm text-muted-foreground">No data</div>
        )}
      </div>
    </div>
  );
}

// ---- per-report rendering -------------------------------------------------

function ReportBody({ name, data }: { name: string; data: ReportData }) {
  switch (name) {
    case "open-tickets": {
      const d = data as OpenTickets;
      const series: Series = d.by_project.map((r) => ({ label: r.project__key, value: r.n }));
      return (
        <div className="space-y-4">
          <div className="max-w-xs">
            <KpiCard value={d.total} label="Open tickets" accent="#6366f1" />
          </div>
          <div>
            <div className="mb-2 text-sm font-medium text-muted-foreground">By project</div>
            <BarChart data={series} />
          </div>
        </div>
      );
    }

    case "by-status": {
      const d = data as ByStatusRow[];
      const series: Series = d.map((r) => ({ label: r.label, value: r.value, color: r.color ?? undefined }));
      return (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-sm font-medium text-muted-foreground">Distribution</div>
            <PieChart data={series} />
          </div>
          <div>
            <div className="mb-2 text-sm font-medium text-muted-foreground">Counts</div>
            <BarChart data={series} />
          </div>
        </div>
      );
    }

    case "by-priority":
    case "by-group": {
      const d = data as LabelValue[];
      const series: Series = d.map((r) => ({ label: r.label, value: r.value }));
      return <BarChart data={series} />;
    }

    case "sla-compliance": {
      const d = data as Sla;
      return (
        <div className="flex flex-wrap items-center gap-8">
          <div className="w-48">
            <GaugePct pct={d.compliance_pct} label="SLA compliance" />
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Total</dt>
            <dd className="font-medium tabular-nums">{d.total}</dd>
            <dt className="text-muted-foreground">Met</dt>
            <dd className="font-medium tabular-nums text-emerald-600">{d.met}</dd>
            <dt className="text-muted-foreground">Breached</dt>
            <dd className="font-medium tabular-nums text-red-600">{d.breached}</dd>
          </dl>
        </div>
      );
    }

    case "agent-performance": {
      const d = data as AgentRow[];
      if (d.length === 0) {
        return <div className="grid min-h-[120px] place-items-center text-sm text-muted-foreground">No data</div>;
      }
      return (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead className="text-right">Resolved</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">Avg resolution (h)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.map((r) => (
              <TableRow key={r.agent}>
                <TableCell className="font-medium">{r.agent}</TableCell>
                <TableCell className="text-right tabular-nums">{r.resolved_count}</TableCell>
                <TableCell className="text-right tabular-nums">{r.open_count}</TableCell>
                <TableCell className="text-right tabular-nums">{r.avg_resolution_hours ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }

    case "resolution-trends":
    case "volume-trends": {
      const d = data as TrendPoint[];
      const color = name === "resolution-trends" ? "#22c55e" : "#6366f1";
      const seriesName = name === "resolution-trends" ? "Resolved" : "Created";
      return <TrendChart series={[{ name: seriesName, color, points: d }]} />;
    }

    default:
      return <div className="grid min-h-[120px] place-items-center text-sm text-muted-foreground">Unsupported report</div>;
  }
}
