"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { pendingStageText, waitingFor } from "@/components/approvals/approval-text";
import { RejectApprovalDialog } from "@/components/approvals/reject-approval-dialog";
import { WithdrawApprovalDialog } from "@/components/approvals/withdraw-approval-dialog";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { TICKET_HELP } from "@/lib/itsm/help/ticket";
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

function when(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** Approval panel on a ticket. Renders nothing if the ticket has no approvals.
 * Approve/Reject show only when the server says this user can decide (`can_decide`);
 * everyone else sees who it is waiting for. Reject asks for a reason. `onDecision`
 * lets the parent refresh after a decision — a pending approval freezes the ticket's
 * status, so its workflow transition buttons must re-appear once it's decided. */
export function ApprovalPanel({
  ticketId,
  onDecision,
  onPendingChange,
  reloadKey,
}: {
  ticketId: string;
  /** Changes whenever the ticket changes (e.g. `updated_at`) so an approval started
   *  by a transition shows up without a page reload. */
  reloadKey?: string | number | null;
  onDecision?: () => void;
  /** Reports whether any approval is still pending — the header uses it to explain
   *  why the workflow transition buttons are missing (status is frozen). */
  onPendingChange?: (pending: boolean) => void;
}) {
  const [reqs, setReqs] = useState<ApprovalRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalRequest | null>(null);
  const [withdrawing, setWithdrawing] = useState<ApprovalRequest | null>(null);

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
  }, [load, reloadKey]);

  const anyPending = reqs.some((r) => r.status === "pending");
  useEffect(() => {
    onPendingChange?.(anyPending);
  }, [anyPending, onPendingChange]);

  async function act(id: string, decision: "approved" | "rejected", reason = "") {
    setBusy(id);
    try {
      if (decision === "approved") await approvalsApi.approve(id);
      else await approvalsApi.reject(id, reason);
      toast.success(decision === "approved" ? "Approved." : "Rejected.");
      setRejecting(null);
      await load();
      // Refresh the parent: the decision may have unfrozen the ticket's status, so its
      // workflow transition buttons (hidden while pending) need to be re-fetched.
      onDecision?.();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not record your decision.");
    } finally {
      setBusy(null);
    }
  }

  async function withdraw(id: string, reason: string) {
    setBusy(id);
    try {
      await approvalsApi.withdraw(id, reason);
      toast.success("Approval withdrawn.");
      setWithdrawing(null);
      await load();
      onDecision?.();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not withdraw the approval.");
    } finally {
      setBusy(null);
    }
  }

  if (!loaded || reqs.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 text-sm shadow-soft",
        // Highlight the card while a decision is still outstanding.
        anyPending && "border-warning/40 ring-1 ring-warning/20",
      )}
    >
      <h2 className="mb-2 text-sm font-semibold">Approvals</h2>
      <ul className="space-y-3">
        {reqs.map((r) => (
          <li key={r.id} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {r.workflow_name}
                {r.mode === "parallel" ? " · all stages at once" : ""}
              </span>
              <span className={cn("font-medium capitalize", STATUS_CLS[r.status])}>{r.status}</span>
            </div>
            {r.source === "sent" ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>
                  Sent by <span className="text-foreground">{r.requested_by_name ?? "an agent"}</span> · {when(r.created_at)}
                  {r.status === "pending" && r.waiting_status_name && r.return_status_name ? (
                    <> · {TICKET_HELP.waitingReturn(r.waiting_status_name, r.return_status_name)}</>
                  ) : null}
                </p>
                {r.note ? (
                  <p className="whitespace-pre-line rounded-md bg-muted/50 px-2 py-1.5 text-foreground">
                    <span className="sr-only">{TICKET_HELP.sentNote} </span>
                    {r.note}
                  </p>
                ) : null}
              </div>
            ) : null}
            {r.status === "pending" ? (
              <>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Awaiting {pendingStageText(r)}
                  <InfoTip label="Who can decide this approval?">
                    {`${TICKET_HELP.approverOnly}\n${TICKET_HELP.approvalLock}`}
                  </InfoTip>
                </p>
                {r.blocked_reason ? (
                  <p className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{r.blocked_reason}</span>
                    <InfoTip label="What does this mean?" className="text-warning hover:text-warning">
                      {TICKET_HELP.approvalBlocked}
                    </InfoTip>
                  </p>
                ) : null}
                {r.can_decide ? (
                  <div className="flex gap-2">
                    <Hint label={busy === r.id ? "Recording your decision…" : TICKET_HELP.approve}>
                      <Button size="sm" disabled={busy === r.id} onClick={() => act(r.id, "approved")}>
                        Approve
                      </Button>
                    </Hint>
                    <Hint label={busy === r.id ? "Recording your decision…" : TICKET_HELP.reject}>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === r.id}
                        onClick={() => setRejecting(r)}
                      >
                        Reject
                      </Button>
                    </Hint>
                  </div>
                ) : (
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {(r.pending_stages ?? []).map((s) => (
                      <li key={s.id}>
                        Waiting for {waitingFor(s)}
                        {(r.pending_stages?.length ?? 0) > 1 ? ` (${s.name})` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}
            {r.status === "pending" && r.can_withdraw ? (
              <Hint label={busy === r.id ? "Working…" : TICKET_HELP.withdraw}>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy === r.id} onClick={() => setWithdrawing(r)}>
                  Withdraw
                </Button>
              </Hint>
            ) : null}
            {r.actions.length > 0 ? (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {r.actions.map((a) => (
                  <li key={a.id}>
                    <span className="text-foreground">{a.approver_name ?? "Someone"}</span> {a.decision}
                    {a.stage_name ? ` · ${a.stage_name}` : ""}
                    <span> · {when(a.created_at)}</span>
                    {a.comment ? (
                      <span className={a.decision === "rejected" ? "text-destructive" : undefined}>
                        {" "}
                        — {a.comment}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      <RejectApprovalDialog
        open={!!rejecting}
        ticketLabel={rejecting ? rejecting.workflow_name : undefined}
        busy={!!rejecting && busy === rejecting.id}
        onCancel={() => setRejecting(null)}
        onConfirm={(reason) => (rejecting ? act(rejecting.id, "rejected", reason) : undefined)}
      />
      <WithdrawApprovalDialog
        open={!!withdrawing}
        label={withdrawing?.workflow_name}
        returnStatus={withdrawing?.waiting_status_name ? withdrawing.return_status_name : null}
        busy={!!withdrawing && busy === withdrawing.id}
        onCancel={() => setWithdrawing(null)}
        onConfirm={(reason) => (withdrawing ? withdraw(withdrawing.id, reason) : undefined)}
      />
    </div>
  );
}
