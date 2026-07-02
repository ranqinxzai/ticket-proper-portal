"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown, Download, Eye, Link2, Loader2, Lock, MessageSquare, Paperclip, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { CannedResponsePicker } from "@/components/canned-notes/canned-response-picker";
import { UserSearchCombobox } from "@/components/settings/user-search-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/ui/rich-text-editor";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useItsmAuth } from "@/lib/itsm/auth";
import { ItsmApiError } from "@/lib/itsm/client";
import { allowedGroupsForProject } from "@/lib/itsm/groups";
import { commentAttachmentsApi, fieldsApi, groupsApi, layoutsApi, ticketAttachmentsApi, ticketsApi, usersApi, watchersApi } from "@/lib/itsm/api";
import type {
  ActivityEvent,
  CommentAttachment,
  CommentVisibility,
  FieldDefinition,
  FieldLayoutItem,
  Group,
  Priority,
  RequestorAttribute,
  LinkType,
  StatusCategory,
  TicketAttachment,
  TicketComment,
  TicketDetail,
  TicketLink,
  TicketListItem,
  Transition,
  TransitionScreenField,
  UpdateTicketInput,
  UserRef,
  Watcher,
} from "@/lib/itsm/types";
import { ApprovalPanel } from "./approval-panel";
import { GroupMemberPicker } from "./group-member-picker";
import { PriorityTag } from "./priority-tag";
import { SlaPanel } from "./sla-panel";
import { StatusBadge } from "./status-badge";
import { TicketSearchCombobox } from "./ticket-search-combobox";

type Cfg = { maps_to?: string; levels?: string[] };
type Attachment = TicketAttachment;

/** True when an attachment is previewable as an image (drives the thumbnail). */
function isImageAttachment(a: Attachment): boolean {
  if (a.content_type?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(a.original_name || a.file || "");
}

const ACTION_VERB: Record<string, string> = {
  ticket_created: "created the ticket",
  status_changed: "changed status",
  assigned: "changed assignee",
  group_changed: "changed group",
  priority_changed: "changed priority",
  requestor_changed: "changed requestor",
  summary_changed: "edited the summary",
  description_changed: "edited the description",
  comment_added: "added a comment",
  field_changed: "updated a field",
  reopened: "reopened the ticket",
  closed: "closed the ticket",
  sla_started: "started the SLA timer",
  sla_paused: "paused the SLA timer",
  sla_resumed: "resumed the SLA timer",
  sla_breached: "breached an SLA",
  attachment_added: "added an attachment",
  attachment_removed: "removed an attachment",
  watcher_added: "added a watcher",
  watcher_removed: "removed a watcher",
  link_added: "linked a ticket",
  link_removed: "removed a ticket link",
  template_applied: "applied a template",
};

const PRIORITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Human-readable rendering of whatever a payload stored as an old/new "value". */
function activityValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.map(activityValue).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** The verb phrase for an activity row; `field_changed` names the custom field. */
function activityVerb(a: ActivityEvent): string {
  if (a.action === "field_changed") {
    const name = (a.payload as { name?: string } | null | undefined)?.name;
    return name ? `changed ${name}` : ACTION_VERB.field_changed;
  }
  return ACTION_VERB[a.action] ?? a.action.replace(/_/g, " ");
}

/** The "what changed" detail (old → new) for an activity row, or null when there's
 *  nothing meaningful to show. Reads the audit payload written at each write site. */
function activityDetail(a: ActivityEvent): string | null {
  const p = (a.payload ?? {}) as Record<string, unknown>;
  const fromTo = (from: unknown, to: unknown) => `${activityValue(from)} → ${activityValue(to)}`;
  switch (a.action) {
    case "status_changed":
      return p.from != null && p.to != null ? fromTo(p.from, p.to) : null;
    case "priority_changed":
      return fromTo(PRIORITY_LABEL[String(p.old)] ?? p.old, PRIORITY_LABEL[String(p.new)] ?? p.new);
    case "assigned":
    case "requestor_changed":
    case "group_changed":
      // Backend stores human-readable labels (value-at-the-time). Rows logged before
      // that only carry raw ids → show no (un-resolvable, misleading) detail.
      if (!("old_label" in p) && !("new_label" in p)) return null;
      return `${p.old_label ?? "Unassigned"} → ${p.new_label ?? "Unassigned"}`;
    case "field_changed":
      return fromTo(p.old, p.new);
    case "summary_changed":
      return p.new != null ? activityValue(p.new) : null;
    case "comment_added":
      return p.visibility === "private" ? "internal note" : null;
    case "closed":
      return p.status != null ? activityValue(p.status) : null;
    case "reopened":
      return p.to != null ? activityValue(p.to) : null;
    default:
      return null;
  }
}

const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

const selectCls =
  "h-8 max-w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const textareaCls =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function when(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

const regionOf = (i: FieldLayoutItem): "main" | "sidebar" => (i.region === "sidebar" ? "sidebar" : "main");

export function TicketDetailView({ ticketId, projectKey }: { ticketId: string; projectKey: string }) {
  const { org, helpdeskKey, helpdesk, projectByKey } = useWorkspace();
  const { hasPerm, user } = useItsmAuth();
  const meId = user?.id != null ? String(user.id) : null;
  const base = `/t/${org}/agent/w/${helpdeskKey}/p/${projectKey}`;
  // When the agent arrived from the combined "All Tickets" queue (row links carry
  // `?from=all`), "Back to queue" returns there rather than this project's queue.
  const searchParams = useSearchParams();
  const fromAll = searchParams.get("from") === "all";
  const backHref = fromAll ? `/t/${org}/agent/w/${helpdeskKey}/all` : base;
  const backLabel = fromAll ? "Back to all tickets" : "Back to queue";
  const canEdit = hasPerm("itsm.tickets", "update");
  // Internal (private) notes are gated by the same module that gates *reading* them
  // (server: `comments` list filters private out without it). Agent + Supervisor have it;
  // a Requestor does not — so they only ever see/post public comments.
  const canPostPrivate = hasPerm("itsm.tickets.comments_private", "read");
  // Canned responses: agents with read on the module get the composer inserter.
  const canCanned = hasPerm("itsm.canned_notes", "read");

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [layoutItems, setLayoutItems] = useState<FieldLayoutItem[]>([]);
  const [defsById, setDefsById] = useState<Record<string, FieldDefinition>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [links, setLinks] = useState<TicketLink[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentBody, setCommentBody] = useState("");
  // Composer visibility — default is a Public Comment; agents can switch to an Internal note.
  const [commentVisibility, setCommentVisibility] = useState<CommentVisibility>("public");
  const [busy, setBusy] = useState(false);
  // A transition configured with a note prompt opens this slide-over before moving.
  const [pendingTransition, setPendingTransition] = useState<Transition | null>(null);
  // Composer attachments — inline images (embedded by URL in the body) and files
  // (listed below the reply). Both are uploaded before the comment exists, then
  // associated on submit via `attachment_ids`.
  const [commentImages, setCommentImages] = useState<{ id: string; url: string }[]>([]);
  const [commentFiles, setCommentFiles] = useState<CommentAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  // Imperative handle to the reply editor — lets the canned-response picker
  // insert a snippet at the cursor (works for both public and internal notes).
  const commentEditorRef = useRef<RichTextEditorHandle>(null);

  // Inline-edit state: which field is currently saving + summary editor draft.
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");

  const load = useCallback(async () => {
    const t = await ticketsApi.get(ticketId);
    setTicket(t);
    const [trs, cs, act, layout, defs, atts, wchs, lks] = await Promise.all([
      ticketsApi.availableTransitions(ticketId),
      ticketsApi.comments(ticketId),
      ticketsApi.activity(ticketId),
      layoutsApi.resolve(t.project, t.ticket_type).catch(() => ({ id: null, items: [] as FieldLayoutItem[] })),
      fieldsApi.list(t.project).catch(() => [] as FieldDefinition[]),
      // Attachment / watcher / link endpoints key off the ticket UUID (FK pk), not the
      // readable number that routes the page — pass `t.id`, never `ticketId`.
      ticketAttachmentsApi.list(t.id).catch(() => [] as Attachment[]),
      ticketsApi.watchers(t.id).catch(() => [] as Watcher[]),
      ticketsApi.links(t.id).catch(() => [] as TicketLink[]),
    ]);
    setTransitions(trs);
    setComments(cs);
    setActivity(act);
    setLayoutItems((layout?.items ?? []).slice().sort((a, b) => a.sort_order - b.sort_order));
    setDefsById(Object.fromEntries(defs.map((d) => [d.id, d])));
    setAttachments(atts);
    setWatchers(wchs);
    setLinks(lks);
  }, [ticketId]);

  useEffect(() => {
    load()
      .catch(() => toast.error("Could not load ticket."))
      .finally(() => setLoading(false));
  }, [load]);

  // Groups for the assigned-group / group_picker controls (helpdesk + shared teams).
  useEffect(() => {
    if (!canEdit || !helpdesk?.id) return;
    groupsApi.list({ helpdesk: helpdesk.id, is_active: true }).then(setGroups).catch(() => setGroups([]));
  }, [canEdit, helpdesk?.id]);

  // Constrain the group controls to the project's whitelist (if any), but always
  // keep the ticket's current group so an existing assignment still displays.
  const project = projectByKey(projectKey);
  const allowedGroups = useMemo(
    () => (project ? allowedGroupsForProject(groups, project, [ticket?.assigned_group]) : groups),
    [groups, project, ticket?.assigned_group],
  );

  /** Persist standard (column-backed) fields, then refresh ticket + activity feed. */
  const patchColumn = useCallback(
    async (body: UpdateTicketInput, key: string) => {
      setSavingKey(key);
      try {
        const updated = await ticketsApi.update(ticketId, body);
        setTicket(updated);
        ticketsApi.activity(ticketId).then(setActivity).catch(() => undefined);
        toast.success("Saved.");
        return true;
      } catch (e) {
        toast.error(e instanceof ItsmApiError ? e.message : "Could not save the change.");
        return false;
      } finally {
        setSavingKey(null);
      }
    },
    [ticketId],
  );

  /** Persist a custom (value-backed) field via the field engine. */
  const saveCustom = useCallback(
    async (key: string, value: unknown) => {
      setSavingKey(`cf:${key}`);
      try {
        const updated = await ticketsApi.setFields(ticketId, { [key]: value });
        setTicket(updated);
        ticketsApi.activity(ticketId).then(setActivity).catch(() => undefined);
        toast.success("Saved.");
      } catch (e) {
        toast.error(e instanceof ItsmApiError ? e.message : "Could not save the change.");
      } finally {
        setSavingKey(null);
      }
    },
    [ticketId],
  );

  // A transition with a note prompt or a capture screen (e.g. Incident Resolve)
  // opens the slide-over; otherwise it moves at once.
  function doTransition(tr: Transition) {
    if (tr.note_prompt || (tr.screen_fields && tr.screen_fields.length > 0)) {
      setPendingTransition(tr);
    } else {
      void runTransition(tr);
    }
  }

  async function runTransition(tr: Transition, comment?: string, fields?: Record<string, unknown>) {
    setBusy(true);
    try {
      const body: {
        transition_id: string;
        comment?: string;
        comment_visibility?: string;
        fields?: Record<string, unknown>;
      } = { transition_id: tr.id };
      if (comment && comment.trim()) {
        body.comment = comment;
        body.comment_visibility = tr.note_visibility ?? "public";
      }
      if (fields && Object.keys(fields).length > 0) {
        body.fields = fields;
      }
      await ticketsApi.transition(ticketId, body);
      toast.success(`Moved to “${tr.name}”.`);
      setPendingTransition(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Transition failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSummary() {
    if (!summaryDraft.trim()) return;
    if (await patchColumn({ summary: summaryDraft.trim() }, "summary")) setEditingSummary(false);
  }

  /** Upload an inline image pasted/dropped/picked in the composer and return its
   *  absolute URL for the editor to embed (base64 is stripped server-side). */
  const handleCommentImage = useCallback(
    async (file: File): Promise<string | null> => {
      if (!ticket) return null;
      try {
        // Composer attachments key off the ticket UUID (FK pk), not the readable
        // number — passing `ticketId` here 500s the upload (invalid UUID).
        const att = await commentAttachmentsApi.upload(ticket.id, file, "image");
        setCommentImages((prev) => [...prev, { id: att.id, url: att.file }]);
        return att.file;
      } catch (err) {
        toast.error(err instanceof ItsmApiError ? err.message : "Could not upload image.");
        return null;
      }
    },
    [ticket],
  );

  /** Upload files chosen via the "Attach files" button as downloadable attachments. */
  async function attachFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (list.length === 0 || !ticket) return;
    setAttaching(true);
    try {
      for (const f of list) {
        // Upload keys off the ticket UUID (FK pk), not the readable number.
        const att = await commentAttachmentsApi.upload(ticket.id, f, "file");
        setCommentFiles((prev) => [...prev, att]);
      }
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not attach file.");
    } finally {
      setAttaching(false);
    }
  }

  function resetComposer() {
    setCommentBody("");
    setCommentImages([]);
    setCommentFiles([]);
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    const hasBody = !!commentBody.trim();
    if (!hasBody && commentFiles.length === 0) return;
    // A user without the internal-notes grant can only post public comments.
    const visibility: CommentVisibility = commentVisibility === "private" && canPostPrivate ? "private" : "public";
    // Only associate inline images still present in the body (a user may have
    // deleted one after upload) plus every file chip.
    const imageIds = commentImages.filter((img) => commentBody.includes(img.url)).map((img) => img.id);
    const attachment_ids = [...imageIds, ...commentFiles.map((f) => f.id)];
    setBusy(true);
    try {
      await ticketsApi.addComment(ticketId, { body_html: commentBody, visibility, attachment_ids });
      resetComposer();
      await load();
      toast.success(visibility === "private" ? "Internal note added." : "Comment added.");
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not add comment.");
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-7 w-2/3 max-w-md" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        </div>
      </div>
    );
  if (!ticket) return <p className="text-sm text-muted-foreground">Ticket not found.</p>;

  // Layout-driven field rows (skip hidden + summary — summary is the page title).
  const rows = layoutItems
    .filter((it) => !it.is_hidden && defsById[it.field])
    .map((it) => ({ item: it, def: defsById[it.field] }));
  const mainRows = rows.filter((r) => regionOf(r.item) === "main" && r.def.key !== "summary");
  const sideRows = rows.filter((r) => regionOf(r.item) === "sidebar" && r.def.key !== "summary");
  const mainSections = groupSections(mainRows);
  const sideSections = groupSections(sideRows);
  const t = ticket;

  const fieldProps = {
    ticket: t,
    attachments,
    canEdit,
    groups: allowedGroups,
    savingKey,
    onSaveColumn: patchColumn,
    onSaveCustom: saveCustom,
  };

  return (
    <div className="space-y-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {backLabel}
      </Link>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">{t.ticket_number}</p>
          {editingSummary ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Input
                autoFocus
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
                className="h-9 w-[28rem] max-w-full text-base font-semibold"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveSummary();
                  if (e.key === "Escape") setEditingSummary(false);
                }}
              />
              <Button size="sm" disabled={savingKey === "summary" || !summaryDraft.trim()} onClick={saveSummary}>
                Save
              </Button>
              <Button size="sm" variant="ghost" disabled={savingKey === "summary"} onClick={() => setEditingSummary(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{t.summary}</h1>
              {canEdit ? (
                <button
                  type="button"
                  aria-label="Edit summary"
                  className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    setSummaryDraft(t.summary);
                    setEditingSummary(true);
                  }}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <WatchersPopover
            ticketId={t.id}
            watchers={watchers}
            meId={meId}
            canEdit={canEdit}
            onChanged={setWatchers}
          />
          <AttachmentsPopover
            ticketId={t.id}
            attachments={attachments}
            canEdit={canEdit}
            onChanged={setAttachments}
          />
          {transitions.map((tr) => (
            <Button key={tr.id} variant="outline" size="sm" disabled={busy} onClick={() => doTransition(tr)}>
              {tr.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* main column — layout "main" fields, then comments + activity */}
        <div className="space-y-6">
          {mainSections.map((sec) => (
            <section key={sec.name} aria-label={sec.name} className="rounded-xl border bg-card shadow-soft p-4">
              <h2 className="mb-3 text-sm font-semibold">{sec.name}</h2>
              <div className="space-y-4">
                {sec.rows.map((r) => (
                  <FieldView key={r.item.id} def={r.def} block {...fieldProps} />
                ))}
              </div>
            </section>
          ))}

          {/* Comments + Activity in tabs at the bottom of the main column (JIRA-style). */}
          <Tabs defaultValue="comments" className="rounded-xl border bg-card shadow-soft">
            <TabsList className="m-2">
              <TabsTrigger value="comments">Comments{comments.length ? ` (${comments.length})` : ""}</TabsTrigger>
              <TabsTrigger value="activity">Activity{activity.length ? ` (${activity.length})` : ""}</TabsTrigger>
            </TabsList>

            <TabsContent value="comments" className="px-4 pb-4 pt-0">
              <ul className="space-y-3">
                {comments.length === 0 ? (
                  <li className="text-sm text-muted-foreground">No comments yet.</li>
                ) : (
                  comments.map((c) => (
                    <li key={c.id} className="rounded-md border bg-background p-3">
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{c.author?.full_name ?? "Someone"}</span>
                        {c.visibility === "private" ? (
                          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning">Internal</span>
                        ) : null}
                        <span>· {when(c.created_at)}</span>
                      </div>
                      <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: c.body_html }} />
                      {(c.attachments ?? []).some((a) => a.kind === "file") ? (
                        <ul className="mt-2 space-y-1 border-t pt-2">
                          {(c.attachments ?? [])
                            .filter((a) => a.kind === "file")
                            .map((a) => (
                              <li key={a.id}>
                                <a
                                  href={a.file}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                                >
                                  <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                                  {a.original_name || "file"}
                                </a>
                              </li>
                            ))}
                        </ul>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
              <form onSubmit={submitComment} className="mt-4 space-y-2">
                {/* Visibility selector — Public Comment is the default; agents may switch
                    to an Internal note (hidden from the requestor). Requestors don't see it. */}
                {canPostPrivate ? (
                  <div className="inline-flex rounded-md border p-0.5 text-sm" role="group" aria-label="Comment visibility">
                    <button
                      type="button"
                      onClick={() => setCommentVisibility("public")}
                      aria-pressed={commentVisibility === "public"}
                      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 ${
                        commentVisibility === "public"
                          ? "bg-secondary font-medium text-secondary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> Public Comment
                    </button>
                    <button
                      type="button"
                      onClick={() => setCommentVisibility("private")}
                      aria-pressed={commentVisibility === "private"}
                      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 ${
                        commentVisibility === "private"
                          ? "bg-warning/15 font-medium text-warning"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Lock className="h-3.5 w-3.5" /> Internal Note
                    </button>
                  </div>
                ) : null}
                <RichTextEditor
                  ref={commentEditorRef}
                  value={commentBody}
                  onChange={setCommentBody}
                  onImageUpload={handleCommentImage}
                  minHeight={96}
                  ariaLabel={commentVisibility === "private" ? "Add an internal note" : "Add a comment"}
                  placeholder={
                    commentVisibility === "private"
                      ? "Write an internal note (only agents can see this)…"
                      : "Write a public reply…"
                  }
                  className={commentVisibility === "private" ? "border-warning/40 bg-warning/10" : undefined}
                />

                {/* File attachments staged for this reply (inline images live in the body). */}
                {commentFiles.length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                    {commentFiles.map((f) => (
                      <li
                        key={f.id}
                        className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
                      >
                        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        <span className="max-w-[12rem] truncate">{f.original_name || "file"}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${f.original_name || "file"}`}
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => setCommentFiles((prev) => prev.filter((x) => x.id !== f.id))}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="flex items-center justify-between gap-2">
                  <input
                    ref={commentFileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void attachFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={attaching}
                      onClick={() => commentFileInputRef.current?.click()}
                    >
                      <Paperclip className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      {attaching ? "Attaching…" : "Attach files"}
                    </Button>
                    {canCanned && helpdesk?.id ? (
                      <CannedResponsePicker
                        helpdeskId={helpdesk.id}
                        disabled={busy}
                        onInsert={(html) => commentEditorRef.current?.insertContent(html)}
                      />
                    ) : null}
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={busy || attaching || (!commentBody.trim() && commentFiles.length === 0)}
                  >
                    {commentVisibility === "private" ? "Add internal note" : "Add comment"}
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="activity" className="px-4 pb-4 pt-0">
              <ul className="space-y-2 text-sm">
                {activity.length === 0 ? (
                  <li className="text-sm text-muted-foreground">No activity yet.</li>
                ) : (
                  activity.map((a) => {
                    const detail = activityDetail(a);
                    return (
                      <li key={a.id} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-muted-foreground">
                        <span className="font-medium text-foreground">{a.actor?.full_name ?? "System"}</span>
                        <span>{activityVerb(a)}</span>
                        {detail ? <span className="font-medium text-foreground">{detail}</span> : null}
                        <span className="text-xs">· {when(a.created_at)}</span>
                      </li>
                    );
                  })
                )}
              </ul>
            </TabsContent>
          </Tabs>
        </div>

        {/* details rail — workflow meta + layout "sidebar" fields */}
        <aside aria-label="Ticket details" className="space-y-3">
          <dl className="rounded-xl border bg-card shadow-soft p-4 text-sm">
            <Row label="Status">
              <StatusBadge name={t.status_name} category={t.status_category} color={t.status_color} />
            </Row>
          </dl>

          {sideSections.map((sec) => (
            <dl key={sec.name} className="rounded-xl border bg-card shadow-soft p-4 text-sm">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{sec.name}</p>
              {sec.rows.map((r) => {
                const isRequestor = ((r.def.config ?? {}) as { maps_to?: string }).maps_to === "requestor";
                const cells = [<FieldView key={r.item.id} def={r.def} {...fieldProps} />];
                // Collapsible requestor profile dropdown, inline under the Requestor row
                if (isRequestor) {
                  cells.push(
                    <RequestorProfile key={`rp-${r.item.id}`} user={t.requestor} attributes={t.requestor_attributes ?? []} />,
                  );
                }
                return cells;
              })}
            </dl>
          ))}

          <SlaPanel ticketId={t.id} />
          <ApprovalPanel ticketId={t.id} />

          <LinkedIssuesCard
            ticketId={t.id}
            org={org}
            links={links}
            canEdit={canEdit}
            onChanged={setLinks}
            onActivity={() => ticketsApi.activity(ticketId).then(setActivity).catch(() => undefined)}
          />

          {/* Ticket metadata — moved to the bottom, below the SLA/approval blocks. */}
          <dl className="rounded-xl border bg-card shadow-soft p-4 text-sm">
            <Row label="Type">{t.ticket_type_name ?? "—"}</Row>
            <Row label="Created">{when(t.created_at)}</Row>
            <Row label="Created by">{personWithEmail(t.created_by)}</Row>
            <Row label="Last updated">{when(t.updated_at)}</Row>
            <Row label="Updated by">{personWithEmail(t.updated_by)}</Row>
          </dl>
        </aside>
      </div>

      {pendingTransition ? (
        <TransitionNoteSheet
          transition={pendingTransition}
          busy={busy}
          onCancel={() => setPendingTransition(null)}
          onSubmit={(comment, fields) => void runTransition(pendingTransition, comment, fields)}
        />
      ) : null}
    </div>
  );
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const isEmptyScreenValue = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** One transition-screen field control, dispatched by the resolved field type
 *  (e.g. the Incident Resolve screen: Resolution Code / Root Cause / Workaround /
 *  Notes). Module-top-level for React focus stability. */
function ScreenFieldControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: TransitionScreenField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const id = `screen-${field.field_key}`;
  let control: ReactNode;
  switch (field.field_type) {
    case "dropdown":
    case "radio":
      control = (
        <select
          id={id}
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={selectCls}
        >
          <option value="">— Select —</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "checkbox":
      control = (
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            disabled={disabled}
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4"
          />
          Yes
        </label>
      );
      break;
    case "number":
      control = (
        <Input
          id={id}
          type="number"
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "multiline":
      control = (
        <textarea
          id={id}
          rows={3}
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={textareaCls}
        />
      );
      break;
    default:
      control = (
        <Input
          id={id}
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {field.name}
        {field.is_mandatory ? <span className="text-destructive"> *</span> : null}
      </label>
      {control}
    </div>
  );
}

/** Slide-over that captures a note and/or transition-screen fields when a transition
 *  prompts for them (e.g. Incident Resolve → Resolution Details). Module-top-level
 *  (React focus-stability); it owns the drafts, blocks submit while a mandatory note or
 *  screen field is empty, and hands back the heading-prefixed comment HTML + field values. */
function TransitionNoteSheet({
  transition,
  busy,
  onCancel,
  onSubmit,
}: {
  transition: Transition;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (commentHtml: string, fields: Record<string, unknown>) => void;
}) {
  const [note, setNote] = useState("");
  const [fieldVals, setFieldVals] = useState<Record<string, unknown>>({});
  const screenFields = transition.screen_fields ?? [];
  const heading = transition.note_heading?.trim() || transition.name;
  const isPrivate = transition.note_visibility === "private";
  const noteRequired = !!transition.note_required;
  const noteEmpty = !note.trim();
  const missingField = screenFields.some(
    (f) => f.is_mandatory && isEmptyScreenValue(fieldVals[f.field_key]),
  );
  const canSubmit = !busy && !(transition.note_prompt && noteRequired && noteEmpty) && !missingField;

  function submit() {
    if (!canSubmit) return;
    // Prefix the configured heading so the comment/activity log is self-describing.
    const comment = noteEmpty ? "" : `<p><strong>${escapeHtml(heading)}</strong></p>${note}`;
    const out: Record<string, unknown> = {};
    for (const f of screenFields) {
      if (fieldVals[f.field_key] !== undefined) out[f.field_key] = fieldVals[f.field_key];
    }
    onSubmit(comment, out);
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <SheetContent className="gap-0 p-0">
        <SheetHeader>
          <SheetTitle>{heading}</SheetTitle>
          <SheetDescription>
            Moving to “{transition.name}”.
            {transition.note_prompt
              ? ` ${noteRequired ? "A note is required." : "Add a note (optional)."} ${
                  isPrivate ? "Saved as an internal note (agents only)." : "Added as a public comment."
                }`
              : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {screenFields.map((f) => (
            <ScreenFieldControl
              key={f.field_key}
              field={f}
              value={fieldVals[f.field_key]}
              onChange={(v) => setFieldVals((prev) => ({ ...prev, [f.field_key]: v }))}
              disabled={busy}
            />
          ))}
          {transition.note_prompt ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {screenFields.length ? "Resolution note" : heading}
                {noteRequired ? <span className="text-destructive"> *</span> : null}
              </label>
              <RichTextEditor
                value={note}
                onChange={setNote}
                placeholder={isPrivate ? "Add an internal note…" : "Add a note…"}
                ariaLabel={heading}
                className={isPrivate ? "border-warning/40 bg-warning/10" : undefined}
              />
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t p-4">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" className="gap-1" onClick={submit} disabled={!canSubmit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {transition.name}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** A square icon button with an overlaid count badge — the Jira-style header
 *  affordance for watchers / attachments. Module-top-level (focus stability). */
// The relationship a link expresses from the *source* ticket's point of view
// (matches the server's TicketLink.LinkType labels). Inbound rows are shown with
// their inverse label by the server, so this list only drives the "add" picker.
const LINK_TYPE_OPTIONS: { value: LinkType; label: string }[] = [
  { value: "relates_to", label: "relates to" },
  { value: "blocks", label: "blocks" },
  { value: "blocked_by", label: "is blocked by" },
  { value: "duplicates", label: "duplicates" },
  { value: "duplicated_by", label: "is duplicated by" },
  { value: "causes", label: "causes" },
  { value: "caused_by", label: "is caused by" },
];

/** "Linked issues" details-rail card: related tickets grouped by relationship, each
 *  linking through to its detail, with add (type + ticket search) and remove. Add/
 *  remove go through `POST /tickets/{id}/links/` and `.../links/unlink/`; both refetch
 *  links and nudge the Activity tab. `ticketId` is the ticket UUID. */
function LinkedIssuesCard({
  ticketId,
  org,
  links,
  canEdit,
  onChanged,
  onActivity,
}: {
  ticketId: string;
  org: string;
  links: TicketLink[];
  canEdit: boolean;
  onChanged: (next: TicketLink[]) => void;
  onActivity: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [linkType, setLinkType] = useState<LinkType>("relates_to");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = await ticketsApi.links(ticketId).catch(() => null);
    if (next) onChanged(next);
    onActivity();
  }, [ticketId, onChanged, onActivity]);

  async function addLink(target: TicketListItem) {
    setBusy(true);
    try {
      await ticketsApi.addLink(ticketId, target.id, linkType);
      await refresh();
      setAdding(false);
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not link the ticket.");
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(link: TicketLink) {
    setBusy(true);
    try {
      await ticketsApi.removeLink(ticketId, link.id);
      onChanged(links.filter((l) => l.id !== link.id));
      onActivity();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not remove the link.");
    } finally {
      setBusy(false);
    }
  }

  // Group by the (perspective-correct) relationship label the server returned.
  const groups = new Map<string, TicketLink[]>();
  for (const l of links) {
    groups.set(l.link_type_display, [...(groups.get(l.link_type_display) ?? []), l]);
  }
  const excludeIds = [ticketId, ...links.map((l) => l.other_id)];

  return (
    <dl className="rounded-xl border bg-card shadow-soft p-4 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Linked issues
        </p>
        {canEdit && !adding ? (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Link issue
          </Button>
        ) : null}
      </div>

      {links.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No linked tickets yet.</p>
      ) : null}

      {[...groups.entries()].map(([label, rows]) => (
        <div key={label} className="mb-2 last:mb-0">
          <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
          <ul className="space-y-1">
            {rows.map((l) => (
              <li key={l.id} className="flex items-center gap-2 rounded-md px-1 py-1">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/t/${org}/agent/w/${l.other_helpdesk_key}/p/${l.other_project_key}/${l.other_number}`}
                    className="flex items-center gap-2"
                  >
                    <span className="font-mono text-xs font-semibold text-primary hover:underline">{l.other_number}</span>
                    {l.other_status_name ? (
                      <StatusBadge
                        name={l.other_status_name}
                        category={(l.other_status_category ?? "todo") as StatusCategory}
                        color={l.other_status_color ?? null}
                      />
                    ) : null}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground" title={l.other_summary}>{l.other_summary}</p>
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`Remove link to ${l.other_number}`}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void removeLink(l)}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {canEdit && adding ? (
        <div className="mt-2 space-y-2 rounded-md border bg-muted/40 p-2">
          <Select value={linkType} onValueChange={(v) => setLinkType(v as LinkType)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LINK_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <TicketSearchCombobox
            onSelect={addLink}
            excludeIds={excludeIds}
            disabled={busy}
            placeholder="Search a ticket to link…"
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </dl>
  );
}

function CountIconButton({
  icon,
  count,
  label,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
}) {
  return (
    <Button type="button" variant="outline" size="icon" className="relative" aria-label={label}>
      {icon}
      {count > 0 ? (
        <Badge
          variant="secondary"
          className="absolute -right-1.5 -top-1.5 h-4 min-w-[1rem] justify-center rounded-full px-1 text-[10px] leading-none"
        >
          {count}
        </Badge>
      ) : null}
    </Button>
  );
}

/** Top-right watcher control (Jira-style): count badge + popover to view the list,
 *  self Watch/Unwatch, and add/remove any user. `ticketId` is the ticket UUID. */
function WatchersPopover({
  ticketId,
  watchers,
  meId,
  canEdit,
  onChanged,
}: {
  ticketId: string;
  watchers: Watcher[];
  meId: string | null;
  canEdit: boolean;
  onChanged: (next: Watcher[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const isSelfWatching = meId != null && watchers.some((w) => String(w.user.id) === meId);

  const refresh = useCallback(async () => {
    const next = await ticketsApi.watchers(ticketId).catch(() => null);
    if (next) onChanged(next);
  }, [ticketId, onChanged]);

  async function toggleSelf() {
    setBusy(true);
    try {
      if (isSelfWatching) await ticketsApi.unwatch(ticketId);
      else await ticketsApi.watch(ticketId);
      await refresh();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not update watch.");
    } finally {
      setBusy(false);
    }
  }

  async function addUser(u: UserRef) {
    if (watchers.some((w) => String(w.user.id) === String(u.id))) return;
    setBusy(true);
    try {
      await watchersApi.add(ticketId, u.id);
      await refresh();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not add watcher.");
    } finally {
      setBusy(false);
    }
  }

  async function removeWatcher(w: Watcher) {
    setBusy(true);
    try {
      await watchersApi.remove(w.id);
      onChanged(watchers.filter((x) => x.id !== w.id));
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not remove watcher.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <CountIconButton
            icon={<Eye className="h-4 w-4" aria-hidden="true" />}
            count={watchers.length}
            label={`Watchers (${watchers.length})`}
          />
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Watchers</p>
          {meId != null ? (
            <Button type="button" size="sm" variant={isSelfWatching ? "outline" : "secondary"} disabled={busy} onClick={toggleSelf}>
              <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {isSelfWatching ? "Unwatch" : "Watch"}
            </Button>
          ) : null}
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {watchers.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">No watchers yet.</p>
          ) : (
            <ul className="space-y-1">
              {watchers.map((w) => (
                <li key={w.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm">
                  <span className="min-w-0 flex-1">
                    {personWithEmail(w.user)}
                    {meId != null && String(w.user.id) === meId ? (
                      <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                    ) : null}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={`Remove ${w.user.full_name || w.user.username}`}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void removeWatcher(w)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        {canEdit ? (
          <div className="border-t p-2">
            <UserSearchCombobox onSelect={addUser} placeholder="Add a watcher…" disabled={busy} />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Top-right attachment control (Jira-style): count badge + popover with image
 *  previews, download links, per-file delete (confirmed), and an upload button.
 *  `ticketId` is the ticket UUID (attachment endpoints key off the FK pk). */
function AttachmentsPopover({
  ticketId,
  attachments,
  canEdit,
  onChanged,
}: {
  ticketId: string;
  attachments: Attachment[];
  canEdit: boolean;
  onChanged: (next: Attachment[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    setUploading(true);
    try {
      const added: Attachment[] = [];
      for (const f of list) added.push(await ticketAttachmentsApi.upload(ticketId, f));
      onChanged([...attachments, ...added]);
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not upload file.");
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment(a: Attachment) {
    if (!window.confirm(`Delete ${a.original_name || "this file"}?`)) return;
    try {
      await ticketAttachmentsApi.remove(a.id);
      onChanged(attachments.filter((x) => x.id !== a.id));
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not delete the attachment.");
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <CountIconButton
            icon={<Paperclip className="h-4 w-4" aria-hidden="true" />}
            count={attachments.length}
            label={`Attachments (${attachments.length})`}
          />
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Attachments</p>
          {canEdit ? (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  void uploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {uploading ? "Uploading…" : "Add files"}
              </Button>
            </>
          ) : null}
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {attachments.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">No attachments.</p>
          ) : (
            <ul className="space-y-1.5">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-md border bg-muted/30 p-1.5">
                  {isImageAttachment(a) ? (
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
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={`Delete ${a.original_name || "file"}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => void removeAttachment(a)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function groupSections<T extends { item: FieldLayoutItem }>(rows: T[]): { name: string; rows: T[] }[] {
  const out: { name: string; rows: T[] }[] = [];
  for (const r of rows) {
    const name = r.item.section || "Details";
    let g = out.find((s) => s.name === name);
    if (!g) {
      g = { name, rows: [] };
      out.push(g);
    }
    g.rows.push(r);
  }
  return out;
}

type FieldViewProps = {
  def: FieldDefinition;
  ticket: TicketDetail;
  attachments: Attachment[];
  block?: boolean;
  canEdit: boolean;
  groups: Group[];
  savingKey: string | null;
  onSaveColumn: (body: UpdateTicketInput, key: string) => Promise<boolean>;
  onSaveCustom: (key: string, value: unknown) => void;
};

/** Render one layout field — editable inline when the agent has update rights,
 *  else a read-only value. Column-backed fields (config.maps_to) save through the
 *  ticket PATCH; custom value-backed fields save through the field engine. */
function FieldView({ def, ticket, attachments, block, canEdit, groups, savingKey, onSaveColumn, onSaveCustom }: FieldViewProps) {
  const cfg = (def.config ?? {}) as Cfg;

  // Rich text (Description) — full-width prose block; editable via toggle.
  if (cfg.maps_to === "description_html") {
    return (
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">{def.name}</p>
        {canEdit ? (
          <DescriptionEditor
            html={ticket.description_html}
            saving={savingKey === "description"}
            onSave={(v) => onSaveColumn({ description_html: v }, "description")}
          />
        ) : ticket.description_html ? (
          <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: ticket.description_html }} />
        ) : (
          <p className="text-sm text-muted-foreground">No description provided.</p>
        )}
      </div>
    );
  }

  // Attachments — read-only list (uploading from the detail view is out of scope).
  if (def.field_type === "attachment") {
    return (
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">{def.name}</p>
        {attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attachments.</p>
        ) : (
          <ul className="space-y-1">
            {attachments.map((a) => (
              <li key={a.id}>
                <a href={a.file} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                  {a.original_name || "file"}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const editor = canEdit ? buildEditor() : null;

  if (editor) {
    if (block) {
      return (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{def.name}</p>
          {editor}
        </div>
      );
    }
    return (
      <div className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
        <dt className="shrink-0 text-muted-foreground">{def.name}</dt>
        <dd className="min-w-0 text-right font-medium">{editor}</dd>
      </div>
    );
  }

  // Read-only fallback.
  const value = fieldValue(def, ticket);
  if (block) {
    return (
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">{def.name}</p>
        <div className="text-sm">{value}</div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
      <dt className="text-muted-foreground">{def.name}</dt>
      <dd className="min-w-0 text-right font-medium">{value}</dd>
    </div>
  );

  function buildEditor(): React.ReactNode {
    switch (cfg.maps_to) {
      case "priority":
        return (
          <PrioritySelect
            value={ticket.priority}
            busy={savingKey === "priority"}
            onChange={(v) => onSaveColumn({ priority: v }, "priority")}
          />
        );
      case "requestor":
        return (
          <InlineUserPicker
            value={ticket.requestor}
            placeholder="—"
            busy={savingKey === "requestor"}
            onChange={(u) => onSaveColumn({ requestor: u ? u.id : null }, "requestor")}
          />
        );
      case "assignee":
        // Strict: assignee is chosen from the assigned group's members (leads first).
        return (
          <GroupMemberPicker
            groupId={ticket.assigned_group}
            value={ticket.assignee}
            disabled={savingKey === "assignee"}
            onChange={(u) => onSaveColumn({ assignee: u ? u.id : null }, "assignee")}
          />
        );
      case "assigned_group":
        return (
          <GroupSelect
            groups={groups}
            value={ticket.assigned_group}
            busy={savingKey === "group"}
            onChange={(v) => onSaveColumn({ assigned_group: v || null }, "group")}
          />
        );
      case "summary": // edited in the page header
      case "source": // system-set, read-only
        return null;
      default:
        break;
    }
    // Any other column-backed field stays read-only.
    if (cfg.maps_to) return null;
    // Custom user-picker fields aren't inline-editable yet → read-only.
    if (def.field_type === "user_picker") return null;
    return (
      <CustomFieldEdit
        def={def}
        value={ticket.custom_fields?.[def.key]}
        groups={groups}
        saving={savingKey === `cf:${def.key}`}
        onSave={(v) => onSaveCustom(def.key, v)}
      />
    );
  }
}

function fieldValue(def: FieldDefinition, ticket: TicketDetail): React.ReactNode {
  const cfg = (def.config ?? {}) as Cfg;
  const dash = <span className="text-muted-foreground">—</span>;

  switch (cfg.maps_to) {
    case "summary":
      return ticket.summary || dash;
    case "priority":
      return <PriorityTag priority={ticket.priority} />;
    case "requestor":
      return personWithEmail(ticket.requestor, dash);
    case "assigned_group":
      return ticket.assigned_group_name ?? dash;
    case "assignee":
      return personWithEmail(ticket.assignee, <span className="text-muted-foreground">Unassigned</span>);
    case "source":
      return ticket.source ? capitalize(ticket.source) : dash;
    default:
      break;
  }

  const raw = ticket.custom_fields?.[def.key];
  if (raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0)) return dash;

  const labelFor = (val: unknown) => def.options?.find((o) => o.value === String(val))?.label ?? String(val);

  switch (def.field_type) {
    case "richtext":
      // Server-sanitised on write (field_service._coerce) → safe to render.
      return (
        <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: String(raw) }} />
      );
    case "cascade":
      return Array.isArray(raw) ? raw.map(labelFor).join(" › ") : labelFor(raw);
    case "multiselect":
      return Array.isArray(raw) ? raw.map(labelFor).join(", ") : labelFor(raw);
    case "dropdown":
    case "radio":
      return labelFor(raw);
    case "checkbox":
      return raw ? "Yes" : "No";
    default:
      return String(raw);
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

/** Render one requestor custom-attribute value (text/number/date/checkbox/
 *  dropdown/multiselect) for the INFO rail. */
function formatRequestorAttr(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-muted-foreground">—</span>;
  if (Array.isArray(v)) return v.length ? v.join(", ") : <span className="text-muted-foreground">—</span>;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** Collapsible "Requestor profile" dropdown — email/name + custom directory
 *  attributes for the ticket's requestor. Defaults collapsed; toggled by a
 *  chevron. Renders nothing when the requestor has no profile data. */
function RequestorProfile({ user, attributes }: { user: UserRef | null; attributes: RequestorAttribute[] }) {
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const dash = <span className="text-muted-foreground">—</span>;
  // Email always shown (primary requestor identifier); other fields shown when set.
  const rows: { label: string; value: React.ReactNode }[] = [{ label: "Email", value: user.email || dash }];
  if (user.first_name) rows.push({ label: "First name", value: user.first_name });
  if (user.last_name) rows.push({ label: "Last name", value: user.last_name });
  for (const a of attributes) rows.push({ label: a.label, value: formatRequestorAttr(a.value) });
  return (
    <div className="mt-1 rounded-md bg-muted/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <span>Requestor profile</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="px-2 pb-1.5">
          {rows.map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-1 py-1 text-sm">
              <span className="shrink-0 text-muted-foreground">{p.label}</span>
              <span className="min-w-0 truncate text-right font-medium">{p.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Name + muted email (when present) for a read-only person field. Standard ITSM
 *  tools show the email beside the name; falls back to `fallback` (or a dash). */
function personWithEmail(u: UserRef | null, fallback?: React.ReactNode): React.ReactNode {
  if (!u) return fallback ?? <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 flex-col items-end">
      <span className="truncate">{u.full_name || u.username}</span>
      {u.email ? (
        <span className="truncate text-xs font-normal text-muted-foreground">{u.email}</span>
      ) : null}
    </span>
  );
}

// ---- editable controls (all module-top-level → no focus loss on re-render) ----

function PrioritySelect({ value, busy, onChange }: { value: Priority; busy?: boolean; onChange: (v: Priority) => void }) {
  return (
    <select className={selectCls} value={value} disabled={busy} onChange={(e) => onChange(e.target.value as Priority)} aria-label="Priority">
      {PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {capitalize(p)}
        </option>
      ))}
    </select>
  );
}

function GroupSelect({
  groups,
  value,
  busy,
  onChange,
}: {
  groups: Group[];
  value: string | null;
  busy?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <select className={selectCls} value={value ?? ""} disabled={busy} onChange={(e) => onChange(e.target.value)} aria-label="Group">
      <option value="">Unassigned</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}

function InlineUserPicker({
  value,
  placeholder,
  busy,
  onChange,
}: {
  value: UserRef | null;
  placeholder: string;
  busy?: boolean;
  onChange: (u: UserRef | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserRef[]>([]);

  useEffect(() => {
    if (!editing) return;
    const h = setTimeout(() => {
      usersApi.search(q).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(h);
  }, [q, editing]);

  if (!editing) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setQ("");
          setResults([]);
          setEditing(true);
        }}
        className="group inline-flex items-center gap-1 rounded px-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {value ? (
          <span className="flex flex-col items-end leading-tight">
            <span>{value.full_name || value.username}</span>
            {value.email ? <span className="text-xs font-normal text-muted-foreground">{value.email}</span> : null}
          </span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="relative w-44">
      <Input
        autoFocus
        value={q}
        placeholder="Search people…"
        className="h-8"
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setEditing(false), 150)}
      />
      <ul className="absolute right-0 z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 text-left shadow-md">
        {value ? (
          <li>
            <button
              type="button"
              className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(null);
                setEditing(false);
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
            </button>
          </li>
        ) : null}
        {results.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(u);
                setEditing(false);
              }}
            >
              <span className="block truncate">{u.full_name || u.username}</span>
              {u.email ? <span className="block truncate text-xs text-muted-foreground">{u.email}</span> : null}
            </button>
          </li>
        ))}
        {results.length === 0 ? <li className="px-2 py-1.5 text-xs text-muted-foreground">Type to search…</li> : null}
      </ul>
    </div>
  );
}

function DescriptionEditor({
  html,
  saving,
  onSave,
}: {
  html: string;
  saving?: boolean;
  onSave: (v: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(html);

  if (!editing) {
    return (
      <div className="space-y-2">
        {html ? (
          <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="text-sm text-muted-foreground">No description provided.</p>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setDraft(html);
            setEditing(true);
          }}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <RichTextEditor value={draft} onChange={setDraft} placeholder="Describe the issue…" ariaLabel="Description" />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={saving}
          onClick={async () => {
            if (await onSave(draft)) setEditing(false);
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

/** Text/number input that commits its draft on blur or Enter (Esc reverts). */
function CommitInput({
  initial,
  type = "text",
  disabled,
  onCommit,
}: {
  initial: string;
  type?: string;
  disabled?: boolean;
  onCommit: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  return (
    <Input
      type={type}
      value={v}
      disabled={disabled}
      className="h-8 w-44 text-right"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== initial) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setV(initial);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Multiline textarea that commits on blur. */
function CommitTextarea({ initial, disabled, onCommit }: { initial: string; disabled?: boolean; onCommit: (v: string) => void }) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  return (
    <textarea
      value={v}
      disabled={disabled}
      rows={3}
      className={textareaCls}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== initial) onCommit(v);
      }}
    />
  );
}

function MultiSelectEdit({ def, value, disabled, onSave }: { def: FieldDefinition; value: unknown; disabled?: boolean; onSave: (v: string[]) => void }) {
  const selected = new Set((Array.isArray(value) ? value : []).map(String));
  const opts = (def.options ?? []).filter((o) => o.is_active !== false);
  return (
    <div className="space-y-1">
      {opts.map((o) => (
        <label key={o.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={disabled}
            checked={selected.has(o.value)}
            onChange={() => {
              const next = new Set(selected);
              if (next.has(o.value)) next.delete(o.value);
              else next.add(o.value);
              onSave([...next]);
            }}
            className="h-4 w-4"
          />
          {o.label}
        </label>
      ))}
      {opts.length === 0 ? <p className="text-xs text-muted-foreground">No options configured.</p> : null}
    </div>
  );
}

function CascadeEdit({ def, value, disabled, onSave }: { def: FieldDefinition; value: unknown; disabled?: boolean; onSave: (v: string[]) => void }) {
  const cfg = (def.config ?? {}) as Cfg;
  const levels = cfg.levels?.length ? cfg.levels : ["Category"];
  const options = def.options ?? [];
  const path = Array.isArray(value) ? value.map(String) : [];
  const byValue = new Map(options.map((o) => [o.value, o]));

  const childrenAt = (level: number) => {
    if (level === 0) return options.filter((o) => !o.parent);
    const parentVal = path[level - 1];
    const parent = parentVal ? byValue.get(parentVal) : undefined;
    if (!parent) return [];
    return options.filter((o) => o.parent === parent.id);
  };

  const rendered: number[] = [];
  for (let i = 0; i < levels.length; i++) {
    if (i === 0 || (path[i - 1] && childrenAt(i).length > 0)) rendered.push(i);
  }

  return (
    <div className="space-y-1">
      {rendered.map((i) => (
        <select
          key={i}
          disabled={disabled}
          value={path[i] ?? ""}
          className={selectCls}
          aria-label={levels[i]}
          onChange={(e) => {
            const next = path.slice(0, i);
            if (e.target.value) next[i] = e.target.value;
            onSave(next);
          }}
        >
          <option value="">{`Select ${(levels[i] ?? "level").toLowerCase()}…`}</option>
          {childrenAt(i).map((o) => (
            <option key={o.id} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {options.length === 0 ? <p className="text-xs text-muted-foreground">No options configured.</p> : null}
    </div>
  );
}

/** Inline editor for a custom (value-backed) field, dispatched by field type. */
function CustomFieldEdit({
  def,
  value,
  groups,
  saving,
  onSave,
}: {
  def: FieldDefinition;
  value: unknown;
  groups: Group[];
  saving?: boolean;
  onSave: (v: unknown) => void;
}) {
  switch (def.field_type) {
    case "dropdown":
    case "radio":
      return (
        <select className={selectCls} disabled={saving} value={String(value ?? "")} onChange={(e) => onSave(e.target.value)}>
          <option value="">—</option>
          {(def.options ?? [])
            .filter((o) => o.is_active !== false)
            .map((o) => (
              <option key={o.id} value={o.value}>
                {o.label}
              </option>
            ))}
        </select>
      );
    case "checkbox":
      return <input type="checkbox" className="h-4 w-4" disabled={saving} checked={Boolean(value)} onChange={(e) => onSave(e.target.checked)} />;
    case "date":
      return <Input type="date" className="h-8 w-44" disabled={saving} defaultValue={String(value ?? "")} onChange={(e) => onSave(e.target.value)} />;
    case "datetime":
      return <Input type="datetime-local" className="h-8 w-44" disabled={saving} defaultValue={String(value ?? "")} onChange={(e) => onSave(e.target.value)} />;
    case "number":
      return <CommitInput type="number" initial={String(value ?? "")} disabled={saving} onCommit={(v) => onSave(v)} />;
    case "multiline":
      return <CommitTextarea initial={String(value ?? "")} disabled={saving} onCommit={(v) => onSave(v)} />;
    case "richtext":
      // Commit on blur (one set-fields write per edit, not per keystroke).
      return (
        <RichTextEditor
          value={String(value ?? "")}
          disabled={saving}
          ariaLabel={def.name}
          onBlur={(html) => {
            if (html !== String(value ?? "")) onSave(html);
          }}
        />
      );
    case "multiselect":
      return <MultiSelectEdit def={def} value={value} disabled={saving} onSave={onSave} />;
    case "cascade":
      return <CascadeEdit def={def} value={value} disabled={saving} onSave={onSave} />;
    case "group_picker":
      return <GroupSelect groups={groups} value={(value as string) || null} busy={saving} onChange={(v) => onSave(v || null)} />;
    case "text":
    default:
      return <CommitInput initial={String(value ?? "")} disabled={saving} onCommit={(v) => onSave(v)} />;
  }
}
