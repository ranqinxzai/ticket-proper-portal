"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { approvalsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { ApprovalRequest } from "@/lib/itsm/types";

/** Shared "My Pending Approvals" inbox — used by both the agent app and the portal. */
export function ApprovalInbox() {
  const [rows, setRows] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      approvalsApi
        .myPending()
        .then(setRows)
        .catch(() => setRows([]))
        .finally(() => setLoading(false)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, decision: "approved" | "rejected") {
    setBusy(id);
    try {
      if (decision === "approved") await approvalsApi.approve(id);
      else await approvalsApi.reject(id);
      toast.success(decision === "approved" ? "Approved." : "Rejected.");
      await load();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not record your decision.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0)
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Nothing is awaiting your approval.
      </div>
    );

  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
        >
          <div className="min-w-0">
            <p className="font-medium">{r.ticket_summary}</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{r.ticket_number}</span> · {r.workflow_name} ·{" "}
              {r.current_stage_name} (Level {r.current_stage_level})
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" disabled={busy === r.id} onClick={() => act(r.id, "approved")}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === r.id}
              onClick={() => act(r.id, "rejected")}
            >
              <XCircle className="h-4 w-4" aria-hidden="true" /> Reject
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
