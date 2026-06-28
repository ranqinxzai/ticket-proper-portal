"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { helpdesksApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useItsmAuth } from "@/lib/itsm/auth";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import type { Helpdesk } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

import { ColorPicker } from "./color-picker";
import { FieldRow, fieldError } from "./field-row";
import { IconPicker } from "./icon-picker";

export function HelpdeskConfigForm({
  helpdesk,
  canEdit,
}: {
  helpdesk: Helpdesk;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { org, refresh } = useWorkspace();
  const { hasPerm } = useItsmAuth();
  void hasPerm;
  const baseId = useId();

  const [name, setName] = useState(helpdesk.name);
  const [key, setKey] = useState(helpdesk.key);
  const [description, setDescription] = useState(helpdesk.description ?? "");
  const [icon, setIcon] = useState(helpdesk.icon ?? "");
  const [color, setColor] = useState(helpdesk.color ?? "#6366f1");
  const [status, setStatus] = useState(helpdesk.status ?? "active");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [confirmKey, setConfirmKey] = useState(false);

  const keyChanged = key.trim().toUpperCase() !== helpdesk.key;
  const dirty =
    name !== helpdesk.name ||
    keyChanged ||
    description !== (helpdesk.description ?? "") ||
    icon !== (helpdesk.icon ?? "") ||
    color !== (helpdesk.color ?? "#6366f1") ||
    status !== (helpdesk.status ?? "active");

  async function save() {
    setBusy(true);
    setErrors({});
    const nextKey = key.trim().toUpperCase();
    try {
      await helpdesksApi.update(helpdesk.id, {
        name: name.trim(),
        key: nextKey,
        description: description.trim(),
        icon,
        color,
        status,
      });
      toast.success("Helpdesk updated.");
      await refresh();
      if (keyChanged) {
        // The helpdesk key is in the route — move to the new path.
        router.replace(`/t/${org}/agent/w/${nextKey}/settings/helpdesk`);
      }
    } catch (err) {
      if (err instanceof ItsmApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        toast.error(err.message);
      } else {
        toast.error("Could not update the helpdesk.");
      }
    } finally {
      setBusy(false);
      setConfirmKey(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !key.trim()) return;
    if (keyChanged) {
      setConfirmKey(true);
      return;
    }
    void save();
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <FieldRow label="Name" htmlFor={`${baseId}-name`} error={fieldError(errors, "name")} required>
        <Input
          id={`${baseId}-name`}
          value={name}
          disabled={!canEdit || busy}
          onChange={(e) => setName(e.target.value)}
        />
      </FieldRow>

      <FieldRow
        label="Ticket prefix"
        htmlFor={`${baseId}-key`}
        error={fieldError(errors, "key")}
        required
        hint="2–5 uppercase letters/digits. Used as the ticket-number prefix (e.g. IT → ITINC-1)."
      >
        <Input
          id={`${baseId}-key`}
          value={key}
          disabled={!canEdit || busy}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          className="w-40 font-mono"
          maxLength={5}
        />
      </FieldRow>

      {keyChanged ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Changing the prefix won&apos;t renumber existing tickets — they keep their current numbers
            (e.g. <span className="font-mono">{helpdesk.key}INC-1</span>). Only new projects/tickets use
            the new prefix, and this helpdesk&apos;s URL changes.
          </span>
        </div>
      ) : null}

      <FieldRow label="Description" htmlFor={`${baseId}-desc`} error={fieldError(errors, "description")}>
        <textarea
          id={`${baseId}-desc`}
          value={description}
          disabled={!canEdit || busy}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </FieldRow>

      <FieldRow label="Status" htmlFor={`${baseId}-status`}>
        <Select value={status} onValueChange={setStatus} disabled={!canEdit || busy}>
          <SelectTrigger id={`${baseId}-status`} className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>

      <FieldRow label="Icon" error={fieldError(errors, "icon")}>
        <IconPicker value={icon} onChange={setIcon} disabled={!canEdit || busy} />
      </FieldRow>

      <FieldRow label="Colour" error={fieldError(errors, "color")}>
        <ColorPicker value={color} onChange={setColor} disabled={!canEdit || busy} />
      </FieldRow>

      {canEdit ? (
        <div className="flex items-center gap-2 pt-2">
          <Button type="submit" disabled={busy || !dirty}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      ) : null}

      <Dialog open={confirmKey} onOpenChange={(o) => !o && setConfirmKey(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change the ticket prefix?</DialogTitle>
            <DialogDescription>
              You&apos;re changing the prefix from{" "}
              <span className="font-mono font-medium">{helpdesk.key}</span> to{" "}
              <span className="font-mono font-medium">{key.trim().toUpperCase()}</span>. Existing tickets
              keep their current numbers; only new ones use the new prefix. This helpdesk&apos;s URL will
              also change.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmKey(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Change prefix
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
