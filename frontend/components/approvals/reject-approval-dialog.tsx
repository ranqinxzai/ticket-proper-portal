"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Asks for the (required) rejection reason. The reason is stored on the approval
 *  decision (`ApprovalAction.comment`) and shown in the ticket's approval history.
 *  `onConfirm` should throw on failure so the dialog stays open. */
export function RejectApprovalDialog({
  open,
  ticketLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** e.g. "ITREQ-12 · Need a laptop" — shown in the description. */
  ticketLabel?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const blank = !reason.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this approval?</DialogTitle>
          <DialogDescription>
            {ticketLabel ? `${ticketLabel}. ` : ""}
            Rejecting stops the whole approval. Say why. The reason is kept in the ticket's approval
            history.
          </DialogDescription>
        </DialogHeader>
        <textarea
          spellCheck
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Reason for rejecting"
          rows={4}
          autoFocus
          placeholder="Reason for rejecting…"
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Hint label={busy ? "Recording your decision…" : blank ? "Give a reason first" : ""}>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || blank}
              onClick={() => void onConfirm(reason.trim())}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Reject
            </Button>
          </Hint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
