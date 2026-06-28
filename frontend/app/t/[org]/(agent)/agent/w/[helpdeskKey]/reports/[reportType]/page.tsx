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
  currentMonthRange,
  rangeError,
  REPORT_BY_KEY,
  reportRows,
} from "@/components/reports/catalog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { reportsApi } from "@/lib/itsm/api";
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
    if (!def || !helpdesk?.id) return;
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
  }, [def, reportType, helpdesk?.id, scope, from, to]);

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

  const rows = reportRows(def, data);
  const columns = def.columnsFromData ? def.columnsFromData(data) : def.columns;
  const colCount = Math.max(columns.length, 1);
  const truncated =
    !!data && typeof data === "object" && (data as { truncated?: boolean }).truncated === true;

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`${base}/reports`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All reports
        </Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{def.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{def.context}</p>
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
          />
          <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => onExport("xlsx")}
            disabled={!!exporting || loading || !!err || !helpdesk?.id}
          >
            {exporting === "xlsx" ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
            Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onExport("csv")}
            disabled={!!exporting || loading || !!err || !helpdesk?.id}
          >
            {exporting === "csv" ? <Loader2 className="animate-spin" /> : <FileDown />}
            CSV
          </Button>
        </div>
      </div>

      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      {truncated ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Showing the first {rows.length.toLocaleString()} rows. Narrow the project or date range to
          export the rest.
        </p>
      ) : null}

      <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={cn(c.align === "right" && "text-right")}>
                  {c.header}
                </TableHead>
              ))}
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
                  {columns.map((c) => {
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
                          c.align === "right" && "text-right tabular-nums",
                          c.key === columns[0]?.key && "font-medium",
                        )}
                      >
                        {text}
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
