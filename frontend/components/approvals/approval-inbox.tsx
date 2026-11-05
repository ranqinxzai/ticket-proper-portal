"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { toast } from "sonner";

import { pendingStageText } from "@/components/approvals/approval-text";
import { RejectApprovalDialog } from "@/components/approvals/reject-approval-dialog";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { approvalsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { ApprovalRequest } from "@/lib/itsm/types";

/** Plain-language hover help — the portal's non-technical approvers see these too.
 *  Grounded in itsm_approvals/services/engine.py `decide`. */
const LEVEL_HELP =
  "Approvals can need sign-off in several steps. This shows which step (or steps, when they run at the same time) it's waiting on.";
const APPROVE_HELP =
  "Records your approval. If others or another level still need to approve, it moves on to them; otherwise the request is approved.";
const REJECT_HELP =
  "Rejects the whole request — any later levels are skipped. You'll be asked for a reason, which is kept with the request.";
const BUSY_HELP = "Saving your decision…";
const OPEN_HELP = "Open the request";
/** The explicit "read it before you decide" action — the mono number link above
 *  is easy to miss for non-technical approvers. */
const VIEW_HELP = {
  portal: "Read the full request first — details, attachments and the conversation. It opens read-only; you decide here.",
  agent: "Open the ticket to read it in full before you decide.",
} as const;

/** Where the ticket number links to: the agent ticket detail, or the portal's
 *  read-only request page (approvers can open it there). */
function ticketHref(org: string, surface: "agent" | "portal", r: ApprovalRequest): string | null {
  if (surface === "portal") return `/t/${org}/portal/requests/${r.ticket_number}`;
  if (!r.ticket_helpdesk_key || !r.ticket_project_key) return null;
  return `/t/${org}/agent/w/${r.ticket_helpdesk_key}/p/${r.ticket_project_key}/${r.ticket_number}`;
}

/** Shared "My Pending Approvals" inbox — used by both the agent app and the portal. */
export function ApprovalInbox({ surface = "agent" }: { surface?: "agent" | "portal" }) {
  const { org } = useParams<{ org: string }>();
  const [rows, setRows] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalRequest | null>(null);

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

  async function act(id: string, decision: "approved" | "rejected", reason = "") {
    setBusy(id);
    try {
      if (decision === "approved") await approvalsApi.approve(id);
      else await approvalsApi.reject(id, reason);
      toast.success(decision === "approved" ? "Approved." : "Rejected.");
      setRejecting(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not record your decision.");
    } finally {
      setBusy(null);
    }
  }

  if (loading)
    return (
      <ul className="space-y-3 compact:space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i}>
            <Skeleton className="h-[72px] w-full rounded-xl" />
          </li>
        ))}
      </ul>
    );
  if (rows.length === 0)
    return (
      <EmptyState
        icon={CheckCircle2}
        title="You're all caught up"
        description="Nothing is awaiting your approval."
      />
    );

  return (
    <>
      <ul className="space-y-3 compact:space-y-2">
        {rows.map((r) => {
          const href = ticketHref(org, surface, r);
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-card-foreground compact:px-3.5 compact:py-2.5 shadow-soft"
            >
              <div className="min-w-0">
                <p className="font-medium">{r.ticket_summary}</p>
                <p className="text-xs text-muted-foreground">
                  {href ? (
                    <Hint label={OPEN_HELP}>
                      <Link
                        href={href}
                        className="font-mono text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {r.ticket_number}
                      </Link>
                    </Hint>
                  ) : (
                    <span className="font-mono">{r.ticket_number}</span>
                  )}{" "}
                  · {r.workflow_name} · {pendingStageText(r)}
                  <InfoTip label="What does the level mean?" className="ml-[-1px]">
                    {LEVEL_HELP}
                  </InfoTip>
                </p>
                {r.source === "sent" && (r.note || r.requested_by_name) ? (
                  <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                    {r.requested_by_name ? <span className="text-foreground">{r.requested_by_name}</span> : "The agent"}
                    {r.note ? `: “${r.note}”` : " sent this for approval."}
                  </p>
                ) : null}
                {r.blocked_reason ? (
                  <p className="mt-1 text-xs text-warning">{r.blocked_reason}</p>
                ) : null}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {href ? (
                  <Hint label={VIEW_HELP[surface]}>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={href}>
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        {surface === "portal" ? "View request" : "Open ticket"}
                      </Link>
                    </Button>
                  </Hint>
                ) : null}
                <Hint label={busy === r.id ? BUSY_HELP : APPROVE_HELP}>
                  <Button size="sm" disabled={busy === r.id} onClick={() => act(r.id, "approved")}>
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Approve
                  </Button>
                </Hint>
                <Hint label={busy === r.id ? BUSY_HELP : REJECT_HELP}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === r.id}
                    onClick={() => setRejecting(r)}
                  >
                    <XCircle className="h-4 w-4" aria-hidden="true" /> Reject
                  </Button>
                </Hint>
              </div>
            </li>
          );
        })}
      </ul>
      <RejectApprovalDialog
        open={!!rejecting}
        ticketLabel={rejecting ? `${rejecting.ticket_number} · ${rejecting.ticket_summary}` : undefined}
        busy={!!rejecting && busy === rejecting.id}
        onCancel={() => setRejecting(null)}
        onConfirm={(reason) => (rejecting ? act(rejecting.id, "rejected", reason) : undefined)}
      />
    </>
  );
}
