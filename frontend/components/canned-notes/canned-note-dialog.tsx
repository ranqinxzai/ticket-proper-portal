"use client";

import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { cannedNotesApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { CannedNote, CannedNoteCategory } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
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
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { FieldRow, fieldError } from "@/components/settings/field-row";

// Radix <SelectItem> cannot have an empty string value — use a sentinel for "None".
const NONE = "__none__";

/** Create or edit a canned response. Every response belongs to the current
 *  helpdesk (workspace-scoped + pinned to it) and is shared with everyone who
 *  staffs that helpdesk. */
export function CannedNoteDialog({
  open,
  onOpenChange,
  note,
  categories,
  helpdesk,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: CannedNote | null;
  categories: CannedNoteCategory[];
  helpdesk: { id: string; name: string };
  onSaved: () => void;
}) {
  const baseId = useId();
  const editing = Boolean(note);

  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [shortcut, setShortcut] = useState("");
  const [category, setCategory] = useState<string>(NONE);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  // Sync the form when the dialog opens (or switches to a different note).
  useEffect(() => {
    if (!open) return;
    setTitle(note?.title ?? "");
    setBodyHtml(note?.body_html ?? "");
    setShortcut(note?.shortcut ?? "");
    setCategory(note?.category ?? NONE);
    setErrors({});
  }, [open, note]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !bodyHtml.trim()) return;
    setBusy(true);
    setErrors({});
    const payload = {
      title: title.trim(),
      body_html: bodyHtml,
      shortcut: shortcut.trim(),
      category: category === NONE ? null : category,
      scope: "workspace" as const,
      helpdesk: helpdesk.id,
      project: null,
    };
    try {
      if (editing && note) {
        await cannedNotesApi.update(note.id, payload);
        toast.success("Canned response updated.");
      } else {
        await cannedNotesApi.create(payload);
        toast.success("Canned response created.");
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ItsmApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        toast.error(err.message);
      } else {
        toast.error("Could not save the canned response.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit canned response" : "New canned response"}</DialogTitle>
          <DialogDescription>
            A reusable reply snippet for the {helpdesk.name} helpdesk, shared with everyone who
            staffs it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <FieldRow label="Title" htmlFor={`${baseId}-title`} error={fieldError(errors, "title")} required>
            <Input
              id={`${baseId}-title`}
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Acknowledge receipt"
            />
          </FieldRow>

          <FieldRow label="Body" error={fieldError(errors, "body_html")} required>
            <RichTextEditor
              value={bodyHtml}
              onChange={setBodyHtml}
              minHeight={140}
              ariaLabel="Canned response body"
              placeholder="Write the reply snippet…"
            />
          </FieldRow>

          <div className="grid gap-5 sm:grid-cols-2">
            <FieldRow
              label="Shortcut"
              htmlFor={`${baseId}-shortcut`}
              error={fieldError(errors, "shortcut")}
              hint="Optional quick-type code (e.g. ack)."
            >
              <Input
                id={`${baseId}-shortcut`}
                value={shortcut}
                disabled={busy}
                onChange={(e) => setShortcut(e.target.value)}
                className="font-mono"
                placeholder="ack"
              />
            </FieldRow>

            <FieldRow label="Category" error={fieldError(errors, "category")}>
              <Select value={category} onValueChange={setCategory} disabled={busy}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editing ? "Save changes" : "Create response"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
