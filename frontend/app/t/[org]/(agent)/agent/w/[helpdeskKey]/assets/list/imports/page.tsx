"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Lock, Upload } from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { AssetBackLink } from "@/components/assets/asset-back-link";
import { AssetImportDialog } from "@/components/assets/asset-import-dialog";
import { AssetPager, rangeLabel } from "@/components/assets/asset-pager";
import { DEFAULT_PAGE_SIZE, fmtDateTime, userLabel } from "@/components/assets/asset-utils";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAssetPerms } from "@/lib/itsm/asset-perms";
import { assetImportsApi } from "@/lib/itsm/assets-api";
import type { AssetImportRun } from "@/lib/itsm/assets-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { ASSET_HELP } from "@/lib/itsm/help/assets";
import { cn } from "@/lib/utils";

function openFromRow(e: React.MouseEvent<HTMLTableRowElement>, open: () => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if ((e.target as HTMLElement).closest("a, button")) return;
  open();
}

export default function AssetImportsPage() {
  const { org, helpdeskKey, helpdesk } = useWorkspace();
  const perms = useAssetPerms();
  const router = useRouter();
  const base = `/t/${org}/agent/w/${helpdeskKey}`;

  const [rows, setRows] = useState<AssetImportRun[] | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!helpdesk || !perms.importHistory) return;
    const my = ++seq.current;
    setLoading(true);
    assetImportsApi
      .list({ helpdesk: helpdesk.id, page, page_size: pageSize })
      .then((r) => {
        if (my !== seq.current) return;
        setRows(r.results);
        setCount(r.count);
      })
      .catch((e) => {
        if (my !== seq.current) return;
        if (e instanceof ItsmApiError && e.status === 404 && page > 1) {
          setPage(1);
          return;
        }
        setRows([]);
        setCount(0);
      })
      .finally(() => my === seq.current && setLoading(false));
  }, [helpdesk, perms.importHistory, page, pageSize, reloadKey]);

  const back = <AssetBackLink href={`${base}/assets/list`} label="Asset List" />;

  if (!perms.importHistory) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState
          icon={Lock}
          title="You can't see import history"
          description="Your role doesn't include Asset Import → Read. Ask an administrator if you need it."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 compact:space-y-3">
      <PageHeader
        className="mb-0 compact:mb-0"
        breadcrumb={back}
        title={
          <span className="inline-flex items-center gap-2">
            Import history <InfoTip label="About import history">{ASSET_HELP.importHistory}</InfoTip>
          </span>
        }
        description={rows === null ? "Loading…" : rangeLabel(page, pageSize, count, "import")}
        descriptionInline
        actions={
          perms.importRun ? (
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Upload aria-hidden="true" /> Import
            </Button>
          ) : null
        }
      />

      {rows === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="No imports yet"
          description="Imports into this helpdesk appear here, with their failed rows."
          action={
            perms.importRun ? (
              <Button onClick={() => setImportOpen(true)}>
                <Upload aria-hidden="true" /> Import assets
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={cn("overflow-x-auto rounded-xl border bg-card shadow-soft", loading && "opacity-60")} aria-busy={loading}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>By</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1">
                    Expired <InfoTip label="About Expired">{ASSET_HELP.expiredCount}</InfoTip>
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const href = `${base}/assets/list/imports/${r.id}`;
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={(e) => openFromRow(e, () => router.push(href))}>
                    <TableCell>
                      <Link href={href} className="block max-w-[22rem] truncate font-medium text-primary-ink hover:underline" title={r.file_name}>
                        {r.file_name}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{userLabel(r.created_by) || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.created_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.total_rows.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.created_count.toLocaleString()}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", r.failed_count > 0 && "font-medium text-destructive")}>
                      {r.failed_count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.expired_count.toLocaleString()}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AssetPager
        page={page}
        pageSize={pageSize}
        count={count}
        loading={loading}
        noun="import"
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />

      {helpdesk && perms.importRun ? (
        <AssetImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          helpdeskId={helpdesk.id}
          base={base}
          canCreateMissing={perms.configCreate}
          canViewHistory={perms.importHistory}
          onImported={() => setReloadKey((k) => k + 1)}
        />
      ) : null}
    </div>
  );
}
