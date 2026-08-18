"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlignLeft, ArrowLeft, ChevronDown, Download, Eye, FolderInput, Info, Link2, Loader2, Lock, MessageSquare, MoreVertical, Paperclip, Pencil, Plus, Printer, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { CannedResponsePicker } from "@/components/canned-notes/canned-response-picker";
import { UserSearchCombobox } from "@/components/settings/user-search-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { brandingApi, commentAttachmentsApi, fieldsApi, groupsApi, layoutsApi, slaApi, ticketAttachmentsApi, ticketsApi, usersApi, watchersApi } from "@/lib/itsm/api";
import { MoveTicketDialog } from "@/components/tickets/move-ticket-dialog";
import type {
  ActivityEvent,
  BrandingPublicConfig,
  CommentAttachment,
  CommentVisibility,
  FieldDefinition,
  FieldLayoutItem,
  Group,
  Priority,
  RequestorAttribute,
  SlaEntry,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApprovalPanel } from "./approval-panel";
import { evalRule, FIELD_HELP, normRule, type Values } from "./ticket-create-form";
import { GroupMemberPicker } from "./group-member-picker";
import { PriorityTag } from "./priority-tag";
import { PRIORITY_LABELS } from "@/lib/itsm/priority";
import { SlaPanel } from "./sla-panel";
import { StatusBadge } from "./status-badge";
import { TicketSearchCombobox } from "./ticket-search-combobox";
import { inputCls, selectCls, textareaCls } from "./field-styles";
import { UserAvatar } from "./user-avatar";
import { SlaCelebration } from "./sla-celebration";
import { slaCelebration, type CelebrationResult, type CelebrationTier } from "@/lib/itsm/sla-celebration";

type Cfg = { maps_to?: string; tooltip?: string; hint?: string; levels?: string[] };
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
  ticket_moved: "moved the ticket to another project",
  approval_cancelled: "cancelled a pending approval",
};

const PRIORITY_LABEL: Record<string, string> = {
  ...PRIORITY_LABELS,
  // Legacy codes retained so pre-P1–P4 activity-log entries still render nicely.
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
    case "ticket_moved":
      return p.from != null && p.to != null
        ? `${activityValue(p.from)} → ${activityValue(p.to)} (${activityValue(p.old_number)} → ${activityValue(p.new_number)})`
        : null;
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

const PRIORITIES: Priority[] = ["p1", "p2", "p3", "p4"];

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
  // Deleting a ticket is gated by the `itsm.tickets` DELETE permission — set per
  // role in Roles & Permissions (Admin/Supervisor have it; Agent does not by default).
  const canDelete = hasPerm("itsm.tickets", "delete");
  // Moving a ticket to another project is a dedicated permission (Agent/Lead/Admin
  // by default) — it re-keys the number and can drop custom-field values.
  const canMove = hasPerm("itsm.tickets.move", "create");
  // Printing is a dedicated permission (Agent/Supervisor/Admin by default) so it can be
  // revoked per role in Roles & Permissions — see itsm.tickets.print module.
  const canPrint = hasPerm("itsm.tickets.print", "read");
  // Client-only flag so the print portal renders into document.body only after mount
  // (avoids an SSR/hydration mismatch — document isn't available on the server).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Org-wide white-label branding (client name + logo) for the print sheet.
  // Fetched once on mount (pre-auth-capable endpoint); best-effort — a failure
  // just falls back to the org slug + product logo.
  const [branding, setBranding] = useState<BrandingPublicConfig | null>(null);
  useEffect(() => {
    brandingApi.publicConfig().then(setBranding).catch(() => {});
  }, []);
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  // Internal (private) notes are gated by the same module that gates *reading* them
  // (server: `comments` list filters private out without it). Agent + Supervisor have it;
  // a Requestor does not — so they only ever see/post public comments.
  const canPostPrivate = hasPerm("itsm.tickets.comments_private", "read");
  // Canned responses: agents with read on the module get the composer inserter.
  const canCanned = hasPerm("itsm.canned_notes", "read");

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [comments, setComments] = useState<TicketComment[]>([]);
  // Comments | Activity tab selection. Controlled so opening the Activity tab can
  // trigger its (lazy) first fetch.
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  // Activity (audit log) is loaded lazily — only when the agent opens the Activity
  // tab — so opening a ticket doesn't pay for a log fetch nobody may look at.
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [activityStatus, setActivityStatus] = useState<"idle" | "loading" | "ready">("idle");
  // Mirrors `activityStatus === "ready"` for reads inside callbacks without stale
  // closures — lets post-change refreshers re-fetch the log only when it's on screen.
  const activityLoadedRef = useRef(false);
  const [layoutItems, setLayoutItems] = useState<FieldLayoutItem[]>([]);
  const [defsById, setDefsById] = useState<Record<string, FieldDefinition>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [links, setLinks] = useState<TicketLink[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  // True while we bounce a stale (old-number / old-project) URL to the canonical one
  // after a cross-project move — keeps the skeleton up so the stale id never flashes.
  const [redirecting, setRedirecting] = useState(false);
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
  // "SLA win" celebration shown after resolving a ticket comfortably within SLA.
  const [celebration, setCelebration] = useState<CelebrationResult | null>(null);

  const load = useCallback(async () => {
    const t = await ticketsApi.get(ticketId);
    // Canonical-URL redirect: if this ticket was reached via an OLD number (or the
    // URL's project segment is stale) — resolved by the backend alias — its current
    // ticket_number / project_key differ from the URL. Bounce to the canonical URL
    // and skip loading sub-resources for the stale id (avoids a flash + a wasted fetch).
    if (t.ticket_number !== ticketId || t.project_key !== projectKey) {
      const from = searchParams.get("from") === "all" ? "?from=all" : "";
      const hk = t.helpdesk_key ?? helpdeskKey;
      setRedirecting(true);
      router.replace(`/t/${org}/agent/w/${hk}/p/${t.project_key}/${t.ticket_number}${from}`);
      return;
    }
    setTicket(t);
    // Activity (audit log) is intentionally omitted here — it loads lazily on first
    // open of the Activity tab (see `loadActivity`), so opening a ticket stays cheap.
    const [trs, cs, layout, defs, atts, wchs, lks] = await Promise.all([
      ticketsApi.availableTransitions(ticketId),
      ticketsApi.comments(ticketId),
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
    setLayoutItems((layout?.items ?? []).slice().sort((a, b) => a.sort_order - b.sort_order));
    setDefsById(Object.fromEntries(defs.map((d) => [d.id, d])));
    setAttachments(atts);
    setWatchers(wchs);
    setLinks(lks);
    return t;
  }, [ticketId, projectKey, org, helpdeskKey, router, searchParams]);

  // Fetch the audit log on demand. Called when the agent first opens the Activity
  // tab, and thereafter to refresh it after a change — but only while it's on screen.
  const loadActivity = useCallback(async () => {
    if (!activityLoadedRef.current) setActivityStatus("loading");
    try {
      const act = await ticketsApi.activity(ticketId);
      setActivity(act);
      activityLoadedRef.current = true;
      setActivityStatus("ready");
    } catch {
      // Only surface the empty/idle state if we never managed a first load; a failed
      // refresh silently keeps the log already on screen.
      if (!activityLoadedRef.current) setActivityStatus("idle");
    }
  }, [ticketId]);

  // After a change (field edit, link, comment, approval) refresh the log only if the
  // agent has already opened it; otherwise it's fetched fresh on next open.
  const refreshActivityIfOpen = useCallback(() => {
    if (activityLoadedRef.current) void loadActivity();
  }, [loadActivity]);

  // Full refresh after actions that touch several facets (new comment, approval
  // decision): reload core data, then the audit log too if it's currently open.
  const reload = useCallback(async () => {
    await load();
    refreshActivityIfOpen();
  }, [load, refreshActivityIfOpen]);

  useEffect(() => {
    // New ticket → drop the lazily-loaded log and reset to the Comments tab; the
    // audit log reloads on next open of the Activity tab.
    activityLoadedRef.current = false;
    setActivity([]);
    setActivityStatus("idle");
    setTab("comments");
    load()
      .catch(() => toast.error("Could not load ticket."))
      .finally(() => setLoading(false));
  }, [load]);

  // QA/preview: `?celebrate=<tier>` shows a sample celebration without resolving a
  // real ticket at an exact time (harmless — no data change). Handy for demos.
  useEffect(() => {
    const c = searchParams.get("celebrate");
    if (!c) return;
    const pctByTier: Record<string, number> = { legendary: 95, excellent: 80, great: 60, ontime: 40, justintime: 15 };
    const pct = pctByTier[c];
    if (pct == null) return;
    const target = 480;
    setCelebration({
      tier: c as CelebrationTier,
      pctLeft: pct,
      metricName: "Time to Resolution",
      targetMinutes: target,
      elapsedMinutes: Math.round(target * (1 - pct / 100)),
      remainingMinutes: Math.round((target * pct) / 100),
    });
  }, [searchParams]);

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

  /** Persist standard (column-backed) fields, then refresh the ticket + audit log. */
  const patchColumn = useCallback(
    async (body: UpdateTicketInput, key: string) => {
      setSavingKey(key);
      try {
        const updated = await ticketsApi.update(ticketId, body);
        setTicket(updated);
        refreshActivityIfOpen();
        toast.success("Saved.");
        return true;
      } catch (e) {
        toast.error(e instanceof ItsmApiError ? e.message : "Could not save the change.");
        return false;
      } finally {
        setSavingKey(null);
      }
    },
    [ticketId, refreshActivityIfOpen],
  );

  /** Persist a custom (value-backed) field via the field engine. */
  const saveCustom = useCallback(
    async (key: string, value: unknown) => {
      setSavingKey(`cf:${key}`);
      try {
        const updated = await ticketsApi.setFields(ticketId, { [key]: value });
        setTicket(updated);
        refreshActivityIfOpen();
        toast.success("Saved.");
      } catch (e) {
        toast.error(e instanceof ItsmApiError ? e.message : "Could not save the change.");
      } finally {
        setSavingKey(null);
      }
    },
    [ticketId, refreshActivityIfOpen],
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
    const wasDone = ticket?.status_category === "done";
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
      const fresh = await load();
      // Celebrate a resolve that landed inside SLA (skip re-closing an already-done ticket).
      if (!wasDone && fresh?.status_category === "done") {
        const sla = await slaApi.forTicket(fresh.id).catch(() => [] as SlaEntry[]);
        const won = slaCelebration(sla);
        if (won) setCelebration(won);
      }
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
      await reload();
      toast.success(visibility === "private" ? "Internal note added." : "Comment added.");
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not add comment.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || redirecting)
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

  // Current field values keyed by field key — feeds the conditional-visibility
  // engine (the same `evalRule` the create + portal forms use). Column-backed
  // fields (config.maps_to) read off the ticket column; value-backed customs read
  // from custom_fields; the built-in `status` condition reads the status key.
  const ruleValues: Values = { status: ticket.status_key };
  for (const d of Object.values(defsById)) {
    const cfg = (d.config ?? {}) as Cfg;
    ruleValues[d.key] = cfg.maps_to
      ? (ticket as unknown as Record<string, unknown>)[cfg.maps_to]
      : ticket.custom_fields?.[d.key];
  }

  // Layout-driven field rows (skip hidden + summary — summary is the page title).
  // A field with a "show when …" rule is dropped when its condition isn't met,
  // matching the create form — otherwise conditional fields leaked in unconditionally.
  const rows = layoutItems
    .filter((it) => !it.is_hidden && defsById[it.field] && evalRule(normRule(it.visibility_rule), ruleValues).visible)
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

  async function deleteTicket() {
    if (!window.confirm(`Delete ticket ${ticketId}? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await ticketsApi.remove(ticketId);
      toast.success(`Ticket ${ticketId} deleted.`);
      router.push(backHref);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the ticket.");
      setDeleting(false);
    }
  }

  // Print opens the browser dialog; the #ticket-print region + globals.css @media print
  // rule swap the on-screen chrome for a clean, self-contained ticket sheet.
  function printTicket() {
    window.print();
  }

  return (
    <div className="space-y-4">
      {/* Print-only ticket sheet — portaled into <body> so the globals.css @media print rule
          can display:none every OTHER body child (no blank trailing pages). It mirrors what's
          on screen: every visible layout field (main + sidebar) via fieldValue(), the requestor
          profile, ticket metadata and public comments. Reuses loaded state (no extra fetch). */}
      {mounted
        ? createPortal(
            <div id="ticket-print" className="hidden print:block p-6 text-sm leading-relaxed">
              {/* Masthead — client logo (left) · OneDesk product logo (right),
                  JIRA/ServiceNow style. Client name + logo come from the org's
                  branding config; both gracefully absent on a fresh tenant. */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-h-[40px] items-center">
                  {branding?.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- print asset, no next/image in print
                    <img src={branding.logo_url} alt="" className="print-logo" />
                  ) : null}
                </div>
                <div className="flex min-h-[40px] items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static product logo */}
                  <img src="/logo.svg" alt="" className="print-logo" />
                </div>
              </div>
              <p className="mt-2 text-lg font-bold tracking-tight">
                OneDesk - {branding?.client_name || org}
              </p>
              <hr className="my-3 border-black/30" />

              <div className="pb-3">
                <p className="font-mono text-xs">{t.ticket_number}</p>
                <h1 className="text-xl font-semibold">{t.summary}</h1>
                <p className="mt-1 text-sm">
                  {t.status_name}
                  {t.priority ? ` · ${PRIORITY_LABEL[t.priority] ?? t.priority}` : ""}
                </p>
              </div>
              <hr className="mb-3 border-black/15" />

              <div className="mt-3 space-y-1">
                {[...mainRows, ...sideRows].map((r) => (
                  <div key={r.item.id} className="flex gap-3">
                    <span className="w-40 shrink-0 font-semibold">{r.def.name}</span>
                    <span className="min-w-0 flex-1">{fieldValue(r.def, t)}</span>
                  </div>
                ))}
              </div>

              {t.requestor ? (
                <div className="mt-4">
                  <p className="font-semibold">Requestor profile</p>
                  <div className="mt-1 space-y-1">
                    <div className="flex gap-3">
                      <span className="w-40 shrink-0 font-semibold">Email</span>
                      <span className="min-w-0 flex-1">{t.requestor.email || "—"}</span>
                    </div>
                    {t.requestor.first_name ? (
                      <div className="flex gap-3">
                        <span className="w-40 shrink-0 font-semibold">First name</span>
                        <span className="min-w-0 flex-1">{t.requestor.first_name}</span>
                      </div>
                    ) : null}
                    {t.requestor.last_name ? (
                      <div className="flex gap-3">
                        <span className="w-40 shrink-0 font-semibold">Last name</span>
                        <span className="min-w-0 flex-1">{t.requestor.last_name}</span>
                      </div>
                    ) : null}
                    {(t.requestor_attributes ?? []).map((a, i) => (
                      <div key={i} className="flex gap-3">
                        <span className="w-40 shrink-0 font-semibold">{a.label}</span>
                        <span className="min-w-0 flex-1">{formatRequestorAttr(a.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-4">
                <p className="font-semibold">Details</p>
                <div className="mt-1 space-y-1">
                  <div className="flex gap-3">
                    <span className="w-40 shrink-0 font-semibold">Type</span>
                    <span className="min-w-0 flex-1">{t.ticket_type_name ?? "—"}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-40 shrink-0 font-semibold">Created</span>
                    <span className="min-w-0 flex-1">{when(t.created_at)}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-40 shrink-0 font-semibold">Created by</span>
                    <span className="min-w-0 flex-1">{printPerson(t.created_by) || "—"}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-40 shrink-0 font-semibold">Last updated</span>
                    <span className="min-w-0 flex-1">{when(t.updated_at)}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-40 shrink-0 font-semibold">Updated by</span>
                    <span className="min-w-0 flex-1">{printPerson(t.updated_by) || "—"}</span>
                  </div>
                </div>
              </div>

              {comments.some((c) => c.visibility !== "private") ? (
                <div className="mt-4">
                  <p className="font-semibold">Comments</p>
                  <ul className="mt-1 space-y-3">
                    {comments
                      .filter((c) => c.visibility !== "private")
                      .map((c) => (
                        <li key={c.id} className="border-t border-black/10 pt-2">
                          <p className="text-xs">
                            {c.author?.full_name ?? "Someone"} · {when(c.created_at)}
                          </p>
                          <div
                            className="prose prose-sm mt-1 max-w-none"
                            dangerouslySetInnerHTML={{ __html: c.body_html }}
                          />
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}

              {/* Footer — a finished ServiceNow-style strip. */}
              <div className="mt-6 border-t border-black/20 pt-2 text-[11px] text-black/60">
                OneDesk - {branding?.client_name || org} · {t.ticket_number} · Printed {when(new Date().toISOString())}
              </div>
            </div>,
            document.body,
          )
        : null}

      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {backLabel}
      </Link>

      <div className="relative overflow-hidden rounded-xl border bg-card shadow-soft">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-chart-4/[0.06] to-transparent" />
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary to-chart-4" />
        <div className="relative flex flex-wrap items-start gap-3 p-5">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-accent px-2 py-0.5 font-mono text-xs font-semibold text-accent-foreground">
              {t.ticket_number}
            </span>
            <StatusBadge name={t.status_name} category={t.status_category} color={t.status_color} />
            <PriorityTag priority={t.priority} />
          </div>
          {editingSummary ? (
            <div className="flex flex-wrap items-center gap-2">
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
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.summary}</h1>
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
          {canPrint || canMove || canDelete ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="More actions">
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {canPrint ? (
                  <DropdownMenuItem onClick={printTicket}>
                    <Printer className="mr-2 h-4 w-4" aria-hidden="true" /> Print
                  </DropdownMenuItem>
                ) : null}
                {canMove ? (
                  <DropdownMenuItem onClick={() => setMoveOpen(true)}>
                    <FolderInput className="mr-2 h-4 w-4" aria-hidden="true" /> Move ticket
                  </DropdownMenuItem>
                ) : null}
                {canDelete ? (
                  <>
                    {canPrint || canMove ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuItem
                      disabled={deleting}
                      onClick={deleteTicket}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                      {deleting ? "Deleting…" : "Delete ticket"}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* main column — layout "main" fields, then comments + activity */}
        <div className="space-y-6">
          {/* Approvals sit at the top of the main column so a pending sign-off is the
              first thing an approver sees. Renders nothing when the ticket has none. */}
          <ApprovalPanel ticketId={t.id} onDecision={reload} />

          {mainSections.map((sec) => (
            <section
              key={sec.name}
              aria-label={sec.name}
              className="overflow-hidden rounded-xl border bg-card shadow-soft transition-shadow duration-200 hover:shadow-soft-md"
            >
              <div className="flex items-center gap-3 border-b bg-muted/30 px-5 py-3.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <AlignLeft className="h-4 w-4" aria-hidden="true" />
                </span>
                <h2 className="text-sm font-semibold">{sec.name}</h2>
              </div>
              <div className="space-y-4 p-5">
                {sec.rows.map((r) => (
                  <FieldView key={r.item.id} def={r.def} block {...fieldProps} />
                ))}
              </div>
            </section>
          ))}

          {/* Comments + Activity in tabs at the bottom of the main column (JIRA-style). */}
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as "comments" | "activity");
              // Lazy-load the audit log the first time the agent opens this tab.
              if (v === "activity" && !activityLoadedRef.current) void loadActivity();
            }}
            className="overflow-hidden rounded-xl border bg-card shadow-soft transition-shadow duration-200 hover:shadow-soft-md"
          >
            <TabsList className="m-3">
              <TabsTrigger value="comments" className="data-[state=active]:text-primary">Comments{comments.length ? ` (${comments.length})` : ""}</TabsTrigger>
              <TabsTrigger value="activity" className="data-[state=active]:text-primary">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="comments" className="px-4 pb-4 pt-0">
              <ul className="space-y-3">
                {comments.length === 0 ? (
                  <li className="text-sm text-muted-foreground">No comments yet.</li>
                ) : (
                  comments.map((c) => (
                    <li
                      key={c.id}
                      className={`flex gap-3 rounded-xl border p-3.5 ${
                        c.visibility === "private" ? "border-warning/30 bg-warning/5" : "bg-background"
                      }`}
                    >
                      <UserAvatar user={c.author ?? null} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{c.author?.full_name ?? "Someone"}</span>
                          {c.visibility === "private" ? (
                            <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 font-medium text-warning">
                              <Lock className="h-3 w-3" aria-hidden="true" /> Internal
                            </span>
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
                      </div>
                    </li>
                  ))
                )}
              </ul>
              <form onSubmit={submitComment} className="mt-4 flex gap-3">
                <UserAvatar user={user} size="sm" className="mt-0.5 hidden shrink-0 sm:inline-flex" />
                <div className="min-w-0 flex-1 space-y-2">
                {/* Visibility selector — Public Comment is the default; agents may switch
                    to an Internal note (hidden from the requestor). Requestors don't see it. */}
                {canPostPrivate ? (
                  <div className="inline-flex gap-0.5 rounded-lg border bg-muted/40 p-0.5 text-sm" role="group" aria-label="Comment visibility">
                    <button
                      type="button"
                      onClick={() => setCommentVisibility("public")}
                      aria-pressed={commentVisibility === "public"}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${
                        commentVisibility === "public"
                          ? "bg-card font-medium text-foreground shadow-soft"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> Public Comment
                    </button>
                    <button
                      type="button"
                      onClick={() => setCommentVisibility("private")}
                      aria-pressed={commentVisibility === "private"}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${
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
                </div>
              </form>
            </TabsContent>

            <TabsContent value="activity" className="px-4 pb-4 pt-0">
              <ul className="space-y-0">
                {activityStatus === "loading" ? (
                  <li className="text-sm text-muted-foreground">Loading activity…</li>
                ) : activity.length === 0 ? (
                  <li className="text-sm text-muted-foreground">No activity yet.</li>
                ) : (
                  activity.map((a, i) => {
                    const detail = activityDetail(a);
                    return (
                      <li key={a.id} className="flex gap-3">
                        <div className="flex flex-col items-center" aria-hidden="true">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary ring-4 ring-primary/15" />
                          {i < activity.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
                        </div>
                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 pb-4 text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">{a.actor?.full_name ?? "System"}</span>
                          <span>{activityVerb(a)}</span>
                          {detail ? <span className="font-medium text-foreground">{detail}</span> : null}
                          <span className="text-xs">· {when(a.created_at)}</span>
                        </div>
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
          <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-soft">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
            <StatusBadge name={t.status_name} category={t.status_category} color={t.status_color} />
          </div>

          {sideSections.map((sec) => (
            <dl key={sec.name} className="space-y-3 rounded-xl border bg-card shadow-soft p-4 text-sm transition-shadow duration-200 hover:shadow-soft-md">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <Info className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                {sec.name}
              </p>
              {sec.rows.map((r) => {
                const isRequestor = ((r.def.config ?? {}) as { maps_to?: string }).maps_to === "requestor";
                const cells = [<FieldView key={r.item.id} def={r.def} {...fieldProps} block />];
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

          <LinkedIssuesCard
            ticketId={t.id}
            org={org}
            links={links}
            canEdit={canEdit}
            onChanged={setLinks}
            onActivity={refreshActivityIfOpen}
          />

          {/* Ticket metadata — moved to the bottom, below the SLA/approval blocks. */}
          <dl className="rounded-xl border bg-card shadow-soft p-4 text-sm transition-shadow duration-200 hover:shadow-soft-md">
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

      {celebration ? (
        <SlaCelebration result={celebration} onClose={() => setCelebration(null)} />
      ) : null}

      {moveOpen && ticket ? (
        <MoveTicketDialog
          ticket={ticket}
          currentProjectId={ticket.project}
          onClose={() => setMoveOpen(false)}
          onMoved={(moved) => {
            setMoveOpen(false);
            const from = fromAll ? "?from=all" : "";
            const hk = moved.helpdesk_key ?? helpdeskKey;
            toast.success(`Moved to ${moved.ticket_number}.`);
            router.replace(`/t/${org}/agent/w/${hk}/p/${moved.project_key}/${moved.ticket_number}${from}`);
          }}
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
        <label className="flex w-fit items-center gap-2 text-sm">
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
    case "date":
      control = (
        <Input
          id={id}
          type="date"
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
      <label htmlFor={id} className="block text-sm font-medium">
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
  // Icon-only trigger: the label is exposed to AT via aria-label AND shown as a
  // hover tooltip so sighted users know what the eye / paperclip buttons do. The
  // Tooltip sits inside the PopoverTrigger's <span>, so hovering the button shows
  // the tip while a click still bubbles to the span and opens the popover.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
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
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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

  // Field label carrying the same tooltip (ⓘ) + hint text the create form shows, so
  // the detail view mirrors the form's guidance. Tooltip: explicit config first, else
  // the built-in FIELD_HELP fallback (impact/urgency/priority). Hint: config only.
  const help = cfg.tooltip || FIELD_HELP[cfg.maps_to ?? ""] || FIELD_HELP[def.key ?? ""];
  const label = (
    <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      {def.name}
      {help ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`What does ${def.name} mean?`}
              className="cursor-help text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-xs whitespace-pre-line text-left leading-relaxed">
            {help}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
  const hintNode = cfg.hint ? <p className="mt-1 text-xs text-muted-foreground">{cfg.hint}</p> : null;

  // Rich text (Description) — full-width prose block; editable via toggle.
  if (cfg.maps_to === "description_html") {
    return (
      <div>
        {label}
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
        {hintNode}
      </div>
    );
  }

  // Attachments — read-only list (uploading from the detail view is out of scope).
  if (def.field_type === "attachment") {
    return (
      <div>
        {label}
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
        {hintNode}
      </div>
    );
  }

  const editor = canEdit ? buildEditor() : null;

  if (editor) {
    if (block) {
      return (
        <div>
          {label}
          {editor}
          {hintNode}
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
        {label}
        <div className="text-sm">{value}</div>
        {hintNode}
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
            placeholder="Unassigned"
            busy={savingKey === "requestor"}
            block={block}
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
            className={selectCls}
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
    // ITIL Impact-Assessment fields are column-backed yet editable inline (matching
    // the create form and the server's update_ticket, which recomputes Priority from
    // Impact × Urgency on save). Reuse the value-backed editor UI, but seed it from the
    // ticket column and route the write to the ticket PATCH (onSaveColumn), not the
    // field engine. Resolution-Details fields are intentionally NOT here — they're
    // captured on the Resolve screen — so they fall through to read-only below.
    if (cfg.maps_to && IMPACT_ASSESSMENT_MAPS_TO.has(cfg.maps_to)) {
      const col = cfg.maps_to;
      return (
        <CustomFieldEdit
          def={def}
          value={(ticket as unknown as Record<string, unknown>)[col]}
          groups={groups}
          saving={savingKey === col}
          onSave={(v) => onSaveColumn(columnPatch(col, coerceColumnValue(def, v)), col)}
        />
      );
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
        block={block}
        onSave={(v) => onSaveCustom(def.key, v)}
      />
    );
  }
}

/** Column-backed ITIL Impact-Assessment + Problem fields that are editable
 *  inline on the detail view. Their value lives on the Ticket column (edited via
 *  the ticket PATCH, `update_ticket`), unlike value-backed custom fields.
 *  Resolution-Details fields are intentionally excluded — they're captured on the
 *  Resolve screen (and workaround_provided on Record Known Error). */
const IMPACT_ASSESSMENT_MAPS_TO = new Set([
  "impact", "urgency", "business_impact", "users_affected", "service_downtime", "major_incident",
  // ITIL Problem (KEDB) fields — column-backed on Problem layouts.
  "workaround_notes", "investigation_reason",
]);

/** Coerce a `CustomFieldEdit` value to the type the ticket-column PATCH expects:
 *  the number input / textarea emit strings, the checkbox a boolean. */
function coerceColumnValue(def: FieldDefinition, v: unknown): unknown {
  if (def.field_type === "number") {
    if (v === "" || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (def.field_type === "checkbox") return Boolean(v);
  return v;
}

/** Build a single-column ticket PATCH body (`{ <column>: value }`) for a maps_to field. */
function columnPatch(col: string, value: unknown): UpdateTicketInput {
  const body: Record<string, unknown> = { [col]: value };
  return body as UpdateTicketInput;
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

  // Column-backed fields (config.maps_to) store their value on the Ticket column,
  // NOT in the field engine — read it off the ticket by column name. All the ITIL
  // Impact-Assessment / Resolution-Details fields (impact, urgency, business_impact,
  // users_affected, service_downtime, major_incident, resolution_code, root_cause,
  // workaround_provided, resolution_notes) land here; value-backed custom fields
  // (mode, category, …) keep reading from custom_fields. Without this these fields
  // always rendered blank ("—") because their key is never present in custom_fields.
  const raw = cfg.maps_to
    ? (ticket as unknown as Record<string, unknown>)[cfg.maps_to]
    : ticket.custom_fields?.[def.key];
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
 *  attributes for the ticket's requestor. Expanded by default (JIRA shows the
 *  reporter's details inline); can be collapsed via the chevron. Renders nothing
 *  when the requestor has no profile data. */
function RequestorProfile({ user, attributes }: { user: UserRef | null; attributes: RequestorAttribute[] }) {
  const [open, setOpen] = useState(true);
  if (!user) return null;
  const dash = <span className="text-muted-foreground">—</span>;
  // Identity (name + email) already lives in the requestor chip above, so the
  // profile carries the contact email plus any directory attributes — no need to
  // repeat first/last name.
  const rows: { label: string; value: React.ReactNode }[] = [{ label: "Email", value: user.email || dash }];
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
// Plain-text person for the print sheet (no theme colors / truncation — inherits black-on-white).
function printPerson(u: UserRef | null): string {
  if (!u) return "";
  const name = u.full_name || u.username;
  return u.email ? `${name} <${u.email}>` : name;
}

function personWithEmail(u: UserRef | null, fallback?: React.ReactNode): React.ReactNode {
  if (!u) return fallback ?? <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <UserAvatar user={u} size="xs" />
      <span className="flex min-w-0 flex-col items-start">
        <span className="truncate">{u.full_name || u.username}</span>
        {u.email ? (
          <span className="truncate text-xs font-normal text-muted-foreground">{u.email}</span>
        ) : null}
      </span>
    </span>
  );
}

// ---- editable controls (all module-top-level → no focus loss on re-render) ----

function PrioritySelect({ value, busy, onChange }: { value: Priority; busy?: boolean; onChange: (v: Priority) => void }) {
  return (
    <select className={selectCls} value={value} disabled={busy} onChange={(e) => onChange(e.target.value as Priority)} aria-label="Priority">
      {PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {PRIORITY_LABELS[p] ?? capitalize(p)}
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
  block,
  onChange,
}: {
  value: UserRef | null;
  placeholder: string;
  busy?: boolean;
  block?: boolean;
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
    const startEditing = () => {
      setQ("");
      setResults([]);
      setEditing(true);
    };
    // Block (sidebar) mode → JIRA-style people chip: avatar + left-aligned
    // name/email, full-width row that highlights on hover with a subtle edit hint.
    if (block) {
      return (
        <button
          type="button"
          disabled={busy}
          onClick={startEditing}
          className="group -mx-2 flex w-[calc(100%_+_1rem)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <UserAvatar user={value} size="sm" />
          <span className="flex min-w-0 flex-col leading-tight">
            {value ? (
              <>
                <span className="truncate text-sm font-medium">{value.full_name || value.username}</span>
                {value.email ? <span className="truncate text-xs text-muted-foreground">{value.email}</span> : null}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <Pencil className="ml-auto h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden="true" />
        </button>
      );
    }
    return (
      <button
        type="button"
        disabled={busy}
        onClick={startEditing}
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
    <div className={block ? "relative w-full" : "relative w-44"}>
      <Input
        autoFocus
        value={q}
        placeholder="Search people…"
        className="h-8"
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setEditing(false), 150)}
      />
      <ul className={`absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 text-left shadow-md ${block ? "left-0" : "right-0"}`}>
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
    const enter = () => {
      setDraft(html);
      setEditing(true);
    };
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label="Edit description"
        onClick={(e) => {
          // Keep links in the description clickable in read mode; a click anywhere
          // else opens the editor (JIRA-style inline edit — no separate Edit button).
          if ((e.target as HTMLElement).closest("a")) return;
          enter();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            enter();
          }
        }}
        className="group relative -mx-2 cursor-text rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        {html ? (
          <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="text-sm text-muted-foreground">Add a description…</p>
        )}
        <span className="pointer-events-none absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-md border bg-background/90 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground opacity-0 shadow-soft transition-opacity group-hover:opacity-100">
          <Pencil className="h-3 w-3" aria-hidden="true" /> Edit
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <RichTextEditor value={draft} onChange={setDraft} autoFocus placeholder="Describe the issue…" ariaLabel="Description" />
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
  block,
  onCommit,
}: {
  initial: string;
  type?: string;
  disabled?: boolean;
  block?: boolean;
  onCommit: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  return (
    <Input
      type={type}
      value={v}
      disabled={disabled}
      className={block ? inputCls : "h-8 w-44 text-right"}
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
  block,
  onSave,
}: {
  def: FieldDefinition;
  value: unknown;
  groups: Group[];
  saving?: boolean;
  block?: boolean;
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
      return <Input type="date" className={block ? inputCls : "h-8 w-44"} disabled={saving} defaultValue={String(value ?? "")} onChange={(e) => onSave(e.target.value)} />;
    case "datetime":
      return <Input type="datetime-local" className={block ? inputCls : "h-8 w-44"} disabled={saving} defaultValue={String(value ?? "")} onChange={(e) => onSave(e.target.value)} />;
    case "number":
      return <CommitInput type="number" initial={String(value ?? "")} disabled={saving} block={block} onCommit={(v) => onSave(v)} />;
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
      return <CommitInput initial={String(value ?? "")} disabled={saving} block={block} onCommit={(v) => onSave(v)} />;
  }
}
