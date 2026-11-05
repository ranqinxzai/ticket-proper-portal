"use client";

/**
 * Composer inserter for canned responses. A small "Canned response" button that
 * opens a searchable dropdown of the current helpdesk's snippets; picking one
 * calls `onInsert(body_html)` (the parent drops it into the reply editor at the
 * cursor) and increments the snippet's `usage_count` via the `use/` action.
 *
 * Visibility is enforced server-side — `cannedNotesApi.list({ for_helpdesk })` returns
 * this helpdesk's shared notes, org-wide shared notes and the agent's own personal notes
 * (the old exact `?helpdesk=` filter hid the last two); the server clamp means a forged
 * helpdesk can't widen it. Results are grouped by scope (Personal / Project / Helpdesk /
 * Organisation) with a badge saying who can see each one.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageSquareText, Search } from "lucide-react";
import { toast } from "sonner";

import { cannedNotesApi } from "@/lib/itsm/api";
import type { CannedNote } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CANNED_SCOPE_HELP } from "@/lib/itsm/help/ticket";
import {
  CANNED_SCOPE_ORDER,
  CANNED_SCOPE_TITLE,
  CannedScopeBadge,
  cannedScopeOf,
  type CannedScopeGroup,
} from "./scope-badge";

const GROUP_HELP: Record<CannedScopeGroup, string> = {
  personal: CANNED_SCOPE_HELP.personal,
  project: "Tagged to one project — everyone in this helpdesk can use them.",
  helpdesk: CANNED_SCOPE_HELP.helpdesk("this"),
  organisation: CANNED_SCOPE_HELP.organisation,
};

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
      .list({ for_helpdesk: helpdeskId, page_size: 200 })
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

  // Group by scope (who can see it), in CANNED_SCOPE_ORDER; within a group sort by
  // category then title so related snippets sit together.
  const groups = useMemo(() => {
    const map = new Map<CannedScopeGroup, CannedNote[]>();
    for (const n of filtered) {
      const key = cannedScopeOf(n);
      const arr = map.get(key);
      if (arr) arr.push(n);
      else map.set(key, [n]);
    }
    return CANNED_SCOPE_ORDER.filter((g) => map.has(g)).map((g) => {
      const items = [...(map.get(g) ?? [])].sort(
        (a, b) =>
          (a.category_name || "~").localeCompare(b.category_name || "~") || a.title.localeCompare(b.title),
      );
      return [g, items] as const;
    });
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
      {/* Hint outside PopoverTrigger: the tooltip trigger slots onto the popover trigger. */}
      <Hint label="Insert a saved reply at the cursor">
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="outline" disabled={disabled}>
            <MessageSquareText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Canned response
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent className="w-96 p-0" align="start">
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
            groups.map(([group, items]) => (
              <div key={group} className="py-0.5">
                <p className="flex items-center gap-1 px-3 pb-0.5 pt-1.5 text-xs font-medium text-muted-foreground">
                  {CANNED_SCOPE_TITLE[group]}
                  <InfoTip label={`Who can see ${CANNED_SCOPE_TITLE[group].toLowerCase()} responses?`}>
                    {GROUP_HELP[group]}
                  </InfoTip>
                </p>
                {items.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => select(note)}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span className="flex w-full min-w-0 items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-medium" title={note.title}>{note.title}</span>
                      <CannedScopeBadge note={note} className="shrink-0" />
                    </span>
                    {note.shortcut || note.category_name ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {note.shortcut ? <span>/{note.shortcut}</span> : null}
                        {note.category_name ? <span>· {note.category_name}</span> : null}
                      </span>
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
