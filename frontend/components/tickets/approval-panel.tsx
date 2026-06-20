"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { approvalsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { cn } from "@/lib/utils";
import type { ApprovalRequest } from "@/lib/itsm/types";

const STATUS_CLS: Record<string, string> = {
  pending: "text-warning",
  approved: "text-success",
  rejected: "text-destructive",
  cancelled: "text-muted-foreground",
};

/** Approval panel on a ticket. Renders nothing if the ticket has no approvals.
 * Approve/Reject are attempted against the API, which enforces approver identity
 * (a non-approver gets a 403 toast). */
export function ApprovalPanel({ ticketId }: { ticketId: string }) {
  const [reqs, setReqs] = useState<ApprovalRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      approvalsApi
        .forTicket(ticketId)
        .then(setReqs)
        .catch(() => setReqs([]))
        .finally(() => setLoaded(true)),
    [ticketId],
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

  if (!loaded || reqs.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-4 text-sm">
      <h2 className="mb-2 text-sm font-semibold">Approvals</h2>
      <ul className="space-y-3">
        {reqs.map((r) => (
          <li key={r.id} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{r.workflow_name}</span>
              <span className={cn("font-medium capitalize", STATUS_CLS[r.status])}>{r.status}</span>
            </div>
            {r.status === "pending" ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Awaiting {r.current_stage_name} (Level {r.current_stage_level})
                </p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy === r.id} onClick={() => act(r.id, "approved")}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === r.id}
                    onClick={() => act(r.id, "rejected")}
                  >
                    Reject
                  </Button>
                </div>
              </>
            ) : null}
            {r.actions.length > 0 ? (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {r.actions.map((a) => (
                  <li key={a.id}>
                    {a.approver_name ?? "Someone"} {a.decision}
                    {a.comment ? ` — ${a.comment}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
