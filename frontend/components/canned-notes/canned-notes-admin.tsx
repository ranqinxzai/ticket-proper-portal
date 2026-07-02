"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquareText, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cannedNoteCategoriesApi, cannedNotesApi } from "@/lib/itsm/api";
import type { CannedNote, CannedNoteCategory } from "@/lib/itsm/types";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { SettingsSection } from "@/components/settings/settings-section";
import { CannedNoteDialog } from "./canned-note-dialog";

/** Canned-response library for one helpdesk: list, create, edit and (supervisor)
 *  delete reusable reply snippets. Every response is shared with everyone who
 *  staffs this helpdesk. */
export function CannedNotesAdmin({
  helpdesk,
  canCreate,
  canUpdate,
  canDelete,
}: {
  helpdesk: { id: string; name: string };
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const [items, setItems] = useState<CannedNote[]>([]);
  const [categories, setCategories] = useState<CannedNoteCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CannedNote | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [notes, cats] = await Promise.all([
        cannedNotesApi.list({ helpdesk: helpdesk.id }),
        cannedNoteCategoriesApi.list(),
      ]);
      setItems(notes);
      setCategories(cats);
    } catch {
      toast.error("Could not load canned responses.");
    } finally {
      setLoading(false);
    }
  }, [helpdesk.id]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(note: CannedNote) {
    setEditing(note);
    setDialogOpen(true);
  }

  async function remove(note: CannedNote) {
    if (!window.confirm(`Delete the canned response “${note.title}”?`)) return;
    const prev = items;
    setBusyId(note.id);
    setItems((cur) => cur.filter((n) => n.id !== note.id));
    try {
      await cannedNotesApi.remove(note.id);
      toast.success("Canned response deleted.");
    } catch {
      setItems(prev); // revert on failure
      toast.error("Could not delete the canned response.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsSection
      title="Canned Responses"
      description={`Reusable reply snippets for the ${helpdesk.name} helpdesk — shared with everyone who staffs it.`}
      action={
        canCreate ? (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New response
          </Button>
        ) : null
      }
    >
      {!canCreate && !canUpdate ? <ReadOnlyBanner /> : null}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title="No canned responses yet"
          description="Save reusable reply snippets so everyone who staffs this helpdesk can answer common questions in one click."
          action={
            canCreate ? (
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                New response
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {items.map((note) => (
            <li
              key={note.id}
              className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-soft"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{note.title}</span>
                  {note.category_name ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {note.category_name}
                    </span>
                  ) : null}
                  {note.shortcut ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      /{note.shortcut}
                    </span>
                  ) : null}
                </div>
                {note.body_text ? (
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{note.body_text}</p>
                ) : null}
              </div>

              {canUpdate ? (
                <button
                  type="button"
                  onClick={() => openEdit(note)}
                  aria-label={`Edit ${note.title}`}
                  className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}

              {canDelete ? (
                <button
                  type="button"
                  onClick={() => remove(note)}
                  disabled={busyId === note.id}
                  aria-label={`Delete ${note.title}`}
                  className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {busyId === note.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <CannedNoteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        note={editing}
        categories={categories}
        helpdesk={helpdesk}
        onSaved={load}
      />
    </SettingsSection>
  );
}
