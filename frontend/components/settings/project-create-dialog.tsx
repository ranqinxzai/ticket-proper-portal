"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Loader2 } from "lucide-react";

import { projectsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
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

import { ColorPicker } from "./color-picker";
import { FieldRow, fieldError } from "./field-row";
import { IconPicker } from "./icon-picker";

export function ProjectCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { org, helpdesk, helpdeskKey, refresh } = useWorkspace();
  const baseId = useId();

  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("folder-kanban");
  const [color, setColor] = useState("#6366f1");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!helpdesk || !name.trim() || !key.trim()) return;
    setBusy(true);
    setErrors({});
    try {
      const created = await projectsApi.create({
        helpdesk: helpdesk.id,
        name: name.trim(),
        key: key.trim().toUpperCase(),
        description: description.trim(),
        project_type: "custom",
        color,
        icon,
      });
      toast.success(`Project ${created.key} created.`);
      await refresh();
      onOpenChange(false);
      setName("");
      setKey("");
      setDescription("");
      router.push(`/t/${org}/agent/w/${helpdeskKey}/settings/projects/${created.key}`);
    } catch (err) {
      if (err instanceof ItsmApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        toast.error(err.message);
      } else {
        toast.error("Could not create the project.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New custom project</DialogTitle>
          <DialogDescription>
            Incident and Request projects are seeded one-per-helpdesk; here you add a custom project.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <FieldRow label="Name" htmlFor={`${baseId}-name`} error={fieldError(errors, "name")} required>
            <Input
              id={`${baseId}-name`}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Change Requests"
            />
          </FieldRow>

          <FieldRow
            label="Key"
            htmlFor={`${baseId}-key`}
            error={fieldError(errors, "key")}
            required
            hint="2–10 uppercase letters/digits; becomes the ticket-number prefix."
          >
            <Input
              id={`${baseId}-key`}
              value={key}
              disabled={busy}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              className="w-44 font-mono"
              maxLength={10}
              placeholder="ITCHG"
            />
          </FieldRow>

          <FieldRow label="Description" htmlFor={`${baseId}-desc`}>
            <textarea
              id={`${baseId}-desc`}
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            />
          </FieldRow>

          <FieldRow label="Icon">
            <IconPicker value={icon} onChange={setIcon} disabled={busy} />
          </FieldRow>

          <FieldRow label="Colour">
            <ColorPicker value={color} onChange={setColor} disabled={busy} />
          </FieldRow>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
