"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GitBranch, Loader2, ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { workflowsApi } from "@/lib/itsm/admin-api";
import type { WorkflowSummary } from "@/lib/itsm/admin-types";
import { useItsmAuth } from "@/lib/itsm/auth";

export default function WorkflowsListPage() {
  const router = useRouter();
  const { loading: authLoading, hasPerm, isSupervisor } = useItsmAuth();
  const allowed = isSupervisor || hasPerm("itsm.workflows", "read");

  const [rows, setRows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !allowed) router.replace("/queues");
  }, [authLoading, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await workflowsApi.list();
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workflows");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  if (authLoading || !allowed) {
    return <div className="grid place-items-center py-20 text-sm text-muted-foreground">Checking access…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/admin" className="text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <GitBranch className="h-5 w-5 text-indigo-500" />
        <h1 className="text-xl font-semibold">Workflows</h1>
        <span className="ml-auto text-sm text-muted-foreground">
          {rows.length} workflow{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {loading ? (
        <div className="grid place-items-center py-20 text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading workflows…
        </div>
      ) : error ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-destructive">{error}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
          No workflows defined yet.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((wf) => (
            <Link
              key={wf.id}
              href={`/admin/workflows/${wf.id}`}
              className="rounded-lg border bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium">{wf.name}</div>
                {wf.is_default && (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    Default
                  </Badge>
                )}
              </div>
              {wf.description && (
                <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{wf.description}</div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="capitalize">
                  {wf.base_type}
                </Badge>
                <span>
                  {wf.status_count ?? 0} status{(wf.status_count ?? 0) === 1 ? "" : "es"}
                </span>
                <span>v{wf.version}</span>
                {!wf.is_active && <Badge variant="outline" className="text-amber-600">Inactive</Badge>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
