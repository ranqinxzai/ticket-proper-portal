"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Download, Eye, FileQuestion, Paperclip, Plus, Star, X } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/tickets/status-badge";
import { PortalFieldDisplay } from "@/components/portal/portal-field-display";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
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
import { cn } from "@/lib/utils";
import { MENTION_CHIP_CLS } from "@/components/ui/mention-styles";
import { ExpandableHtml } from "@/components/ui/expandable-html";
import {
  PORTAL_ADD_FILE_HELP,
  PORTAL_REOPEN_HELP,
  PORTAL_REOPEN_NOTE_HELP,
  PORTAL_REPLY_HELP,
  PORTAL_VIEWER_HELP,
  PORTAL_VIEWER_NOTE,
  PORTAL_WATCHERS_HELP,
  portalStatusHelp,
  portalTicketTypeHelp,
} from "@/lib/itsm/help/portal";
import type {
  PortalComment,
  PortalSurveyState,
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
          <Hint key={tr.id} label={/reopen/i.test(tr.name) ? PORTAL_REOPEN_HELP : ""}>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => click(tr)}>
              {tr.name}
            </Button>
          </Hint>
        ))}
      </div>
      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.note_heading || pending?.name || "Add a note"}</DialogTitle>
            <DialogDescription>
              {pending?.note_required ? "Please provide a reason to continue." : "Optionally add a note."}{" "}
              {PORTAL_REOPEN_NOTE_HELP}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label={pending?.note_heading || "Note"}
            rows={4}
            placeholder="Add a note…"
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Hint label={!busy && pending?.note_required && !reason.trim() ? "Add a reason first" : ""}>
              <Button
                size="sm"
                disabled={busy || (!!pending?.note_required && !reason.trim())}
                onClick={() => pending && run(pending, reason)}
              >
                {pending?.name ?? "Submit"}
              </Button>
            </Hint>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Attachments card — image previews + download + upload (view/download/upload;
 *  portal has no delete by design — requestors hold create, not delete). `readOnly`
 *  (approvers / watchers) hides the upload. */
function PortalAttachments({
  ticketNumber,
  attachments,
  onReload,
  readOnly,
}: {
  ticketNumber: string;
  attachments: TicketAttachment[];
  onReload: () => Promise<void>;
  readOnly?: boolean;
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
        {readOnly ? null : (
          <>
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
            <Hint label={uploading ? "Uploading your file…" : PORTAL_ADD_FILE_HELP}>
              <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {uploading ? "Uploading…" : "Add file"}
              </Button>
            </Hint>
          </>
        )}
      </div>
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attachments.</p>
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-md border bg-muted/30 p-1.5">
              {isPortalImage(a) ? (
                <a
                  href={a.file}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0"
                  title={`Open ${a.original_name || "image"} in a new tab`}
                >
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
              <Hint label={`Download ${a.original_name || "file"}`}>
                <a
                  href={a.file}
                  download
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Download ${a.original_name || "file"}`}
                  className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                </a>
              </Hint>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Watchers card — add/remove by email (requestors can't browse the directory).
 *  `readOnly` (approvers / watchers) shows the names only. */
function PortalWatchers({
  id,
  watchers,
  onReload,
  readOnly,
}: {
  id: string;
  watchers: PortalWatcher[];
  onReload: () => Promise<void>;
  readOnly?: boolean;
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
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        Watchers{watchers.length ? ` (${watchers.length})` : ""}
        <InfoTip label="What are watchers?">{PORTAL_WATCHERS_HELP}</InfoTip>
      </h2>
      {watchers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No watchers yet.</p>
      ) : (
        <ul className="space-y-1">
          {watchers.map((w) => (
            <li key={w.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={w.name}>
                {w.name}
              </span>
              {readOnly ? null : (
                <IconButton
                  label={`Remove ${w.name}`}
                  detail={`Removes them right away — ${w.name} stops getting email updates on this request`}
                  disabledReason="Please wait…"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() => void remove(w)}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {readOnly ? null : (
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
        <Hint label={busy ? "" : !email.trim() ? "Enter an email address first" : "Add this person as a watcher"}>
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !email.trim()}>
            Add
          </Button>
        </Hint>
      </form>
      )}
    </section>
  );
}

export default function PortalRequestDetail() {
  const { org, id } = useParams<{ org: string; id: string }>();
  const router = useRouter();
  const [ticket, setTicket] = useState<PortalTicketDetail | null>(null);
  const [comments, setComments] = useState<PortalComment[]>([]);
  const [transitions, setTransitions] = useState<PortalTransition[]>([]);
  const [survey, setSurvey] = useState<PortalSurveyState | null>(null);
  const [loading, setLoading] = useState(true);
  // True while bouncing an OLD ticket number (the request was moved to another
  // project and re-keyed) to its current number — resolved via the backend alias.
  const [redirecting, setRedirecting] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const t = await portalApi.request(id);
    // The route `id` may be the UUID pk, the current number, or an OLD number that
    // the alias resolved. If it matches neither identity, canonicalise the URL.
    if (id !== t.id && id !== t.ticket_number) {
      setRedirecting(true);
      router.replace(`/t/${org}/portal/requests/${t.ticket_number}`);
      return;
    }
    // Approvers / watchers read only: no reopen or feedback calls for them.
    const isRequestor = (t.viewer_role ?? "requestor") === "requestor";
    const [cs, trs, sv] = await Promise.all([
      portalApi.comments(id),
      isRequestor
        ? portalApi.availableTransitions(id).catch(() => [] as PortalTransition[])
        : Promise.resolve([] as PortalTransition[]),
      isRequestor ? portalApi.survey(id).catch(() => null) : Promise.resolve(null),
    ]);
    setTicket(t);
    setComments(cs);
    setTransitions(trs);
    setSurvey(sv);
  }, [id, org, router]);

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

  if (loading || redirecting)
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
  // Only the requestor can reply, reopen, change watchers, upload or give feedback;
  // approvers and watchers read (the server enforces it too).
  const role = ticket.viewer_role ?? "requestor";
  const readOnly = role !== "requestor";
  const back =
    role === "approver"
      ? { href: `/t/${org}/portal/approvals`, label: "Back to approvals" }
      : role === "watcher"
        ? { href: `/t/${org}/portal`, label: "Back to Help Center home" }
        : { href: `/t/${org}/portal/requests`, label: "Back to my requests" };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        href={back.href}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {back.label}
      </Link>

      {role === "approver" || role === "watcher" ? (
        <p
          role="note"
          className="flex items-start gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {PORTAL_VIEWER_NOTE[role]}
            <InfoTip label="What can I see here?" className="ml-[-1px]">
              {PORTAL_VIEWER_HELP}
            </InfoTip>
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-1 font-mono text-xs text-muted-foreground">
            <span>
              {ticket.ticket_number} · {ticket.helpdesk_name}
              {ticket.ticket_type_name ? ` · ${ticket.ticket_type_name}` : ""}
            </span>
            <InfoTip label={`What does ${ticket.ticket_type_name ?? "this type"} mean?`}>
              {portalTicketTypeHelp(ticket.ticket_type_name)}
            </InfoTip>
          </p>
          <h1 className="text-xl font-semibold tracking-tight">{ticket.summary}</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PortalReopenButtons id={id} transitions={transitions} onReload={load} />
          <StatusBadge
            name={ticket.status_name}
            category={ticket.status_category}
            color={ticket.status_color}
            hint={portalStatusHelp(ticket.status_key, ticket.status_category)}
          />
        </div>
      </div>

      {survey?.enabled && survey.response?.status === "pending" && (
        <Link
          href={`/t/${org}/portal/requests/${id}/feedback`}
          className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-2 font-medium">
            <Star className="h-4 w-4 text-primary" aria-hidden="true" />
            How did we do? Share your feedback on this request.
          </span>
          <span className="shrink-0 font-medium text-primary">Give feedback →</span>
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* main column */}
        <div className="space-y-5">
          {ticket.description_html ? (
            <div className="rounded-xl border bg-card p-4 shadow-soft">
              {/* Long (email) descriptions: 6 lines + Show more. */}
              <ExpandableHtml html={ticket.description_html} className="prose prose-sm max-w-none dark:prose-invert" />
            </div>
          ) : null}

          <PortalFieldDisplay
            layout={ticket.layout}
            fields={ticket.fields}
            values={{ ...ticket.field_values, status: ticket.status_key }}
          />

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
                    <ExpandableHtml
                      html={c.body_html}
                      className={cn("prose prose-sm max-w-none dark:prose-invert", MENTION_CHIP_CLS)}
                    />
                  </li>
                ))
              )}
            </ul>
            {readOnly ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Only the person who raised this request can reply.
              </p>
            ) : (
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
                <Hint label={busy ? "Sending…" : !reply.trim() ? "Type a reply first" : PORTAL_REPLY_HELP}>
                  <Button type="submit" size="sm" disabled={busy || !reply.trim()}>
                    Send reply
                  </Button>
                </Hint>
              </div>
            </form>
            )}
          </section>
        </div>

        {/* sidebar */}
        <aside className="space-y-5">
          <PortalAttachments
            ticketNumber={ticket.ticket_number}
            attachments={attachments}
            onReload={load}
            readOnly={readOnly}
          />
          <PortalWatchers id={id} watchers={watchers} onReload={load} readOnly={readOnly} />
        </aside>
      </div>
    </div>
  );
}
