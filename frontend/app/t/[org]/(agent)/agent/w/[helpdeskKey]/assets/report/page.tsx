"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { AssetFilterBar } from "@/components/assets/asset-filters";
import { AssetPager, rangeLabel } from "@/components/assets/asset-pager";
import { AssetTable } from "@/components/assets/asset-table";
import { apiMessage, assetListHref, fmtMoney, type FilterValues } from "@/components/assets/asset-utils";
import { StatusDot } from "@/components/assets/asset-status-badge";
import { useAssetLookups } from "@/components/assets/use-asset-lookups";
import { useAssetUrlState } from "@/components/assets/use-asset-url-state";
import { BarList, ReportCard } from "@/components/reports/report-views";
import { selectCls } from "@/components/tickets/field-styles";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { assetsApi } from "@/lib/itsm/assets-api";
import type { AssetGroupBy, AssetGroupRow, AssetListItem, AssetReport } from "@/lib/itsm/assets-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { ASSET_GROUP_BY, ASSET_HELP } from "@/lib/itsm/help/assets";
import { cn } from "@/lib/utils";

const GROUP_KEYS = new Set<string>(ASSET_GROUP_BY.map((g) => g.value));

/** The list filter a group row narrows to (state type rows filter on `state_type`). */
function groupFilter(groupBy: AssetGroupBy, row: AssetGroupRow): FilterValues | null {
  if (!row.key || row.key === "other") return null;
  return { [groupBy]: row.key } as FilterValues;
}

export default function AssetReportPage() {
  const { org, helpdeskKey, helpdesk } = useWorkspace();
  const router = useRouter();
  const base = `/t/${org}/agent/w/${helpdeskKey}`;
  const lookups = useAssetLookups(helpdesk?.id);
  const url = useAssetUrlState();
  const { filters, page, pageSize, ordering, update } = url;
  const rawGroup = url.get("group_by");
  const groupBy: AssetGroupBy = GROUP_KEYS.has(rawGroup) ? (rawGroup as AssetGroupBy) : "category";
  const groupLabel = ASSET_GROUP_BY.find((g) => g.value === groupBy)?.label ?? "Group";

  const [report, setReport] = useState<AssetReport | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [rows, setRows] = useState<AssetListItem[]>([]);
  const [count, setCount] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const reportSeq = useRef(0);
  const rowsSeq = useRef(0);

  const filterKey = JSON.stringify({ filters, hd: helpdesk?.id });

  useEffect(() => {
    if (!helpdesk) return;
    const my = ++reportSeq.current;
    setReportLoading(true);
    assetsApi
      .report({ ...filters, helpdesk: helpdesk.id, group_by: groupBy })
      .then((r) => my === reportSeq.current && setReport(r))
      .catch((e) => {
        if (my !== reportSeq.current) return;
        setReport(null);
        toast.error(apiMessage(e, "Could not load the report."));
      })
      .finally(() => my === reportSeq.current && setReportLoading(false));
    // filterKey captures the filters + helpdesk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, groupBy]);

  useEffect(() => {
    if (!helpdesk) return;
    const my = ++rowsSeq.current;
    setRowsLoading(true);
    assetsApi
      .list({ ...filters, helpdesk: helpdesk.id, page, page_size: pageSize, ordering: ordering || undefined })
      .then((r) => {
        if (my !== rowsSeq.current) return;
        setRows(r.results);
        setCount(r.count);
      })
      .catch((e) => {
        if (my !== rowsSeq.current) return;
        if (e instanceof ItsmApiError && e.status === 404 && page > 1) {
          update({ page: 1 });
          return;
        }
        setRows([]);
        setCount(0);
      })
      .finally(() => my === rowsSeq.current && setRowsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page, pageSize, ordering]);

  async function onExport() {
    if (!helpdesk) return;
    setExporting(true);
    try {
      await assetsApi.export({ ...filters, helpdesk: helpdesk.id, group_by: groupBy, ordering: ordering || undefined });
    } catch (e) {
      toast.error(apiMessage(e, "Could not export the report."));
    } finally {
      setExporting(false);
    }
  }

  const groups = report?.rows ?? [];
  const openGroup = (row: AssetGroupRow) => {
    const f = groupFilter(groupBy, row);
    if (!f) return;
    router.push(assetListHref(base, { ...filters, ...f }));
  };

  return (
    <div className="space-y-4 compact:space-y-3">
      <PageHeader
        className="mb-0 compact:mb-0"
        title="Asset Report"
        description="Count and cost of assets per group, with the matching assets below."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={assetListHref(base, filters)}
              className="inline-flex h-[var(--ctl-h-sm)] items-center gap-1 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open in Asset List <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <Hint label={!helpdesk ? "Wait for the workspace to load" : ASSET_HELP.export}>
              <Button size="sm" variant="outline" onClick={() => void onExport()} disabled={exporting || !helpdesk}>
                {exporting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileSpreadsheet aria-hidden="true" />}
                Export to Excel
              </Button>
            </Hint>
          </div>
        }
      />

      <AssetFilterBar values={filters} onChange={update} lookups={lookups} />

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="asset-group-by" className="text-sm font-medium">
          Group by
        </label>
        <select
          id="asset-group-by"
          value={groupBy}
          onChange={(e) => update({ group_by: e.target.value === "category" ? "" : e.target.value, page: url.page })}
          className={cn(selectCls, "w-44")}
        >
          {ASSET_GROUP_BY.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        <InfoTip label="About Group by">{ASSET_HELP.groupBy}</InfoTip>
      </div>

      <div className="grid gap-4 compact:gap-3 lg:grid-cols-5">
        <ReportCard
          title={`Summary by ${groupLabel.toLowerCase()}`}
          hint={report ? `${report.total.count.toLocaleString()} assets` : undefined}
          help={ASSET_HELP.groupBy}
          className={cn("lg:col-span-3", reportLoading && report && "opacity-60")}
        >
          {reportLoading && !report ? (
            <p className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading summary" />
            </p>
          ) : groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No assets match these filters.</p>
          ) : (
            <div className="max-h-[26rem] overflow-auto">
              <Table containerClassName="overflow-visible">
                <TableHeader sticky>
                  <TableRow>
                    <TableHead>{groupLabel}</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex flex-row-reverse items-center gap-1">
                        % <InfoTip label="About the percentage">{ASSET_HELP.percent}</InfoTip>
                      </span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex flex-row-reverse items-center gap-1">
                        Total cost <InfoTip label="About total cost">{ASSET_HELP.groupCost}</InfoTip>
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => {
                    const target = groupFilter(groupBy, g);
                    return (
                      <TableRow key={g.key}>
                        <TableCell>
                          {target ? (
                            <button
                              type="button"
                              onClick={() => openGroup(g)}
                              className="inline-flex max-w-[18rem] items-center gap-2 rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              {g.color ? <StatusDot color={g.color} /> : null}
                              <span className="truncate" title={g.label}>
                                {g.label}
                              </span>
                            </button>
                          ) : (
                            <span className="block max-w-[18rem] truncate" title={g.label}>
                              {g.label}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{g.count.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {(g.percent ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(g.cost)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                {report ? (
                  <TableFooter>
                    <TableRow>
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">{report.total.count.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">100%</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(report.total.cost)}</TableCell>
                    </TableRow>
                  </TableFooter>
                ) : null}
              </Table>
            </div>
          )}
        </ReportCard>

        <ReportCard title="Chart" hint={groupLabel} help="Assets per group. Click a bar to open those assets in the Asset List." className="lg:col-span-2">
          <div className="max-h-[26rem] overflow-auto">
            <BarList
              rows={groups}
              onBar={(r) => openGroup(r as unknown as AssetGroupRow)}
              actionLabel="View assets"
            />
          </div>
        </ReportCard>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          Assets <span className="font-normal text-muted-foreground">· {rangeLabel(page, pageSize, count)}</span>
        </h2>
        <div className="max-h-[70vh] min-h-0 overflow-auto rounded-xl border bg-card text-card-foreground shadow-soft">
          <AssetTable
            rows={rows}
            loading={rowsLoading}
            ordering={ordering}
            onOrdering={(o) => update({ ordering: o })}
            hrefFor={(id) => `${base}/assets/list/${id}`}
            empty={<p className="py-10 text-center text-sm text-muted-foreground">No assets match these filters.</p>}
          />
        </div>
        <AssetPager
          page={page}
          pageSize={pageSize}
          count={count}
          loading={rowsLoading}
          onPage={(p) => update({ page: p })}
          onPageSize={(n) => update({ page_size: n })}
        />
      </section>
    </div>
  );
}
