"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ticketsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { TicketDetail, Transition } from "@/lib/itsm/types";

/**
 * Runs a workflow transition. On 422 (mandatory screen fields missing) it
 * re-renders inline inputs for the offending fields and lets the user retry.
 * On 409 (stale) it surfaces a refresh prompt.
 */
export function TransitionDialog({
  ticketId,
  transition,
  open,
  onOpenChange,
  onDone,
  onStale,
}: {
  ticketId: string;
  transition: Transition | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: (t: TicketDetail) => void;
  onStale: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);

  function reset() {
    setComment("");
    setFields({});
    setMissing([]);
  }

  async function run() {
    if (!transition) return;
    setBusy(true);
    try {
      const updated = await ticketsApi.transition(ticketId, {
        transition_id: transition.id,
        fields: Object.keys(fields).length ? fields : undefined,
        comment: comment.trim() ? `<p>${comment.trim()}</p>` : undefined,
        comment_visibility: comment.trim() ? "public" : undefined,
      });
      toast.success(`Moved to ${transition.to_status_key}`);
      reset();
      onOpenChange(false);
      onDone(updated);
    } catch (e) {
      if (e instanceof ItsmApiError) {
        if (e.status === 409) {
          toast.error("This ticket already moved. Refreshing…");
          onOpenChange(false);
          onStale();
          return;
        }
        if (e.status === 422 && e.fieldErrors) {
          const keys = Object.keys(e.fieldErrors);
          setMissing(keys);
          toast.error(e.message || "Some fields are required for this transition.");
          return;
        }
      }
      toast.error(e instanceof Error ? e.message : "Transition failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{transition?.name ?? "Transition"}</DialogTitle>
          <DialogDescription>
            Move this ticket to <strong>{transition?.to_status_key}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {missing.map((key) => (
            <div key={key} className="grid gap-1.5">
              <Label htmlFor={`tf-${key}`} className="capitalize">
                {key.replace(/_/g, " ")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id={`tf-${key}`}
                value={fields[key] ?? ""}
                onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={`Enter ${key.replace(/_/g, " ")}`}
              />
            </div>
          ))}

          <div className="grid gap-1.5">
            <Label htmlFor="tf-comment">Comment (optional)</Label>
            <Input
              id="tf-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a note with this change…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {missing.length ? "Retry" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
