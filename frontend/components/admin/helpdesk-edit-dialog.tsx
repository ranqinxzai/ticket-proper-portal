"use client";

import { useEffect, useId, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { helpdesksApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useItsmAuth } from "@/lib/itsm/auth";
import type { Helpdesk } from "@/lib/itsm/types";
import { HELPDESK_STATUS_SUMMARY } from "@/lib/itsm/help/admin";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColorPicker } from "@/components/settings/color-picker";
import { FieldRow, fieldError } from "@/components/settings/field-row";
import { IconPicker } from "@/components/settings/icon-picker";

/** Edit a helpdesk's core config (name / prefix / description / icon / colour / status)
 * from Admin → Helpdesks. Used for INACTIVE helpdesks: their workspace settings page
 * can't open (the workspace resolves helpdesks from `auth/me`, which lists active
 * ones only), but managers may still PATCH them (HelpdeskViewSet is unclamped for
 * managers). Active helpdesks keep the full Settings → Helpdesk Config page. */
export function HelpdeskEditDialog({
  helpdesk,
  onOpenChange,
  onSaved,
}: {
  /** The helpdesk to edit; `null` closes the dialog. */
  helpdesk: Helpdesk | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { refreshUser } = useItsmAuth();
  const baseId = useId();

  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState("#e60053");
  const [status, setStatus] = useState("inactive");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!helpdesk) return;
    setName(helpdesk.name);
    setKey(helpdesk.key);
    setDescription(helpdesk.description ?? "");
    setIcon(helpdesk.icon ?? "");
    setColor(helpdesk.color ?? "#e60053");
    setStatus(helpdesk.status ?? "inactive");
    setErrors({});
  }, [helpdesk]);

  const keyChanged = Boolean(helpdesk) && key.trim().toUpperCase() !== helpdesk?.key;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!helpdesk || !name.trim() || !key.trim()) return;
    setBusy(true);
    setErrors({});
    try {
      await helpdesksApi.update(helpdesk.id, {
        name: name.trim(),
        key: key.trim().toUpperCase(),
        description: description.trim(),
        icon,
        color,
        status,
      });
      toast.success("Helpdesk updated.");
      await refreshUser();
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ItsmApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        toast.error(err.message);
      } else {
        toast.error("Could not update the helpdesk.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(helpdesk)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {helpdesk?.name ?? "helpdesk"}</DialogTitle>
          <DialogDescription>
            Name, ticket prefix, icon and status. Projects, groups and mailboxes are edited in the
            helpdesk&apos;s Settings once it&apos;s active.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <FieldRow label="Name" htmlFor={`${baseId}-name`} error={fieldError(errors, "name")} required>
            <Input
              id={`${baseId}-name`}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </FieldRow>

          <FieldRow
            label="Ticket prefix"
            htmlFor={`${baseId}-key`}
            error={fieldError(errors, "key")}
            required
            hint="2–5 uppercase letters/digits; the ticket-number prefix."
          >
            <Input
              id={`${baseId}-key`}
              value={key}
              disabled={busy}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              className="w-40 font-mono"
              maxLength={5}
            />
          </FieldRow>
          {keyChanged ? (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Existing tickets keep their numbers. The helpdesk&apos;s URL changes to the new prefix.
            </p>
          ) : null}

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

          <FieldRow
            label="Status"
            htmlFor={`${baseId}-status`}
            error={fieldError(errors, "status")}
            info={HELPDESK_STATUS_SUMMARY}
          >
            <Select value={status} onValueChange={setStatus} disabled={busy}>
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

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Hint label={!name.trim() || !key.trim() ? "Enter a name and a ticket prefix first" : ""}>
              <Button type="submit" disabled={busy || !name.trim() || !key.trim()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Save changes
              </Button>
            </Hint>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
