"use client";

/**
 * Composer inserter for canned responses. A small "Canned response" button that
 * opens a searchable dropdown of the current helpdesk's snippets; picking one
 * calls `onInsert(body_html)` (the parent drops it into the reply editor at the
 * cursor) and increments the snippet's `usage_count` via the `use/` action.
 *
 * Visibility is enforced server-side — `cannedNotesApi.list({ helpdesk })` only
 * returns notes the agent may see (their helpdesk's shared notes, org-wide shared
 * notes, and their own personal notes); a forged helpdesk can't widen it.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageSquareText, Search } from "lucide-react";
import { toast } from "sonner";

import { cannedNotesApi } from "@/lib/itsm/api";
import type { CannedNote } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function CannedResponsePicker({
  helpdeskId,
  onInsert,
  disabled,
}: {
  /** Current helpdesk — scopes the list (and the server re-clamps it). */
  helpdeskId: string;
  /** Insert the chosen snippet's sanitised HTML into the composer. */
  onInsert: (html: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<CannedNote[]>([]);
  const [loading, setLoading] = useState(false);

  // (Re)load on every open so freshly-created snippets show up; prior results
  // stay visible while refetching (spinner only).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    cannedNotesApi
      .list({ helpdesk: helpdeskId })
      .then((rows) => {
        if (!cancelled) setNotes(rows);
      })
      .catch(() => {
        if (!cancelled) toast.error("Couldn't load canned responses.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, helpdeskId]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(term) ||
        n.shortcut.toLowerCase().includes(term) ||
        n.body_text.toLowerCase().includes(term),
    );
  }, [notes, q]);

  // Group by category for readable scanning; uncategorised falls to the bottom.
  const groups = useMemo(() => {
    const map = new Map<string, CannedNote[]>();
    for (const n of filtered) {
      const key = n.category_name || "Uncategorized";
      const arr = map.get(key);
      if (arr) arr.push(n);
      else map.set(key, [n]);
    }
    return [...map.entries()];
  }, [filtered]);

  function select(note: CannedNote) {
    onInsert(note.body_html);
    // Fire-and-forget usage tracking — a failure here must not block the insert.
    cannedNotesApi.use(note.id).catch(() => {});
    toast.success(`“${note.title}” inserted.`);
    setOpen(false);
    setQ("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled}>
          <MessageSquareText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Canned response
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a response…"
            aria-label="Search canned responses"
            className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
          />
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
        </div>
        <div className="max-h-72 overflow-auto py-1">
          {groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : q.trim() ? "No matches." : "No canned responses yet."}
            </p>
          ) : (
            groups.map(([category, items]) => (
              <div key={category} className="py-0.5">
                <p className="px-3 pb-0.5 pt-1.5 text-xs font-medium text-muted-foreground">{category}</p>
                {items.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => select(note)}
                    className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-medium">{note.title}</span>
                    {note.shortcut ? (
                      <span className="text-xs text-muted-foreground">/{note.shortcut}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
