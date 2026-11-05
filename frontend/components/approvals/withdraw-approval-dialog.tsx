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

/** Confirms withdrawing an approval sent from the ticket, with an optional reason
 *  (kept on the ticket's Activity). `onConfirm` should throw on failure so the dialog
 *  stays open. */
export function WithdrawApprovalDialog({
  open,
  label,
  returnStatus,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** The approval workflow's name. */
  label?: string;
  /** Where the ticket goes back to, when it was moved to a waiting status. */
  returnStatus?: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw this approval?</DialogTitle>
          <DialogDescription>
            {label ? `${label}. ` : ""}
            The approvers no longer need to decide it
            {returnStatus ? ` and the ticket goes back to “${returnStatus}”` : ""}. You can send it again.
          </DialogDescription>
        </DialogHeader>
        <textarea
          spellCheck
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Reason for withdrawing (optional)"
          rows={3}
          autoFocus
          placeholder="Reason (optional), e.g. picked the wrong approver"
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Hint label={busy ? "Withdrawing…" : ""}>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void onConfirm(reason.trim())}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Withdraw
            </Button>
          </Hint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
