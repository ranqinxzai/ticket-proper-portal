"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutDashboard, Loader2, Plus, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dashAdminApi } from "@/lib/itsm/admin-api";
import type { Dashboard } from "@/lib/itsm/admin-types";
import { ItsmApiError } from "@/lib/itsm/client";

export default function DashboardsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    dashAdminApi
      .list()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(e instanceof ItsmApiError ? e.message : "Failed to load dashboards");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function createDashboard() {
    setCreating(true);
    try {
      const d = await dashAdminApi.create({ name: "Untitled dashboard" });
      router.push(`/dashboards/${d.id}/edit`);
    } catch (e: unknown) {
      toast.error(e instanceof ItsmApiError ? e.message : "Failed to create dashboard");
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-5 w-5 text-indigo-500" />
          <h1 className="text-xl font-semibold">Dashboards</h1>
        </div>
        <Button size="sm" onClick={createDashboard} disabled={creating}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          New dashboard
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : items.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((d) => (
            <Link
              key={d.id}
              href={`/dashboards/${d.id}/edit`}
              className="rounded-lg border bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium">{d.name || "Untitled dashboard"}</div>
                {d.is_shared && (
                  <Badge variant="secondary" className="gap-1">
                    <Share2 className="h-3 w-3" /> Shared
                  </Badge>
                )}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {d.widgets.length} {d.widgets.length === 1 ? "widget" : "widgets"}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed bg-white p-10 text-center">
          <div className="mb-1 text-base font-medium">No dashboards yet</div>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Create a dashboard to assemble KPIs, charts, and saved-filter ticket lists.
          </p>
          <Button size="sm" className="mt-4" onClick={createDashboard} disabled={creating}>
            <Plus className="h-4 w-4" /> New dashboard
          </Button>
        </div>
      )}
    </div>
  );
}
