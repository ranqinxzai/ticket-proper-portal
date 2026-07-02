"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, FileQuestion, Paperclip, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/tickets/status-badge";
import { PortalFieldDisplay } from "@/components/portal/portal-field-display";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { portalApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type {
  PortalComment,
  PortalTicketDetail,
  PortalTransition,
  PortalWatcher,
  TicketAttachment,
} from "@/lib/itsm/types";

function when(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** True when an attachment is previewable as an image (drives the thumbnail). */
function isPortalImage(a: TicketAttachment): boolean {
  if (a.content_type?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(a.original_name || a.file || "");
}

/** Reopen (and any other portal-allowed) transition buttons. A transition with a
 *  note prompt opens a small reason dialog; otherwise it submits on click. */
function PortalReopenButtons({
  id,
  transitions,
  onReload,
}: {
  id: string;
  transitions: PortalTransition[];
  onReload: () => Promise<void>;
}) {
  const [pending, setPending] = useState<PortalTransition | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(tr: PortalTransition, comment?: string) {
    setBusy(true);
    try {
      await portalApi.transition(id, { transition_id: tr.id, comment: comment?.trim() || undefined });
      setPending(null);
      setReason("");
      await onReload();
      toast.success(`Moved to “${tr.to_status_name}”.`);
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not update this request.");
    } finally {
      setBusy(false);
    }
  }

  function click(tr: PortalTransition) {
    if (tr.note_prompt) {
      setReason("");
      setPending(tr);
    } else {
      void run(tr);
    }
  }

  if (transitions.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {transitions.map((tr) => (
          <Button key={tr.id} variant="outline" size="sm" disabled={busy} onClick={() => click(tr)}>
            {tr.name}
          </Button>
        ))}
      </div>
      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.note_heading || pending?.name || "Add a note"}</DialogTitle>
            <DialogDescription>
              {pending?.note_required ? "Please provide a reason to continue." : "Optionally add a note."}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="Add a note…"
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy || (!!pending?.note_required && !reason.trim())}
              onClick={() => pending && run(pending, reason)}
            >
              {pending?.name ?? "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Attachments card — image previews + download + upload (view/download/upload;
 *  portal has no delete by design — requestors hold create, not delete). */
function PortalAttachments({
  ticketNumber,
  attachments,
  onReload,
}: {
  ticketNumber: string;
  attachments: TicketAttachment[];
  onReload: () => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    setUploading(true);
    try {
      for (const f of list) await portalApi.uploadRequestAttachment(ticketNumber, f);
      await onReload();
      toast.success("File uploaded.");
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not upload the file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section aria-label="Attachments" className="rounded-xl border bg-card p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Attachments{attachments.length ? ` (${attachments.length})` : ""}
        </h2>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
        <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {uploading ? "Uploading…" : "Add file"}
        </Button>
      </div>
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attachments.</p>
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-md border bg-muted/30 p-1.5">
              {isPortalImage(a) ? (
                <a href={a.file} target="_blank" rel="noreferrer" className="shrink-0">
                  <img src={a.file} alt={a.original_name || "image"} className="h-10 w-10 rounded border object-cover" />
                </a>
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border bg-background">
                  <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm" title={a.original_name}>
                {a.original_name || "file"}
              </span>
              <a
                href={a.file}
                download
                target="_blank"
                rel="noreferrer"
                aria-label={`Download ${a.original_name || "file"}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Watchers card — add/remove by email (requestors can't browse the directory). */
function PortalWatchers({
  id,
  watchers,
  onReload,
}: {
  id: string;
  watchers: PortalWatcher[];
  onReload: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      await portalApi.addWatcher(id, email.trim());
      setEmail("");
      await onReload();
      toast.success("Watcher added.");
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not add that watcher.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(w: PortalWatcher) {
    setBusy(true);
    try {
      await portalApi.removeWatcher(id, w.id);
      await onReload();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not remove that watcher.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Watchers" className="rounded-xl border bg-card p-4 shadow-soft">
      <h2 className="mb-3 text-sm font-semibold">
        Watchers{watchers.length ? ` (${watchers.length})` : ""}
      </h2>
      {watchers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No watchers yet.</p>
      ) : (
        <ul className="space-y-1">
          {watchers.map((w) => (
            <li key={w.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <button
                type="button"
                aria-label={`Remove ${w.name}`}
                className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                disabled={busy}
                onClick={() => void remove(w)}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-3 flex items-center gap-2">
        <label htmlFor="watcher-email" className="sr-only">
          Add a watcher by email
        </label>
        <Input
          id="watcher-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="colleague@company.com"
          className="h-8 text-sm"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !email.trim()}>
          Add
        </Button>
      </form>
    </section>
  );
}

export default function PortalRequestDetail() {
  const { org, id } = useParams<{ org: string; id: string }>();
  const [ticket, setTicket] = useState<PortalTicketDetail | null>(null);
  const [comments, setComments] = useState<PortalComment[]>([]);
  const [transitions, setTransitions] = useState<PortalTransition[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [t, cs, trs] = await Promise.all([
      portalApi.request(id),
      portalApi.comments(id),
      portalApi.availableTransitions(id).catch(() => [] as PortalTransition[]),
    ]);
    setTicket(t);
    setComments(cs);
    setTransitions(trs);
  }, [id]);

  useEffect(() => {
    load()
      .catch(() => toast.error("Could not load this request."))
      .finally(() => setLoading(false));
  }, [load]);

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await portalApi.addComment(id, reply);
      setReply("");
      await load();
      toast.success("Reply sent.");
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not send your reply.");
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <div className="mx-auto max-w-5xl space-y-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-8 w-2/3" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  if (!ticket)
    return (
      <EmptyState
        icon={FileQuestion}
        title="Request not found"
        description="This request may have been removed or you don’t have access to it."
      />
    );

  const attachments = ticket.attachments ?? [];
  const watchers = ticket.watchers ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        href={`/t/${org}/portal/requests`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to my requests
      </Link>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">
            {ticket.ticket_number} · {ticket.helpdesk_name}
            {ticket.ticket_type_name ? ` · ${ticket.ticket_type_name}` : ""}
          </p>
          <h1 className="text-xl font-semibold tracking-tight">{ticket.summary}</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PortalReopenButtons id={id} transitions={transitions} onReload={load} />
          <StatusBadge name={ticket.status_name} category={ticket.status_category} color={ticket.status_color} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* main column */}
        <div className="space-y-5">
          {ticket.description_html ? (
            <div
              className="prose prose-sm max-w-none rounded-xl border bg-card p-4 shadow-soft dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: ticket.description_html }}
            />
          ) : null}

          <PortalFieldDisplay layout={ticket.layout} fields={ticket.fields} values={ticket.field_values} />

          <section aria-label="Conversation" className="rounded-xl border bg-card p-4 shadow-soft">
            <h2 className="mb-3 text-sm font-semibold">Conversation</h2>
            <ul className="space-y-3">
              {comments.length === 0 ? (
                <li className="text-sm text-muted-foreground">No replies yet.</li>
              ) : (
                comments.map((c) => (
                  <li key={c.id} className="rounded-md border bg-background p-3">
                    <p className="mb-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{c.author_name ?? "Support"}</span> ·{" "}
                      {when(c.created_at)}
                    </p>
                    <div
                      className="prose prose-sm max-w-none dark:prose-invert"
                      dangerouslySetInnerHTML={{ __html: c.body_html }}
                    />
                  </li>
                ))
              )}
            </ul>
            <form onSubmit={submitReply} className="mt-4 space-y-2">
              <label htmlFor="reply" className="sr-only">
                Add a reply
              </label>
              <textarea
                id="reply"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                placeholder="Add a reply…"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={busy || !reply.trim()}>
                  Send reply
                </Button>
              </div>
            </form>
          </section>
        </div>

        {/* sidebar */}
        <aside className="space-y-5">
          <PortalAttachments ticketNumber={ticket.ticket_number} attachments={attachments} onReload={load} />
          <PortalWatchers id={id} watchers={watchers} onReload={load} />
        </aside>
      </div>
    </div>
  );
}
