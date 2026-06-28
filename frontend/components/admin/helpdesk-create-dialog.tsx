"use client";

import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { helpdesksApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useItsmAuth } from "@/lib/itsm/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ColorPicker } from "@/components/settings/color-picker";
import { FieldRow, fieldError } from "@/components/settings/field-row";
import { IconPicker } from "@/components/settings/icon-picker";

/** Create a new helpdesk. On success refreshes the user (so the new helpdesk
 * appears on Home) and calls `onCreated` to refetch the admin list. */
export function HelpdeskCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { refreshUser } = useItsmAuth();
  const baseId = useId();

  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("headset");
  const [color, setColor] = useState("#6366f1");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function reset() {
    setName("");
    setKey("");
    setDescription("");
    setIcon("headset");
    setColor("#6366f1");
    setErrors({});
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !key.trim()) return;
    setBusy(true);
    setErrors({});
    try {
      const created = await helpdesksApi.create({
        name: name.trim(),
        key: key.trim().toUpperCase(),
        description: description.trim(),
        icon,
        color,
      });
      toast.success(`Helpdesk ${created.key} created.`);
      await refreshUser();
      onCreated();
      onOpenChange(false);
      reset();
    } catch (err) {
      if (err instanceof ItsmApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        toast.error(err.message);
      } else {
        toast.error("Could not create the helpdesk.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New helpdesk</DialogTitle>
          <DialogDescription>
            A helpdesk is a department workspace with its own Incident + Request projects. It appears
            on Home for its members.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <FieldRow label="Name" htmlFor={`${baseId}-name`} error={fieldError(errors, "name")} required>
            <Input
              id={`${baseId}-name`}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Legal Helpdesk"
            />
          </FieldRow>

          <FieldRow
            label="Ticket prefix"
            htmlFor={`${baseId}-key`}
            error={fieldError(errors, "key")}
            required
            hint="2–5 uppercase letters/digits; becomes the ticket-number prefix (e.g. LEG → LEGINC-1)."
          >
            <Input
              id={`${baseId}-key`}
              value={key}
              disabled={busy}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              className="w-40 font-mono"
              maxLength={5}
              placeholder="LEG"
            />
          </FieldRow>

          <FieldRow label="Description" htmlFor={`${baseId}-desc`} error={fieldError(errors, "description")}>
            <textarea
              id={`${baseId}-desc`}
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            />
          </FieldRow>

          <FieldRow label="Icon" error={fieldError(errors, "icon")}>
            <IconPicker value={icon} onChange={setIcon} disabled={busy} />
          </FieldRow>

          <FieldRow label="Colour" error={fieldError(errors, "color")}>
            <ColorPicker value={color} onChange={setColor} disabled={busy} />
          </FieldRow>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create helpdesk
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
