"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, FileDown, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { ReportFilters } from "@/components/reports/report-filters";
import {
  ALL_PROJECTS,
  buildRangeScope,
  canReadReport,
  currentMonthRange,
  rangeError,
  REPORT_BY_KEY,
  reportRows,
} from "@/components/reports/catalog";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
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
import { REPORT_RANGE_BASIS, REPORT_ROW_CAP, reportColumnHelp } from "@/lib/itsm/help/reports";
import { cn } from "@/lib/utils";

/** A single standard report rendered as a plain table, with Excel + CSV export.
 * Project + From–To range initialise from the catalog link's query params and
 * default to the current month. The range is capped at 6 months (validated by
 * `rangeError`). */
export default function ReportDetailPage() {
  const { org, helpdeskKey, helpdesk, projects } = useWorkspace();
  const { reportType } = useParams<{ reportType: string }>();
  const searchParams = useSearchParams();
  const def = REPORT_BY_KEY[reportType];
  const { user, hasPerm } = useItsmAuth();
  // SLA / agent reports need their own module (the API 403s without it).
  const allowed =
    !!def && canReadReport(def, user?.permissions as Record<string, { read?: boolean }> | undefined, hasPerm);

  const [projectId, setProjectId] = useState(() => searchParams.get("project") || ALL_PROJECTS);
  const [from, setFrom] = useState(() => searchParams.get("from") || currentMonthRange().from);
  const [to, setTo] = useState(() => searchParams.get("to") || currentMonthRange().to);
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"xlsx" | "csv" | null>(null);

  const base = `/t/${org}/agent/w/${helpdeskKey}`;
  const err = rangeError(from, to);
  const scope = useMemo(
    () => buildRangeScope(helpdesk?.id, projectId, from, to),
    [helpdesk?.id, projectId, from, to],
  );

  useEffect(() => {
    if (!def || !helpdesk?.id || !allowed) return;
    if (rangeError(from, to)) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    reportsApi
      .get(reportType, scope)
      .then((res) => !cancelled && setData(res.data))
      .catch(() => {
        if (cancelled) return;
        setData(null);
        toast.error("Could not load this report.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [def, reportType, helpdesk?.id, scope, from, to, allowed]);

  const onExport = useCallback(
    async (fmt: "xlsx" | "csv") => {
      if (!helpdesk?.id) return;
      if (rangeError(from, to)) {
        toast.error(rangeError(from, to) ?? "Invalid date range.");
        return;
      }
      setExporting(fmt);
      try {
        await reportsApi.exportOne(reportType, fmt, scope);
      } catch {
        toast.error(`Export to ${fmt === "xlsx" ? "Excel" : "CSV"} failed.`);
      } finally {
        setExporting(null);
      }
    },
    [helpdesk?.id, reportType, scope, from, to],
  );

  if (!def) notFound();
  if (!allowed) {
    return (
      <div className="space-y-2">
        <Link
          href={`${base}/reports`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All reports
        </Link>
        <p className="text-sm text-muted-foreground">
          Your role doesn&apos;t include the {def.title} report. Ask your admin for access.
        </p>
      </div>
    );
  }

  const rows = reportRows(def, data);
  const columns = def.columnsFromData ? def.columnsFromData(data) : def.columns;
  const colCount = Math.max(columns.length, 1);
  const truncated =
    !!data && typeof data === "object" && (data as { truncated?: boolean }).truncated === true;
  // Some list reports are capped server-side without a `truncated` flag.
  const rowCap = REPORT_ROW_CAP[def.key];
  // Why Excel / CSV are disabled (hover / focus on the disabled button).
  const exportDisabledReason = exporting
    ? "Preparing the download…"
    : !helpdesk?.id
      ? "Loading the workspace…"
      : err
        ? err
        : loading
          ? "Wait for the report to load"
          : undefined;

  return (
    // Viewport-height column (the queue's pattern): the title/filter row stays put and
    // the table card is the only scroller, so its header row can stick. A window-level
    // sticky header can't work — wide reports (Ticket Data) scroll horizontally, and
    // that overflow box would capture the sticky. Height = viewport − the header
    // (`--header-h`) − <main>'s top + bottom padding (`--main-py`), density-aware;
    // `min-h` guards very short screens.
    <div className="flex h-[calc(100dvh_-_var(--header-h)_-_2_*_var(--main-py))] min-h-[28rem] flex-col gap-4 compact:gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {/* Back link sits on the title line (breadcrumb) instead of its own row. */}
          <div className="flex flex-wrap items-center gap-x-2">
            <Link
              href={`${base}/reports`}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              All reports
            </Link>
            <span className="text-sm text-muted-foreground/60" aria-hidden="true">/</span>
            <h2 className="text-base font-semibold">{def.title}</h2>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{def.context}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReportFilters
            projects={projects}
            projectId={projectId}
            onProject={setProjectId}
            from={from}
            to={to}
            onFrom={setFrom}
            onTo={setTo}
            rangeHelp={REPORT_RANGE_BASIS[def.key]}
          />
          <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <Hint label={exportDisabledReason ?? "Download this report with the current project and dates as an Excel workbook"}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onExport("xlsx")}
              disabled={!!exporting || loading || !!err || !helpdesk?.id}
            >
              {exporting === "xlsx" ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
              Excel
            </Button>
          </Hint>
          <Hint label={exportDisabledReason ?? "Download this report with the current project and dates as a CSV file"}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onExport("csv")}
              disabled={!!exporting || loading || !!err || !helpdesk?.id}
            >
              {exporting === "csv" ? <Loader2 className="animate-spin" /> : <FileDown />}
              CSV
            </Button>
          </Hint>
        </div>
      </div>

      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      {rowCap && !err && !loading && rows.length >= rowCap ? (
        <p className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-500">
          Showing the first {rowCap.toLocaleString()} rows — this report stops there.
          <InfoTip label="About the row limit">
            {`This report lists at most ${rowCap.toLocaleString()} rows, newest first. Narrow the project or date range to see older ones.`}
          </InfoTip>
        </p>
      ) : null}
      {truncated ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Showing the first {rows.length.toLocaleString()} rows. Narrow the project or date range to
          export the rest.
        </p>
      ) : null}

      {/* Spreadsheet-style grid: one line per row (headers + cells never wrap; long
          values are clipped with the full text on hover — the Excel/CSV export keeps
          everything), the header row frozen on top and the first column (the ticket /
          row key) frozen on the left while scrolling sideways. */}
      <div className="min-h-0 overflow-auto rounded-xl border bg-card text-card-foreground shadow-soft">
        <Table containerClassName="overflow-visible">
          <TableHeader sticky>
            <TableRow>
              {columns.map((c, ci) => {
                const help = reportColumnHelp(def.key, c.key);
                return (
                  <TableHead
                    key={c.key}
                    className={cn(
                      "whitespace-nowrap",
                      c.align === "right" && "text-right",
                      ci === 0 && "left-0 z-30 shadow-[inset_-1px_-1px_0_hsl(var(--border))]",
                    )}
                  >
                    {help ? (
                      <span className={cn("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                        {c.header}
                        <InfoTip label={`About ${c.header}`}>{help}</InfoTip>
                      </span>
                    ) : (
                      c.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {err ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                  Adjust the date range to view this report.
                </TableCell>
              </TableRow>
            ) : loading ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                  No data for this selection.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((c, ci) => {
                    const raw = row[c.key];
                    const text = c.fmt
                      ? c.fmt(raw)
                      : raw == null || raw === ""
                        ? "—"
                        : String(raw);
                    return (
                      <TableCell
                        key={c.key}
                        className={cn(
                          "whitespace-nowrap",
                          c.align === "right" && "text-right tabular-nums",
                          ci === 0 &&
                            "sticky left-0 z-10 bg-card font-medium shadow-[inset_-1px_0_0_hsl(var(--border))]",
                        )}
                      >
                        <span className="block max-w-[22rem] truncate" title={text && text !== "—" ? text : undefined}>
                          {text}
                        </span>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
