"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileDown, FileSpreadsheet, Loader2, Play } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import {
  ALL_PROJECTS,
  buildRangeScope,
  currentMonthRange,
  MAX_RANGE_MONTHS,
  maxToDate,
  rangeError,
  REPORT_DEFS,
} from "@/components/reports/catalog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { reportsApi } from "@/lib/itsm/api";

type RowState = { projectId: string; from: string; to: string };
type Busy = { key: string; fmt: "xlsx" | "csv" } | null;

/** Reports console — one report per row, "traditional" tabular format. Each row
 * carries its own Project (all by default) + From–To range (default: current
 * month), a Download menu (Excel / CSV), and a Generate Report action that opens
 * the report on screen. Range is capped at 6 months (download a year in parts). */
export default function ReportsCatalogPage() {
  const router = useRouter();
  const { org, helpdeskKey, helpdesk, projects } = useWorkspace();

  const base = `/t/${org}/agent/w/${helpdeskKey}`;
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      REPORT_DEFS.map((d) => [d.key, { projectId: ALL_PROJECTS, ...currentMonthRange() }]),
    ),
  );
  const [downloading, setDownloading] = useState<Busy>(null);
  const [exportingAll, setExportingAll] = useState(false);

  const setRow = useCallback((key: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const onDownload = useCallback(
    async (key: string, fmt: "xlsx" | "csv") => {
      if (!helpdesk?.id) return;
      const r = rows[key];
      const err = rangeError(r.from, r.to);
      if (err) {
        toast.error(err);
        return;
      }
      setDownloading({ key, fmt });
      try {
        await reportsApi.exportOne(key, fmt, buildRangeScope(helpdesk.id, r.projectId, r.from, r.to));
      } catch {
        toast.error(`Export to ${fmt === "xlsx" ? "Excel" : "CSV"} failed.`);
      } finally {
        setDownloading(null);
      }
    },
    [helpdesk?.id, rows],
  );

  const onGenerate = useCallback(
    (key: string) => {
      const r = rows[key];
      const err = rangeError(r.from, r.to);
      if (err) {
        toast.error(err);
        return;
      }
      const q = new URLSearchParams({ project: r.projectId, from: r.from, to: r.to });
      router.push(`${base}/reports/${key}?${q.toString()}`);
    },
    [rows, router, base],
  );

  // "Export all" combines the standard pack into one workbook. It uses all
  // projects + the current month as a fixed snapshot scope.
  const exportAllRange = useMemo(() => currentMonthRange(), []);
  const onExportAll = useCallback(async () => {
    if (!helpdesk?.id) return;
    setExportingAll(true);
    try {
      await reportsApi.exportAll(
        buildRangeScope(helpdesk.id, ALL_PROJECTS, exportAllRange.from, exportAllRange.to),
      );
    } catch {
      toast.error("Export failed.");
    } finally {
      setExportingAll(false);
    }
  }, [helpdesk?.id, exportAllRange]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Reports</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Standard reports for {helpdesk ? helpdesk.name : "this workspace"}. Pick a project and
            date range on each row, then generate it on screen or download it. Maximum range is{" "}
            {MAX_RANGE_MONTHS} months — for a full year, download in two parts.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onExportAll}
          disabled={exportingAll || !helpdesk?.id}
          title="All reports in one Excel workbook · all projects · current month"
        >
          {exportingAll ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
          Export all (Excel)
        </Button>
      </div>

      <div className="rounded-xl border bg-card text-card-foreground shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[260px]">Report</TableHead>
              <TableHead className="w-[180px]">Project</TableHead>
              <TableHead className="w-[300px]">Date range</TableHead>
              <TableHead className="w-[220px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {REPORT_DEFS.map((def) => {
              const r = rows[def.key];
              const err = rangeError(r.from, r.to);
              const isDownloading = downloading?.key === def.key;
              const disabled = !!err || !helpdesk?.id;
              return (
                <TableRow key={def.key} className="align-top">
                  <TableCell className="py-3">
                    <p className="font-medium">{def.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{def.context}</p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground/70">
                      {def.category}
                    </p>
                  </TableCell>

                  <TableCell className="py-3">
                    <Select
                      value={r.projectId}
                      onValueChange={(v) => setRow(def.key, { projectId: v })}
                    >
                      <SelectTrigger className="w-[160px]" aria-label={`Project for ${def.title}`}>
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
                  </TableCell>

                  <TableCell className="py-3">
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="date"
                        aria-label={`From date for ${def.title}`}
                        value={r.from}
                        max={r.to || undefined}
                        onChange={(e) => setRow(def.key, { from: e.target.value })}
                        className="w-[140px]"
                      />
                      <span className="text-sm text-muted-foreground">to</span>
                      <Input
                        type="date"
                        aria-label={`To date for ${def.title}`}
                        value={r.to}
                        min={r.from || undefined}
                        max={maxToDate(r.from) || undefined}
                        onChange={(e) => setRow(def.key, { to: e.target.value })}
                        className="w-[140px]"
                      />
                    </div>
                    {err ? <p className="mt-1 text-xs text-destructive">{err}</p> : null}
                  </TableCell>

                  <TableCell className="py-3">
                    <div className="flex items-center justify-end gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" disabled={disabled || isDownloading}>
                            {isDownloading ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Download />
                            )}
                            Download
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onDownload(def.key, "xlsx")}>
                            <FileSpreadsheet className="text-muted-foreground" />
                            Excel (.xlsx)
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onDownload(def.key, "csv")}>
                            <FileDown className="text-muted-foreground" />
                            CSV (.csv)
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button size="sm" onClick={() => onGenerate(def.key)} disabled={disabled}>
                        <Play />
                        Generate Report
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
