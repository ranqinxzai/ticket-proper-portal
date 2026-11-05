"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Download, FileDown, FileSpreadsheet, Loader2, Play } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import {
  ALL_PROJECTS,
  buildRangeScope,
  canReadReport,
  currentMonthRange,
  MAX_RANGE_MONTHS,
  maxToDate,
  rangeError,
  REPORT_DEFS,
} from "@/components/reports/catalog";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
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
import { useItsmAuth } from "@/lib/itsm/auth";
import { REPORT_CATEGORY_HELP, REPORT_DATE_RANGE_HELP } from "@/lib/itsm/help/reports";

type RowState = { projectId: string; from: string; to: string };
type Busy = { key: string; fmt: "xlsx" | "csv" } | null;

/** Reports console — one report per row, "traditional" tabular format. Each row
 * carries its own Project (all by default) + From–To range (default: current
 * month), a Download menu (Excel / CSV), and a Generate Report action that opens
 * the report on screen. Range is capped at 6 months (download a year in parts). */
export default function ReportsCatalogPage() {
  const router = useRouter();
  const { org, helpdeskKey, helpdesk, projects } = useWorkspace();
  const { user, hasPerm } = useItsmAuth();
  // SLA / agent reports need their own module on top of itsm.reports — hide the rows
  // a role can't run instead of offering a 403.
  const defs = useMemo(
    () =>
      REPORT_DEFS.filter((d) =>
        canReadReport(d, user?.permissions as Record<string, { read?: boolean }> | undefined, hasPerm),
      ),
    [user, hasPerm],
  );

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
    <div className="space-y-5 compact:space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Reports</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a project and date range on a row, then view the report or download it. Ranges are
            capped at {MAX_RANGE_MONTHS} months — for a full year, download in two parts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <Hint label="Live summary across every helpdesk you can access">
          <Link
            href={`/t/${org}/agent/reports`}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            All helpdesks <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Hint>
        <Hint
          label={
            exportingAll
              ? "Preparing the workbook…"
              : !helpdesk?.id
                ? "Loading the workspace…"
                : "Every report you can run, in one Excel workbook — all projects, current month so far. The Project and date pickers on the rows below don't apply."
          }
        >
          <Button
            variant="outline"
            size="sm"
            onClick={onExportAll}
            disabled={exportingAll || !helpdesk?.id}
          >
            {exportingAll ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
            Export all (Excel)
          </Button>
        </Hint>
        </div>
      </div>

      <div className="rounded-xl border bg-card text-card-foreground shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[260px]">Report</TableHead>
              <TableHead className="w-[180px]">Project</TableHead>
              <TableHead className="w-[300px]">
                <span className="inline-flex items-center gap-1">
                  Date range
                  <InfoTip label="What does the date range filter?">{REPORT_DATE_RANGE_HELP}</InfoTip>
                </span>
              </TableHead>
              <TableHead className="w-[220px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {defs.map((def) => {
              const r = rows[def.key];
              const err = rangeError(r.from, r.to);
              const isDownloading = downloading?.key === def.key;
              const disabled = !!err || !helpdesk?.id;
              // Why the row's actions are disabled (shown on hover / focus).
              const disabledReason = err ?? (!helpdesk?.id ? "Loading the workspace…" : undefined);
              const downloadBtn = (
                <Button variant="outline" size="sm" disabled={disabled || isDownloading}>
                  {isDownloading ? <Loader2 className="animate-spin" /> : <Download />}
                  Download
                </Button>
              );
              return (
                <TableRow key={def.key}>
                  {/* Two lines (was three): title + category tag, then a one-line context
                      (full text on hover). Cells use the table's density padding. */}
                  <TableCell>
                    <p className="flex flex-wrap items-center gap-x-2 font-medium">
                      {def.title}
                      <Hint label={REPORT_CATEGORY_HELP[def.category]}>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {def.category}
                        </span>
                      </Hint>
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground" title={def.context}>
                      {def.context}
                    </p>
                  </TableCell>

                  <TableCell>
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

                  <TableCell>
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

                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      {/* Disabled ⇒ render the bare button inside a Hint (a disabled
                          dropdown can't open anyway), so the reason shows on hover / focus. */}
                      {disabled || isDownloading ? (
                        <Hint label={isDownloading ? "Preparing the download…" : disabledReason}>
                          {downloadBtn}
                        </Hint>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>{downloadBtn}</DropdownMenuTrigger>
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
                      )}
                      <Hint label={disabled ? disabledReason : undefined}>
                        <Button size="sm" onClick={() => onGenerate(def.key)} disabled={disabled}>
                          <Play />
                          Generate Report
                        </Button>
                      </Hint>
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
