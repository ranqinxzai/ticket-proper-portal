"use client";

import { useEffect, useState } from "react";
import { Send, Loader2, Lock, Globe, StickyNote } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RichTextEditor } from "./RichTextEditor";
import { initials, relTime } from "./ticket-bits";
import { ticketsApi, cannedNotesApi } from "@/lib/itsm/api";
import type { CannedNote, CommentVisibility, TicketComment } from "@/lib/itsm/types";
import { cn } from "@/lib/utils";

export function CommentSection({ ticketId }: { ticketId: string }) {
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibility, setVisibility] = useState<CommentVisibility>("public");
  const [html, setHtml] = useState("");
  const [empty, setEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [canned, setCanned] = useState<CannedNote[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ticketsApi
      .comments(ticketId)
      .then((rows) => !cancelled && setComments(rows))
      .catch(() => !cancelled && setComments([]))
      .finally(() => !cancelled && setLoading(false));
    cannedNotesApi.list().then((rows) => !cancelled && setCanned(rows)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  function insertCanned(note: CannedNote) {
    // Append the canned note body to whatever is already there.
    setHtml((prev) => (prev && !empty ? `${prev}${note.body_html}` : note.body_html));
    setResetKey((k) => k + 1);
    setEmpty(false);
  }

  async function submit() {
    if (empty) {
      toast.error("Comment can't be empty");
      return;
    }
    setBusy(true);
    try {
      const created = await ticketsApi.addComment(ticketId, { body_html: html, visibility });
      setComments((prev) => [...prev, created]);
      setHtml("");
      setEmpty(true);
      setResetKey((k) => k + 1);
      toast.success(visibility === "private" ? "Internal note added" : "Comment posted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to post comment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Thread */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading comments…
        </div>
      ) : comments.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No comments yet. Start the conversation below.
        </div>
      ) : (
        <div className="space-y-4">
          {comments.map((c) => (
            <CommentRow key={c.id} comment={c} />
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="space-y-2">
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 text-sm">
          <VisTab active={visibility === "public"} onClick={() => setVisibility("public")} icon={<Globe className="h-3.5 w-3.5" />} label="Public reply" />
          <VisTab active={visibility === "private"} onClick={() => setVisibility("private")} icon={<Lock className="h-3.5 w-3.5" />} label="Internal note" />
        </div>

        <RichTextEditor
          value={html}
          resetKey={resetKey}
          placeholder={visibility === "private" ? "Write an internal note (not visible to requestor)…" : "Write a public reply…"}
          onChange={(h, isEmpty) => {
            setHtml(h);
            setEmpty(isEmpty);
          }}
        />

        <div className="flex items-center justify-between">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5">
                <StickyNote className="h-3.5 w-3.5" /> Canned note
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-72 w-64 overflow-y-auto">
              <DropdownMenuLabel>Insert canned note</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {canned.length === 0 && <DropdownMenuItem disabled>None available</DropdownMenuItem>}
              {canned.map((n) => (
                <DropdownMenuItem key={n.id} onClick={() => insertCanned(n)} className="truncate">
                  {n.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button onClick={submit} size="sm" disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {visibility === "private" ? "Add note" : "Comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function VisTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors",
        active ? "bg-white text-foreground shadow" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function CommentRow({ comment }: { comment: TicketComment }) {
  const isPrivate = comment.visibility === "private";
  const name = comment.author?.full_name || comment.author?.username || "Unknown";
  return (
    <div className="flex gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
        {initials(name)}
      </span>
      <div className={cn("min-w-0 flex-1 rounded-lg border p-3", isPrivate && "border-amber-200 bg-amber-50")}>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-medium">{name}</span>
          {isPrivate && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              <Lock className="h-3 w-3" /> Internal
            </span>
          )}
          <span className="text-xs text-muted-foreground" title={comment.created_at}>{relTime(comment.created_at)}</span>
          {comment.edited_at && <span className="text-xs text-muted-foreground">· edited</span>}
        </div>
        <div
          className="prose prose-sm max-w-none [&_a]:text-indigo-600 [&_a]:underline [&_ul]:list-disc [&_ol]:list-decimal"
          // Server-sanitised (bleach) per API_DESIGN.md §6.
          dangerouslySetInnerHTML={{ __html: comment.body_html }}
        />
      </div>
    </div>
  );
}
