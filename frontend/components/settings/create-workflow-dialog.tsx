"use client";

import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";

import { workflowsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { Workflow } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

import { FieldRow, fieldError } from "./field-row";

/**
 * Create a NEW, immediately-valid starter workflow (To Do → In Progress → Done + a create
 * transition). Only creates the workflow and calls `onCreated(wf)` — the caller decides how to
 * link it (Workflow tab: `projectsApi.update` + refresh; Overview tab: select it in the dropdown).
 * Module-scope component so it's never re-created on parent re-render (avoids input focus loss).
 */
export function CreateWorkflowDialog({
  open,
  onOpenChange,
  defaultName = "",
  baseType,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName?: string;
  baseType?: string;
  onCreated: (workflow: Workflow) => void | Promise<void>;
}) {
  const baseId = useId();
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  // Reseed the name each time the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setErrors({});
    }
  }, [open, defaultName]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setErrors({});
    try {
      const wf = await workflowsApi.createStarter({ name: name.trim(), base_type: baseType });
      await onCreated(wf);
      onOpenChange(false);
      toast.success(`Workflow “${wf.name}” created.`);
    } catch (err) {
      if (err instanceof ItsmApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        toast.error(err.message);
      } else {
        toast.error("Could not create the workflow.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create workflow</DialogTitle>
          <DialogDescription>
            Starts a minimal <span className="font-medium">To&nbsp;Do → In&nbsp;Progress → Done</span>{" "}
            workflow you can edit here — add statuses and transitions once it&rsquo;s created.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <FieldRow label="Name" htmlFor={`${baseId}-name`} error={fieldError(errors, "name")} required>
            <Input
              id={`${baseId}-name`}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Change Management"
              autoFocus
            />
          </FieldRow>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create workflow
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
