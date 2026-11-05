"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Boxes, History, Plus, Settings2, Upload } from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { AssetFilterBar } from "@/components/assets/asset-filters";
import { AssetImportDialog } from "@/components/assets/asset-import-dialog";
import { AssetPager, rangeLabel } from "@/components/assets/asset-pager";
import { AssetTable } from "@/components/assets/asset-table";
import { hasFilters } from "@/components/assets/asset-utils";
import { useAssetLookups } from "@/components/assets/use-asset-lookups";
import { useAssetUrlState } from "@/components/assets/use-asset-url-state";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { useAssetPerms } from "@/lib/itsm/asset-perms";
import { assetsApi } from "@/lib/itsm/assets-api";
import type { AssetListItem } from "@/lib/itsm/assets-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { ASSET_HELP } from "@/lib/itsm/help/assets";

/** The asset register: filters + page + ordering live in the URL (dashboard tiles deep-link
 *  here), the table card is the scroll pane so its header sticks (lg+). */
export default function AssetListPage() {
  const { org, helpdeskKey, helpdesk } = useWorkspace();
  const perms = useAssetPerms();
  const base = `/t/${org}/agent/w/${helpdeskKey}`;
  const lookups = useAssetLookups(helpdesk?.id);
  const url = useAssetUrlState();
  const { filters, page, pageSize, ordering, update } = url;

  const [rows, setRows] = useState<AssetListItem[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const seq = useRef(0);

  const queryKey = JSON.stringify({ filters, page, pageSize, ordering, hd: helpdesk?.id, reloadKey });

  useEffect(() => {
    if (!helpdesk) return;
    const my = ++seq.current;
    setLoading(true);
    assetsApi
      .list({ ...filters, helpdesk: helpdesk.id, page, page_size: pageSize, ordering: ordering || undefined })
      .then((r) => {
        if (my !== seq.current) return;
        setRows(r.results);
        setCount(r.count);
      })
      .catch((e) => {
        if (my !== seq.current) return;
        // A page past the end (the list shrank) → back to page 1.
        if (e instanceof ItsmApiError && e.status === 404 && page > 1) {
          update({ page: 1 });
          return;
        }
        setRows([]);
        setCount(0);
      })
      .finally(() => {
        if (my !== seq.current) return;
        setLoading(false);
        setLoaded(true);
      });
    // queryKey captures every input of the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const filtered = hasFilters(filters);
  // Opened from the sidebar category tree: say which branch is listed ("Computer › Laptop").
  const catName = (id: string | undefined) => lookups.categories.find((c) => c.id === id)?.name;
  const branch = filters.category
    ? [catName(filters.category), filters.sub_category === "none" ? "No sub-category" : catName(filters.sub_category)]
        .filter(Boolean)
        .join(" › ")
    : "";
  const noCategories = !lookups.loading && lookups.topCategories.length === 0;

  const empty = filtered ? (
    <EmptyState
      icon={Boxes}
      title="No assets match these filters"
      description="Try a different search, or clear the filters."
      className="m-4 border-0"
      action={
        <Button variant="outline" onClick={() => update(Object.fromEntries(Object.keys(filters).map((k) => [k, ""])))}>
          Clear filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={Boxes}
      title="No assets yet"
      description={
        noCategories
          ? `${ASSET_HELP.noCategories}`
          : "Add assets one by one, or import them from an Excel file."
      }
      className="m-4 border-0"
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {noCategories && perms.configRead ? (
            <Button asChild>
              <Link href={`${base}/settings/assets/categories`}>
                <Settings2 aria-hidden="true" /> Set up categories
              </Link>
            </Button>
          ) : null}
          {!noCategories && perms.create ? (
            <Button asChild>
              <Link href={`${base}/assets/list/new`}>
                <Plus aria-hidden="true" /> New asset
              </Link>
            </Button>
          ) : null}
          {!noCategories && perms.importRun ? (
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload aria-hidden="true" /> Import
            </Button>
          ) : null}
        </div>
      }
    />
  );

  return (
    <div className="flex flex-col gap-4 compact:gap-3 lg:h-[calc(100dvh_-_var(--header-h)_-_2_*_var(--main-py))] lg:min-h-[28rem]">
      <PageHeader
        className="mb-0 compact:mb-0"
        title="Asset List"
        descriptionInline
        description={
          loaded ? `${branch ? `${branch} · ` : ""}${rangeLabel(page, pageSize, count)}` : "Loading…"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {perms.configRead ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`${base}/settings/assets/categories`}>
                  <Settings2 aria-hidden="true" /> Configure
                </Link>
              </Button>
            ) : null}
            {perms.importHistory ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`${base}/assets/list/imports`}>
                  <History aria-hidden="true" /> Import history
                </Link>
              </Button>
            ) : null}
            {perms.importRun ? (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload aria-hidden="true" /> Import
              </Button>
            ) : null}
            {perms.create ? (
              <Button asChild size="sm">
                <Link href={`${base}/assets/list/new`}>
                  <Plus aria-hidden="true" /> New asset
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <AssetFilterBar values={filters} onChange={update} lookups={lookups} />

      <div className="min-h-0 overflow-auto rounded-xl border bg-card text-card-foreground shadow-soft lg:flex-1">
        <AssetTable
          rows={rows}
          loading={loading}
          ordering={ordering}
          onOrdering={(o) => update({ ordering: o })}
          hrefFor={(id) => `${base}/assets/list/${id}`}
          empty={empty}
        />
      </div>

      <AssetPager
        page={page}
        pageSize={pageSize}
        count={count}
        loading={loading}
        onPage={(p) => update({ page: p })}
        onPageSize={(n) => update({ page_size: n })}
      />

      {helpdesk && perms.importRun ? (
        <AssetImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          helpdeskId={helpdesk.id}
          base={base}
          canCreateMissing={perms.configCreate}
          canViewHistory={perms.importHistory}
          onImported={reload}
        />
      ) : null}
    </div>
  );
}
