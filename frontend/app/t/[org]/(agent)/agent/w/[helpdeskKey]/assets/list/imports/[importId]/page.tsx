"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, ListChecks, Loader2, Lock, SearchX } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { AssetBackLink } from "@/components/assets/asset-back-link";
import { AssetPager } from "@/components/assets/asset-pager";
import { DEFAULT_PAGE_SIZE, apiMessage, fmtDateTime, importCell, userLabel } from "@/components/assets/asset-utils";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAssetPerms } from "@/lib/itsm/asset-perms";
import { assetImportsApi } from "@/lib/itsm/assets-api";
import type { AssetImportRow, AssetImportRun } from "@/lib/itsm/assets-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { ASSET_HELP } from "@/lib/itsm/help/assets";
import { cn } from "@/lib/utils";

const MASTER_LABEL: Record<string, string> = { vendors: "Vendors", locations: "Locations", departments: "Departments" };

function Stat({ label, value, tone, help }: { label: string; value: number; tone?: "ok" | "bad"; help?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-soft compact:p-3">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {label}
        {help ? <InfoTip label={`About ${label}`}>{help}</InfoTip> : null}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "bad" && value > 0 && "text-destructive",
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

export default function AssetImportDetailPage() {
  const { importId } = useParams<{ importId: string }>();
  const { org, helpdeskKey } = useWorkspace();
  const perms = useAssetPerms();
  const base = `/t/${org}/agent/w/${helpdeskKey}`;

  const [run, setRun] = useState<AssetImportRun | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [rows, setRows] = useState<AssetImportRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!perms.importHistory) return;
    let alive = true;
    setState("loading");
    assetImportsApi
      .get(importId)
      .then((r) => {
        if (!alive) return;
        setRun(r);
        setState("ready");
      })
      .catch((e) => alive && setState(e instanceof ItsmApiError && e.status === 404 ? "missing" : "error"));
    return () => {
      alive = false;
    };
  }, [importId, perms.importHistory]);

  useEffect(() => {
    if (!perms.importHistory || state !== "ready") return;
    const my = ++seq.current;
    setRowsLoading(true);
    assetImportsApi
      .rows(importId, { page, page_size: pageSize })
      .then((r) => {
        if (my !== seq.current) return;
        setRows(r.results);
        setCount(r.count);
      })
      .catch(() => {
        if (my !== seq.current) return;
        setRows([]);
        setCount(0);
      })
      .finally(() => my === seq.current && setRowsLoading(false));
  }, [importId, perms.importHistory, state, page, pageSize]);

  async function downloadFailed() {
    setDownloading(true);
    try {
      await assetImportsApi.failedRows(importId);
    } catch (e) {
      toast.error(apiMessage(e, "Could not download the failed rows."));
    } finally {
      setDownloading(false);
    }
  }

  const back = <AssetBackLink href={`${base}/assets/list/imports`} label="Import history" />;

  if (!perms.importHistory) {
    return (
      <div className="space-y-4">
        <AssetBackLink href={`${base}/assets/list`} label="Asset List" />
        <EmptyState
          icon={Lock}
          title="You can't see imports"
          description="Your role doesn't include Asset Import → Read. Ask an administrator if you need it."
        />
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="space-y-4">
        {back}
        <Skeleton className="h-10 w-80" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (state !== "ready" || !run) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState
          icon={SearchX}
          title={state === "missing" ? "Import not found" : "Could not load the import"}
          description={state === "missing" ? "It may belong to a helpdesk you aren't a member of." : "Check your connection and try again."}
        />
      </div>
    );
  }

  const masters = Object.entries(run.created_masters ?? {}).filter(([, names]) => names?.length);
  const noFailed = run.failed_count === 0;

  return (
    <div className="space-y-5 compact:space-y-4">
      <PageHeader
        className="mb-0 compact:mb-0"
        breadcrumb={back}
        title={<span className="break-all">{run.file_name}</span>}
        description={`Imported ${fmtDateTime(run.created_at)}${run.created_by ? ` by ${userLabel(run.created_by)}` : ""}`}
        descriptionInline
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Hint label={noFailed ? ASSET_HELP.noFailedRows : ASSET_HELP.failedRows}>
              <Button variant="outline" size="sm" onClick={() => void downloadFailed()} disabled={noFailed || downloading}>
                {downloading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                Download failed rows
              </Button>
            </Hint>
            <Hint label={run.created_count === 0 ? "This import created no assets" : undefined}>
              {run.created_count === 0 ? (
                <Button size="sm" disabled>
                  <ListChecks aria-hidden="true" /> View imported assets
                </Button>
              ) : (
                <Button asChild size="sm">
                  <Link href={`${base}/assets/list?import=${run.id}`}>
                    <ListChecks aria-hidden="true" /> View imported assets
                  </Link>
                </Button>
              )}
            </Hint>
          </div>
        }
      />

      <div className="grid gap-3 compact:gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Rows in file" value={run.total_rows} />
        <Stat label="Created" value={run.created_count} />
        <Stat label="Failed" value={run.failed_count} tone="bad" help={ASSET_HELP.failedRows} />
        <Stat label="Imported as Expired" value={run.expired_count} help={ASSET_HELP.expiredCount} />
      </div>

      {run.warnings?.length || masters.length ? (
        <div className="grid gap-3 compact:gap-2 lg:grid-cols-2">
          {run.warnings?.length ? (
            <section className="rounded-xl border bg-card p-4 shadow-soft compact:p-3">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" /> Warnings
              </h2>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {run.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {masters.length ? (
            <section className="rounded-xl border bg-card p-4 shadow-soft compact:p-3">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                Created along the way <InfoTip label="About created items">{ASSET_HELP.mastersCreated}</InfoTip>
              </h2>
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {masters.map(([kind, names]) => (
                  <li key={kind}>
                    <span className="font-medium text-foreground">{MASTER_LABEL[kind] ?? kind}:</span> {names.join(", ")}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Failed records</h2>
        {noFailed ? (
          <EmptyState icon={CheckCircle2} title="No failed rows" description="Every row in this file was imported." className="py-10" />
        ) : (
          <>
            <div
              className={cn("max-h-[70vh] overflow-auto rounded-xl border bg-card shadow-soft", rowsLoading && rows.length > 0 && "opacity-60")}
              aria-busy={rowsLoading}
            >
              <Table containerClassName="overflow-visible">
                <TableHeader sticky>
                  <TableRow>
                    <TableHead className="w-16 text-right">Row</TableHead>
                    <TableHead>Asset Name</TableHead>
                    <TableHead>Asset Tag</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Errors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rowsLoading && rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center">
                        <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading rows" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => {
                      const name = importCell(r.data, "name");
                      const tag = importCell(r.data, "asset_tag");
                      const cat = importCell(r.data, "category");
                      const sub = importCell(r.data, "sub_category");
                      return (
                        <TableRow key={r.id} className="align-top">
                          <TableCell className="text-right tabular-nums text-muted-foreground">{r.row_number}</TableCell>
                          <TableCell>
                            <span className="block max-w-[16rem] truncate" title={name || undefined}>
                              {name || <span className="text-muted-foreground">—</span>}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-xs">{tag || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>
                            <span className="block max-w-[14rem] truncate" title={cat ? (sub ? `${cat} › ${sub}` : cat) : undefined}>
                              {cat ? (sub ? `${cat} › ${sub}` : cat) : <span className="text-muted-foreground">—</span>}
                            </span>
                          </TableCell>
                          <TableCell>
                            <ul className="space-y-0.5 text-xs">
                              {r.errors.map((e, i) => (
                                <li key={i}>
                                  <span className="font-medium">{e.column}:</span>{" "}
                                  <span className="text-destructive">{e.message}</span>
                                </li>
                              ))}
                            </ul>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            <AssetPager
              page={page}
              pageSize={pageSize}
              count={count}
              loading={rowsLoading}
              noun="failed row"
              onPage={setPage}
              onPageSize={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          </>
        )}
      </section>
    </div>
  );
}
