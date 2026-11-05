"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FileSpreadsheet, Loader2, SearchX, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { AssetBackLink } from "@/components/assets/asset-back-link";
import { AssetForm } from "@/components/assets/asset-form";
import { AssetDocuments } from "@/components/assets/asset-documents";
import { AssetHistory } from "@/components/assets/asset-history";
import { AssetStatusBadge } from "@/components/assets/asset-status-badge";
import { AssetTickets } from "@/components/assets/asset-tickets";
import { apiMessage } from "@/components/assets/asset-utils";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAssetPerms } from "@/lib/itsm/asset-perms";
import { assetsApi } from "@/lib/itsm/assets-api";
import type { AssetDetail } from "@/lib/itsm/assets-types";
import { ItsmApiError } from "@/lib/itsm/client";

export default function AssetDetailPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const { org, helpdeskKey } = useWorkspace();
  const perms = useAssetPerms();
  const router = useRouter();
  const base = `/t/${org}/agent/w/${helpdeskKey}`;

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [historyKey, setHistoryKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    setState("loading");
    assetsApi
      .get(assetId)
      .then((a) => {
        if (!alive) return;
        setAsset(a);
        setState("ready");
      })
      .catch((e) => {
        if (!alive) return;
        setState(e instanceof ItsmApiError && e.status === 404 ? "missing" : "error");
      });
    return () => {
      alive = false;
    };
  }, [assetId]);

  async function remove() {
    if (!asset) return;
    setDeleting(true);
    try {
      await assetsApi.delete(asset.id);
      toast.success(`Asset ${asset.asset_tag} deleted.`);
      router.push(`${base}/assets/list`);
    } catch (e) {
      toast.error(apiMessage(e, "Could not delete the asset."));
      setDeleting(false);
    }
  }

  const back = <AssetBackLink href={`${base}/assets/list`} label="Asset List" />;

  if (state === "loading") {
    return (
      <div className="space-y-4">
        {back}
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  if (state !== "ready" || !asset) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState
          icon={SearchX}
          title={state === "missing" ? "Asset not found" : "Could not load the asset"}
          description={
            state === "missing"
              ? "It may have been deleted, or it belongs to a helpdesk you aren't a member of."
              : "Check your connection and try again."
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumb={back}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 break-words">{asset.name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs font-medium text-foreground">{asset.asset_tag}</span>
            <AssetStatusBadge name={asset.status.name} color={asset.status.color} stateType={asset.status.state_type} />
            {asset.source_import ? (
              perms.importHistory ? (
                <Link
                  href={`${base}/assets/list/imports/${asset.source_import.id}`}
                  className="inline-flex items-center gap-1 text-xs text-primary-ink hover:underline"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                  Imported from {asset.source_import.file_name}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs">
                  <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                  Imported from {asset.source_import.file_name}
                </span>
              )
            ) : null}
          </span>
        }
        actions={
          perms.delete ? (
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" /> Delete
            </Button>
          ) : null
        }
      />

      {!perms.update ? <ReadOnlyBanner className="mb-4" message="You have view-only access to this asset." /> : null}

      <AssetForm
        key={asset.id}
        asset={asset}
        readOnly={!perms.update}
        base={base}
        onSaved={(a) => {
          setAsset(a);
          setHistoryKey((k) => k + 1);
        }}
        aside={
          <>
            <AssetTickets assetId={asset.id} org={org} />
            <AssetDocuments assetId={asset.id} canEdit={perms.update}
              onChanged={() => setHistoryKey((k) => k + 1)} />
            <AssetHistory assetId={asset.id} refreshKey={historyKey} />
          </>
        }
      />

      <Dialog open={confirmDelete} onOpenChange={(o) => !deleting && setConfirmDelete(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {asset.asset_tag}?</DialogTitle>
            <DialogDescription>
              “{asset.name}” is removed from the Asset List, dashboard and reports. Its tag can be used again by a new
              asset.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={deleting}>
              {deleting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Delete asset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
