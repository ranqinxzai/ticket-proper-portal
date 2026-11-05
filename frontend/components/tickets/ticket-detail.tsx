"use client";

import { forwardRef, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronDown, Download, Eye, FolderInput, Link2, Loader2, Lock, Maximize2, MessageSquare, Minimize2, MoreVertical, PanelRight, Paperclip, Pencil, Plus, Printer, RefreshCw, Send, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { usePageShortcuts } from "@/components/shell/shortcuts-host";
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
import { cn } from "@/lib/utils";
import { MENTION_CHIP_CLS, RichTextEditor, type MentionItem, type RichTextEditorHandle } from "@/components/ui/rich-text-editor";
import { MENTION_PRINT_CLS } from "@/components/ui/mention-styles";
import { useLivePoll } from "@/lib/itsm/use-live-poll";
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
import { CascadeSelect } from "@/components/tickets/cascade-select";
import { MoveTicketDialog } from "@/components/tickets/move-ticket-dialog";
import { SendForApprovalSheet } from "@/components/approvals/send-for-approval-sheet";
import type {
  ActivityEvent,
  BrandingPublicConfig,
  CommentAttachment,
  CommentVisibility,
  FieldDefinition,
  FieldLayoutItem,
  FieldLayoutSection,
  Group,
  Priority,
  RequestorAttribute,
  SlaEntry,
  LinkType,
  StatusCategory,
  TicketAssetsResponse,
  TicketAttachment,
  TicketComment,
  TicketDetail,
  TicketLink,
  TicketListItem,
  TicketPulse,
  Transition,
  TransitionScreenField,
  UpdateTicketInput,
  UserRef,
  Watcher,
} from "@/lib/itsm/types";
import { ApprovalPanel } from "./approval-panel";
import { AssetLinkField, chipFromTicketLink, type LinkedAssetChip } from "@/components/assets/asset-link-field";
import { evalRule, normRule, type Values } from "./ticket-create-form";
import { InfoTip } from "@/components/ui/info-tip";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { fieldHelp } from "@/lib/itsm/help/fields";
import { LINK_TYPE_HELP, TICKET_HELP, WORKBENCH_HELP, transitionBlockedHint, transitionHint } from "@/lib/itsm/help/ticket";
import { GroupMemberPicker } from "./group-member-picker";
import { type CopyPayload, CopyValueButton } from "./copy-value-button";
import { PriorityTag } from "./priority-tag";
import { PRIORITY_LABELS } from "@/lib/itsm/priority";
import { SlaPanel } from "./sla-panel";
import { StatusBadge } from "./status-badge";
import { TicketSearchCombobox } from "./ticket-search-combobox";
import { inputCls, selectCls, textareaCls } from "./field-styles";
import { FIELD_GRID_CLS, FieldSectionCard, fieldSpanClass, SideSectionCard } from "./field-section";
import { ExpandableHtml } from "@/components/ui/expandable-html";
import { UserAvatar } from "./user-avatar";
import { SlaCelebration } from "./sla-celebration";
import { SlaHorizon } from "./sla-horizon";
import { useWorkbench } from "./workbench/workbench-context";
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
  automation_applied: "ran an automation rule",
  approval_requested: "requested approval",
  approval_approved: "approved the request",
  approval_rejected: "rejected the request",
  asset_linked: "linked an asset",
  asset_unlinked: "unlinked an asset",
};

/** The docked card's 3px top hairline, by priority (Modern workbench, step B4). */
const PRIORITY_HAIRLINE: Record<string, string> = {
  p1: "bg-destructive",
  p2: "bg-warning",
  p3: "bg-sky-500",
  p4: "bg-muted-foreground/40",
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
    // SLA re-target on a priority change (itsm_sla, field_key "sla").
    if (a.field_key === "sla") return "re-targeted the SLA";
    const name = (a.payload as { name?: string } | null | undefined)?.name;
    return name ? `changed ${name}` : ACTION_VERB.field_changed;
  }
  if (a.action === "approval_cancelled" && (a.payload as { withdrawn?: boolean } | null)?.withdrawn) {
    return "withdrew an approval";
  }
  if (a.action === "approval_requested" && (a.payload as { sent?: boolean } | null)?.sent) {
    return "sent the ticket for approval";
  }
  if ((a.action === "sla_paused" || a.action === "sla_resumed")
      && (a.payload as { reason?: string } | null)?.reason === "approval") {
    return a.action === "sla_paused"
      ? "paused the SLA timer while awaiting approval"
      : "resumed the SLA timer after the approval";
  }
  if (a.action === "asset_linked" || a.action === "asset_unlinked") {
    const p = (a.payload ?? {}) as { assets?: unknown[]; primary?: boolean };
    const n = Array.isArray(p.assets) ? p.assets.length : 0;
    if (a.action === "asset_linked" && p.primary) return "made an asset the primary asset";
    if (n > 1) return a.action === "asset_linked" ? `linked ${n} assets` : `unlinked ${n} assets`;
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
    case "approval_requested": {
      // payload: {workflow, stages[]} — the stage(s) now waiting for a decision.
      // Send for approval adds {sent: true, approvers[]?, note?}.
      const stages = Array.isArray(p.stages) ? (p.stages as unknown[]).map(String).join(", ") : "";
      if (p.workflow == null) return null;
      const bits = [`${activityValue(p.workflow)}${stages ? ` — ${stages}` : ""}`];
      if (Array.isArray(p.approvers) && p.approvers.length) bits.push(`asked ${activityValue(p.approvers)}`);
      if (typeof p.note === "string" && p.note.trim()) bits.push(`“${p.note.trim()}”`);
      return bits.join(" — ");
    }
    case "approval_cancelled": {
      // Withdrawn: {workflow, withdrawn: true, reason}; project move: {count, reason}.
      const reason = typeof p.reason === "string" ? p.reason.trim() : "";
      if (p.withdrawn) return [p.workflow != null ? activityValue(p.workflow) : "", reason ? `reason: “${reason}”` : ""].filter(Boolean).join(" — ") || null;
      return reason || null;
    }
    case "approval_approved":
    case "approval_rejected": {
      // payload: {workflow, stages[], comment} — a rejection's comment is the reason.
      const bits = [p.workflow != null ? activityValue(p.workflow) : ""];
      const note = typeof p.comment === "string" ? p.comment.trim() : "";
      if (note) bits.push(a.action === "approval_rejected" ? `reason: “${note}”` : `“${note}”`);
      const out = bits.filter(Boolean).join(" — ");
      return out || null;
    }
    case "watcher_added":
    case "watcher_removed":
      return p.user != null ? activityValue(p.user) : null;
    case "asset_linked":
    case "asset_unlinked": {
      // payload: {assets: [{id, asset_tag, name}], primary?: true}
      const list = Array.isArray(p.assets) ? (p.assets as { asset_tag?: string; name?: string }[]) : [];
      const text = list.map((x) => [x.asset_tag, x.name].filter(Boolean).join(" · ")).filter(Boolean).join(", ");
      return text || null;
    }
    case "automation_applied": {
      const acts = Array.isArray(p.actions) ? (p.actions as unknown[]).map(String).join("; ") : "";
      return p.rule_name != null ? `${activityValue(p.rule_name)}${acts ? ` — ${acts}` : ""}` : null;
    }
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

/** Long form of a timestamp for hover (`title`) — weekday + seconds + time zone. */
function whenFull(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" });
  } catch {
    return iso;
  }
}

const regionOf = (i: FieldLayoutItem): "main" | "sidebar" => (i.region === "sidebar" ? "sidebar" : "main");

/** Frozen ticket header (md+, GridCrest 2026-10-29). Measures the sticky header band
 *  and publishes it as `--ticket-head-h` on the page root (the side rail sticks just
 *  below it), sets `scroll-padding-top` on <html> so focus / scrollIntoView never land
 *  under it (cleared on unmount), reports `stuck` (page scrolled → card shadow) and
 *  whether the side rail fits below the header (`railFits`; a taller rail scrolls
 *  with the page so its bottom cards stay reachable). */
function useFrozenHeader(ready: boolean) {
  const headRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const [stuck, setStuck] = useState(false);
  const [railFits, setRailFits] = useState(true);

  useEffect(() => {
    const head = headRef.current;
    if (!ready || !head) return;
    const html = document.documentElement;
    const update = () => {
      // `top` is the sticky offset (= --header-h) at md+; "auto" while it scrolls.
      const top = parseFloat(getComputedStyle(head).top);
      const sticky = !Number.isNaN(top);
      const bottom = (sticky ? top : 0) + head.offsetHeight;
      head.parentElement?.style.setProperty("--ticket-head-h", `${head.offsetHeight}px`);
      html.style.scrollPaddingTop = sticky ? `${Math.ceil(bottom) + 8}px` : "";
      setStuck(sticky && window.scrollY > 0);
      const rail = railRef.current;
      if (rail) setRailFits(rail.offsetHeight <= window.innerHeight - bottom - 24);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(head);
    if (railRef.current) ro.observe(railRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
      html.style.scrollPaddingTop = "";
    };
  }, [ready]);

  return { headRef, railRef, stuck, railFits };
}

/** Short, human description of a single-field edit for the "wasn't saved" toast.
 *  Ids (people/groups) and rich HTML are skipped (null) — those editors either show
 *  the draft still or the value isn't meaningful as text. */
function describeAttempt(body: Record<string, unknown>): string | null {
  const entries = Object.entries(body).filter(([k]) => k !== "expected_updated_at");
  if (entries.length !== 1) return null;
  const [key, v] = entries[0];
  if (["requestor", "assignee", "assigned_group", "description_html"].includes(key)) return null;
  if (key === "priority" && typeof v === "string") return PRIORITY_LABELS[v as Priority] ?? v;
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return "cleared";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const text = Array.isArray(v) ? v.join(", ") : typeof v === "string" || typeof v === "number" ? String(v) : null;
  if (text === null || text.includes("<")) return null;
  return `“${text.length > 60 ? `${text.slice(0, 57)}…` : text}”`;
}

/** Text-entry controls whose draft a background re-render could clobber. */
const TEXT_ENTRY_SELECTOR =
  'textarea, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"])';

export function TicketDetailView({
  ticketId,
  projectKey,
  variant = "page",
  allTickets = false,
}: {
  ticketId: string;
  /** The URL's project. Omitted at `/all/NUMBER` (Modern All Tickets), where the ticket's
   *  own project is used. */
  projectKey?: string;
  /** "docked" = the Modern workbench card beside the queue (step B4, 2026-11-05). */
  variant?: "page" | "docked";
  /** Reached at `/all/NUMBER`: Back, the canonical redirect and Move stay under /all. */
  allTickets?: boolean;
}) {
  const { org, helpdeskKey, helpdesk, projectByKey } = useWorkspace();
  const wb = useWorkbench();
  const { hasPerm, user } = useItsmAuth();
  const meId = user?.id != null ? String(user.id) : null;
  const base = `/t/${org}/agent/w/${helpdeskKey}/p/${projectKey}`;
  // When the agent arrived from the combined "All Tickets" queue (row links carry
  // `?from=all`), "Back to queue" returns there rather than this project's queue.
  const searchParams = useSearchParams();
  const fromAll = allTickets || searchParams.get("from") === "all";
  const backHref = fromAll ? `/t/${org}/agent/w/${helpdeskKey}/all` : base;
  const backLabel = fromAll ? "Back to all tickets" : "Back to queue";
  // Short label for the back crumb in the header's badge row (the old standalone
  // back-link row was removed 2026-10-14 to save ~36px).
  const crumbLabel = fromAll ? "All tickets" : (projectByKey(projectKey ?? "")?.name ?? projectKey);
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
  // Send for approval (2026-10-24): its own permission (Agent/Supervisor/Admin by
  // default); the button also needs the current status to allow it.
  const canSendApproval = hasPerm("itsm.approvals.send", "create");
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
  // The layout's declared sections — carries the admin's "Collapsed" flag per section.
  const [layoutSections, setLayoutSections] = useState<FieldLayoutSection[]>([]);
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
  // The reply composer starts collapsed to a one-line "Add a comment…" bar (it was a
  // ~250px always-open editor). It stays open while a draft or staged file exists.
  const [composerOpen, setComposerOpen] = useState(false);
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
  // Reported by ApprovalPanel: a pending approval freezes status (the server returns
  // no transitions), so the header explains the missing buttons instead.
  const [approvalPending, setApprovalPending] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  // Bumped after Send for approval: when the ticket stays in its status the send
  // doesn't change `updated_at`, so the approval panel needs its own reload signal.
  const [approvalKey, setApprovalKey] = useState(0);

  // ── Live refresh + stale-write guard (U17) ────────────────────────────────
  // Root element: the "is the agent mid-edit?" check looks for inline editors in it.
  const rootRef = useRef<HTMLDivElement>(null);
  // The `updated_at` of the ticket version the agent last saw (on screen / own last
  // write). Inline edits send it as `expected_updated_at`; the server 409s if the
  // ticket changed since. Updated synchronously so queued writes read the fresh one.
  const seenUpdatedAtRef = useRef<string | null>(null);
  // Bumped by every local load / write — a background refresh that started before
  // one is dropped (it would overwrite fresher state).
  const writeSeqRef = useRef(0);
  // Own field writes run one after another so a blur-commit followed by a quick
  // select change can't 409 against itself.
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve());
  // Latest pulse payload (who changed it) for the "Updated by …" pill.
  const pulseRef = useRef<TicketPulse | null>(null);
  // Non-null ⇒ someone else changed the ticket while the agent was editing.
  const [staleBy, setStaleBy] = useState<{ name: string | null } | null>(null);

  const load = useCallback(async () => {
    writeSeqRef.current += 1;
    const t = await ticketsApi.get(ticketId);
    // Canonical-URL redirect: if this ticket was reached via an OLD number (or the
    // URL's project segment is stale) — resolved by the backend alias — its current
    // ticket_number / project_key differ from the URL. Bounce to the canonical URL
    // and skip loading sub-resources for the stale id (avoids a flash + a wasted fetch).
    if (t.ticket_number !== ticketId || (!allTickets && t.project_key !== projectKey)) {
      const from = searchParams.get("from") === "all" ? "?from=all" : "";
      const hk = t.helpdesk_key ?? helpdeskKey;
      setRedirecting(true);
      router.replace(
        allTickets
          ? `/t/${org}/agent/w/${hk}/all/${t.ticket_number}`
          : `/t/${org}/agent/w/${hk}/p/${t.project_key}/${t.ticket_number}${from}`,
      );
      return;
    }
    setTicket(t);
    seenUpdatedAtRef.current = t.updated_at;
    setStaleBy(null);
    // Activity (audit log) is intentionally omitted here — it loads lazily on first
    // open of the Activity tab (see `loadActivity`), so opening a ticket stays cheap.
    const [trs, cs, layout, defs, atts, wchs, lks] = await Promise.all([
      ticketsApi.availableTransitions(ticketId),
      ticketsApi.comments(ticketId),
      layoutsApi
        .resolve(t.project, t.ticket_type)
        .catch(() => ({ id: null, items: [] as FieldLayoutItem[], sections: [] as FieldLayoutSection[] })),
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
    setLayoutSections(layout?.sections ?? []);
    setDefsById(Object.fromEntries(defs.map((d) => [d.id, d])));
    setAttachments(atts);
    setWatchers(wchs);
    setLinks(lks);
    return t;
  }, [ticketId, projectKey, allTickets, org, helpdeskKey, router, searchParams]);

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

  // Silent live apply (someone else changed the ticket): refetch the ticket and its
  // sub-resources WITHOUT the loading skeleton. Layout/defs are left alone. A moved
  // ticket (new number/project) goes through `load()` for its canonical redirect.
  // Dropped if a local load/write started meanwhile (its own refresh is fresher).
  const liveRefresh = useCallback(async () => {
    const seq = writeSeqRef.current;
    const t = await ticketsApi.get(ticketId);
    if (t.ticket_number !== ticketId || (!allTickets && t.project_key !== projectKey)) {
      await load();
      return;
    }
    const [trs, cs, atts, wchs, lks] = await Promise.all([
      ticketsApi.availableTransitions(ticketId),
      ticketsApi.comments(ticketId),
      ticketAttachmentsApi.list(t.id).catch(() => null),
      ticketsApi.watchers(t.id).catch(() => null),
      ticketsApi.links(t.id).catch(() => null),
    ]);
    if (seq !== writeSeqRef.current) return;
    setTicket(t);
    seenUpdatedAtRef.current = t.updated_at;
    setTransitions(trs);
    setComments(cs);
    if (atts) setAttachments(atts);
    if (wchs) setWatchers(wchs);
    if (lks) setLinks(lks);
    setStaleBy(null);
    refreshActivityIfOpen();
  }, [ticketId, projectKey, allTickets, load, refreshActivityIfOpen]);

  /** Run one of the agent's own field writes in order, passing the `updated_at` they
   *  last saw (read at run time) and recording the new one before the next starts. */
  const runWrite = useCallback(<R extends { updated_at: string }>(fn: (expected: string | undefined) => Promise<R>) => {
    writeSeqRef.current += 1;
    const p = writeChainRef.current.then(async () => {
      const res = await fn(seenUpdatedAtRef.current ?? undefined);
      seenUpdatedAtRef.current = res.updated_at;
      return res;
    });
    writeChainRef.current = p.catch(() => undefined);
    return p;
  }, []);

  /** 409 from the stale-write guard: say so, reload the latest version, and name the
   *  value that wasn't saved (open summary/description editors keep their drafts). */
  const handleStaleWrite = useCallback(
    async (attempt: string | null) => {
      toast.warning("This ticket was changed by someone else — refreshed.", {
        description: attempt
          ? `Your change wasn't saved (${attempt}). Check the latest values and re-apply it if it's still needed.`
          : "Your change wasn't saved. Check the latest values and re-apply it if it's still needed.",
      });
      await reload().catch(() => undefined);
    },
    [reload],
  );

  useEffect(() => {
    // New ticket → drop the lazily-loaded log and reset to the Comments tab; the
    // audit log reloads on next open of the Activity tab.
    activityLoadedRef.current = false;
    setActivity([]);
    setActivityStatus("idle");
    setTab("comments");
    setComposerOpen(false);
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
  const project = projectByKey(projectKey ?? ticket?.project_key ?? "");
  const allowedGroups = useMemo(
    () => (project ? allowedGroupsForProject(groups, project, [ticket?.assigned_group]) : groups),
    [groups, project, ticket?.assigned_group],
  );

  // An inline save can come back with a NEW status when a project automation rule ran
  // (e.g. assigning an agent moves New → Assigned). The transition buttons and comments
  // then belong to the new state, so reload them too.
  const statusRef = useRef<string | null>(null);
  useEffect(() => {
    statusRef.current = ticket?.status ?? null;
  }, [ticket?.status]);
  const syncAfterAutomation = useCallback(
    (updated: TicketDetail) => {
      if (statusRef.current === null || updated.status === statusRef.current) return;
      toast.info(`Automation moved this ticket to ${updated.status_name}.`);
      void Promise.all([ticketsApi.availableTransitions(ticketId), ticketsApi.comments(ticketId)])
        .then(([trs, cs]) => {
          setTransitions(trs);
          setComments(cs);
        })
        .catch(() => undefined);
    },
    [ticketId],
  );

  /** Persist standard (column-backed) fields, then refresh the ticket + audit log. */
  const patchColumn = useCallback(
    async (body: UpdateTicketInput, key: string) => {
      setSavingKey(key);
      try {
        const updated = await runWrite((expected) =>
          ticketsApi.update(ticketId, { ...body, expected_updated_at: expected }),
        );
        syncAfterAutomation(updated);
        setTicket(updated);
        refreshActivityIfOpen();
        toast.success("Saved.");
        return true;
      } catch (e) {
        if (e instanceof ItsmApiError && e.status === 409) {
          await handleStaleWrite(describeAttempt(body));
          return false;
        }
        toast.error(e instanceof ItsmApiError ? e.message : "Could not save the change.");
        return false;
      } finally {
        setSavingKey(null);
      }
    },
    [ticketId, refreshActivityIfOpen, syncAfterAutomation, runWrite, handleStaleWrite],
  );

  /** Persist a custom (value-backed) field via the field engine. */
  const saveCustom = useCallback(
    async (key: string, value: unknown) => {
      setSavingKey(`cf:${key}`);
      try {
        const updated = await runWrite((expected) =>
          ticketsApi.setFields(ticketId, { [key]: value }, expected),
        );
        syncAfterAutomation(updated);
        setTicket(updated);
        refreshActivityIfOpen();
        toast.success("Saved.");
      } catch (e) {
        if (e instanceof ItsmApiError && e.status === 409) {
          const name = Object.values(defsById).find((d) => d.key === key)?.name ?? key;
          const shown = describeAttempt({ [key]: value });
          await handleStaleWrite(shown ? `${name}: ${shown}` : name);
          return;
        }
        toast.error(e instanceof ItsmApiError ? e.message : "Could not save the change.");
      } finally {
        setSavingKey(null);
      }
    },
    [ticketId, refreshActivityIfOpen, syncAfterAutomation, runWrite, handleStaleWrite, defsById],
  );

  /** Linked assets (the "Asset" field): diff the edited list against the ticket's and
   *  apply it through the link / unlink / make-primary endpoints, one write at a time
   *  (each carries `expected_updated_at`; a 409 reloads like the other inline edits). */
  const saveAssets = useCallback(
    async (next: LinkedAssetChip[]) => {
      if (!ticket) return;
      const pk = ticket.id;
      const cur = (ticket.assets ?? []).map((a) => a.id);
      const nextIds = next.map((a) => a.id);
      const added = nextIds.filter((id) => !cur.includes(id));
      const removed = cur.filter((id) => !nextIds.includes(id));
      let last: TicketAssetsResponse | null = null;
      const apply = () => {
        const res = last;
        if (res) setTicket((t) => (t ? { ...t, assets: res.assets, updated_at: res.updated_at } : t));
      };
      setSavingKey("assets");
      try {
        if (added.length) last = await runWrite((exp) => ticketsApi.linkAssets(pk, added, exp));
        for (const id of removed) last = await runWrite((exp) => ticketsApi.unlinkAsset(pk, id, exp));
        const primaryNow = (last ? last.assets : ticket.assets ?? [])[0]?.id;
        if (nextIds[0] && primaryNow !== nextIds[0]) {
          last = await runWrite((exp) => ticketsApi.primaryAsset(pk, nextIds[0], exp));
        }
        apply();
        refreshActivityIfOpen();
        toast.success("Saved.");
      } catch (e) {
        if (e instanceof ItsmApiError && e.status === 409) {
          await handleStaleWrite(assetFieldName(defsById));
          return;
        }
        apply(); // keep whatever part of the change already went through
        refreshActivityIfOpen();
        toast.error(e instanceof ItsmApiError ? e.message : "Could not save the change.");
      } finally {
        setSavingKey(null);
      }
    },
    [ticket, runWrite, refreshActivityIfOpen, handleStaleWrite, defsById],
  );

  // U4: `blocked_reason` is computed from the ticket's CURRENT field values, and an
  // inline edit doesn't otherwise reload the transitions — so when the ticket object
  // changes (after its first load) while a button is blocked, refetch them so filling
  // the missing field re-enables it.
  const transitionsTicketRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ticket) return;
    const firstLoad = transitionsTicketRef.current !== ticket.id;
    transitionsTicketRef.current = ticket.id;
    if (firstLoad || !transitions.some((t) => t.blocked_reason)) return;
    void ticketsApi.availableTransitions(ticketId).then(setTransitions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket]);

  // A transition with a note prompt or a capture screen (e.g. Incident Resolve)
  // opens the slide-over; otherwise it moves at once. A blocked one never runs.
  function doTransition(tr: Transition) {
    if (tr.blocked_reason) {
      toast.error(tr.blocked_reason);
      return;
    }
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
    setComposerOpen(false);
  }

  // Open while the agent asked for it OR a draft / staged file exists — a started
  // reply never disappears behind the collapsed bar.
  const showComposer = composerOpen || !!commentBody.trim() || commentFiles.length > 0;

  function cancelComposer() {
    const hasDraft = !!commentBody.trim() || commentFiles.length > 0;
    if (hasDraft && !window.confirm("Discard this reply?")) return;
    resetComposer();
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
    writeSeqRef.current += 1;
    try {
      // @mentions travel inside the body (mention spans); the server extracts and
      // checks them (403 for anyone who isn't an agent of this helpdesk).
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

  // ── @mentions: the composer's "@" list = agents of this ticket's helpdesk ──────
  // Fetched once per ticket (the server endpoint is exactly the set it accepts),
  // then filtered locally per keystroke.
  const mentionCacheRef = useRef<{ ticket: string; users: UserRef[] } | null>(null);
  const ticketUuid = ticket?.id ?? null;
  const searchMentions = useCallback(
    async (query: string): Promise<MentionItem[]> => {
      if (!ticketUuid) return [];
      if (mentionCacheRef.current?.ticket !== ticketUuid) {
        const users = await ticketsApi.mentionable(ticketUuid);
        mentionCacheRef.current = { ticket: ticketUuid, users };
      }
      const q = query.trim().toLowerCase();
      return mentionCacheRef.current.users
        .filter(
          (u) =>
            !q ||
            (u.full_name || "").toLowerCase().includes(q) ||
            u.username.toLowerCase().includes(q) ||
            (u.email || "").toLowerCase().includes(q),
        )
        .slice(0, 8)
        .map((u) => ({ id: String(u.id), label: u.full_name || u.username, detail: u.email || u.username }));
    },
    [ticketUuid],
  );

  // ── Live refresh: poll the per-ticket pulse; apply silently when idle ─────────
  // "Idle" = nothing a re-render could clobber: no reply draft, no open editor /
  // sheet / dialog, no save in flight, and focus isn't in a text field of this ticket.
  function isIdle(): boolean {
    if (showComposer || editingSummary || pendingTransition || moveOpen || busy || savingKey !== null) return false;
    const root = rootRef.current;
    if (root?.querySelector("[data-inline-editing]")) return false;
    const el = typeof document !== "undefined" ? document.activeElement : null;
    if (el instanceof HTMLElement && el.matches(TEXT_ENTRY_SELECTOR)) {
      if (root?.contains(el) || el.closest("[data-radix-popper-content-wrapper]")) return false;
    }
    return true;
  }

  useLivePoll({
    enabled: !!ticket && !redirecting,
    key: ticketId,
    pulse: async () => {
      const p = await ticketsApi.livePulse(ticketId);
      pulseRef.current = p;
      return p.version;
    },
    onChange: async () => {
      const p = pulseRef.current;
      if (isIdle()) {
        await liveRefresh().catch(() => undefined);
        return;
      }
      if (!p || !ticket) return;
      // Our own write (already applied from its response) or automation that ran
      // inside it: nothing on screen is out of date → no pill.
      const sameOnScreen =
        p.updated_at === ticket.updated_at &&
        p.comment_count === comments.length &&
        p.attachment_count === attachments.length;
      if (sameOnScreen || (meId != null && p.last_actor?.id === meId)) return;
      setStaleBy({ name: p.last_actor?.name ?? null });
    },
  });

  const frozen = useFrozenHeader(variant !== "docked" && !loading && !redirecting && !!ticket);

  // Docked (Modern workbench) keys: J/K page through the queue, [ hides the queue, ] the
  // details panel, Esc closes, R / N open the reply / internal-note composer. Leaving a
  // ticket with an unsent reply asks first (the composer's Cancel does the same).
  const hasDraft = !!commentBody.trim() || commentFiles.length > 0;
  const leaveOk = () => !hasDraft || window.confirm("Discard your unsent reply?");
  const openComposer = (vis: CommentVisibility) => {
    setTab("comments");
    setCommentVisibility(vis);
    setComposerOpen(true);
  };
  usePageShortcuts(
    {
      j: () => {
        if (leaveOk()) wb?.navigate(1);
      },
      k: () => {
        if (leaveOk()) wb?.navigate(-1);
      },
      "[": () => wb?.toggleList(),
      "]": () => wb?.togglePanel(),
      escape: () => {
        if (editingSummary) return false;
        if (leaveOk()) wb?.close();
      },
      r: () => openComposer("public"),
      n: () => (canPostPrivate ? openComposer("private") : false),
    },
    variant === "docked" && !!wb && !!ticket,
  );

  if ((loading || redirecting) && variant === "docked")
    return (
      <div className="space-y-3 p-4" aria-busy="true">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="mt-4 h-40" />
        <Skeleton className="h-56" />
      </div>
    );
  if (loading || redirecting)
    return (
      <div className="space-y-4 compact:space-y-3">
        <Skeleton className="h-24 rounded-xl compact:h-20" />
        <div className="grid gap-6 compact:gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
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
  // Layout → section "Collapsed": the section starts closed on this page (agents can
  // expand it; nothing is remembered — every ticket opens with the layout default).
  const startsCollapsed = (region: "main" | "sidebar", name: string) =>
    layoutSections.some((sec) => sec.region === region && sec.name === name && sec.collapsed);
  const t = ticket;

  // Priority is re-derived server-side when Impact/Urgency change (update_ticket) —
  // only worth saying when both fields are on this ticket's layout.
  const hasCol = (col: string) => rows.some((r) => ((r.def.config ?? {}) as Cfg).maps_to === col);
  const extraHelp: Record<string, string> = {};
  if (hasCol("impact") && hasCol("urgency")) extraHelp.priority = TICKET_HELP.priorityAuto;
  if ((project?.allowed_group_ids?.length ?? 0) > 0) extraHelp.assigned_group = TICKET_HELP.groupWhitelist;

  const fieldProps = {
    ticket: t,
    attachments,
    extraHelp,
    canEdit,
    groups: allowedGroups,
    savingKey,
    onSaveColumn: patchColumn,
    onSaveCustom: saveCustom,
    onSaveAssets: saveAssets,
    assetBase: `/t/${org}/agent/w/${t.helpdesk_key ?? helpdeskKey}/assets/list`,
    helpdeskId: helpdesk?.id ?? null,
  };

  async function deleteTicket() {
    if (!window.confirm(
      `Delete ticket ${ticketId}? Its SLA clocks stop, pending approvals and unsent emails are ` +
      `cancelled, and it leaves reports and dashboards. This can't be undone.`,
    )) return;
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

  // ── Render pieces (step B4): built once, placed by the page layout below (today's
  //    markup, unchanged) or by the docked Modern workbench card. Plain elements and
  //    a render function, never components defined here (focus-stability rule). ──
  const printPortal = mounted
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
                            className={cn("prose prose-sm mt-1 max-w-none", MENTION_PRINT_CLS)}
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
        : null;

  const summaryBlock = (titleCls: string) =>
    editingSummary ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                autoFocus
                spellCheck
                aria-label="Ticket summary"
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
                className="h-9 w-[28rem] max-w-full text-base font-semibold"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveSummary();
                  if (e.key === "Escape") setEditingSummary(false);
                }}
              />
              <Hint label={!summaryDraft.trim() ? "The summary can't be empty" : "Save (Enter) · Esc cancels"}>
                <Button size="sm" disabled={savingKey === "summary" || !summaryDraft.trim()} onClick={saveSummary}>
                  Save
                </Button>
              </Hint>
              <Button size="sm" variant="ghost" disabled={savingKey === "summary"} onClick={() => setEditingSummary(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className={titleCls}>{t.summary}</h1>
              {canEdit ? (
                <IconButton
                  label="Edit summary"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setSummaryDraft(t.summary);
                    setEditingSummary(true);
                  }}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
          );

  const watchAttach = (
    <>
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
    </>
  );

  const transitionButtons = (
    <>
          {transitions.map((tr) => (
            <Hint
              key={tr.id}
              label={
                busy
                  ? "Wait for the current action to finish"
                  : tr.blocked_reason
                    ? transitionBlockedHint(tr)
                    : transitionHint(tr)
              }
            >
              <Button variant="outline" size="sm" disabled={busy || !!tr.blocked_reason} onClick={() => doTransition(tr)}>
                {tr.name}
              </Button>
            </Hint>
          ))}
          {canSendApproval && t.status_allows_approval && !approvalPending ? (
            <Hint label={busy ? "Wait for the current action to finish" : TICKET_HELP.sendForApproval}>
              <Button variant="outline" size="sm" className="gap-1" disabled={busy} onClick={() => setSendOpen(true)}>
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Send for approval
              </Button>
            </Hint>
          ) : null}
          {transitions.length === 0 && approvalPending ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Awaiting approval
              <InfoTip label="Why can't I change the status?">{TICKET_HELP.approvalLock}</InfoTip>
            </span>
          ) : null}
    </>
  );

  const moreMenu = canPrint || canMove || canDelete ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="More actions" className="h-[var(--ctl-h-sm)] w-[var(--ctl-h-sm)]">
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {canPrint ? (
                  <Hint label={TICKET_HELP.print} side="left">
                    <DropdownMenuItem onClick={printTicket}>
                      <Printer className="mr-2 h-4 w-4" aria-hidden="true" /> Print
                    </DropdownMenuItem>
                  </Hint>
                ) : null}
                {canMove ? (
                  <Hint label={TICKET_HELP.move} side="left">
                    <DropdownMenuItem onClick={() => setMoveOpen(true)}>
                      <FolderInput className="mr-2 h-4 w-4" aria-hidden="true" /> Move ticket
                    </DropdownMenuItem>
                  </Hint>
                ) : null}
                {canDelete ? (
                  <>
                    {canPrint || canMove ? <DropdownMenuSeparator /> : null}
                    <Hint label={deleting ? "" : TICKET_HELP.delete} side="left">
                      <DropdownMenuItem
                        disabled={deleting}
                        onClick={deleteTicket}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                        {deleting ? "Deleting…" : "Delete ticket"}
                      </DropdownMenuItem>
                    </Hint>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null;

  const mainColumn = (
    <>
          {/* Approvals sit at the top of the main column so a pending sign-off is the
              first thing an approver sees. Renders nothing when the ticket has none. */}
          <ApprovalPanel
            ticketId={t.id}
            onDecision={reload}
            onPendingChange={setApprovalPending}
            reloadKey={`${t.updated_at}:${approvalKey}`}
          />

          {mainSections.map((sec) => {
            // A section made only of Resolve-captured columns (Resolution Details) that
            // are all still empty collapses to one line until something is recorded.
            const captureOnlyEmpty = sec.rows.every((r) => {
              const col = ((r.def.config ?? {}) as Cfg).maps_to;
              return !!col && CAPTURE_ONLY_MAPS_TO.has(col) && isEmptyValue((t as Record<string, unknown>)[col]);
            });
            // Keyed per ticket: opening another ticket starts from the layout default.
            return (
              <FieldSectionCard
                key={`${t.id}:${sec.name}`}
                title={sec.name}
                collapsible
                defaultOpen={!captureOnlyEmpty && !startsCollapsed("main", sec.name)}
                summary={captureOnlyEmpty ? "Nothing recorded yet · captured on Resolve" : undefined}
                collapsedHint={captureOnlyEmpty ? TICKET_HELP.resolutionCollapsed : TICKET_HELP.sectionCollapsed}
              >
                <div className={FIELD_GRID_CLS}>
                  {sec.rows.map((r) => (
                    <div key={r.item.id} className={cn("min-w-0", fieldSpanClass(r.def.field_type, r.item.width))}>
                      <FieldView def={r.def} block {...fieldProps} />
                    </div>
                  ))}
                </div>
              </FieldSectionCard>
            );
          })}

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
            <TabsList className="m-3 compact:m-2">
              <TabsTrigger value="comments" className="data-[state=active]:text-primary">Comments{comments.length ? ` (${comments.length})` : ""}</TabsTrigger>
              {/* Hint INSIDE the trigger: a raw tooltip trigger around TabsTrigger would overwrite
                  its data-state (active styling) with the tooltip's open state. */}
              <TabsTrigger value="activity" className="data-[state=active]:text-primary">
                <Hint label={TICKET_HELP.activityTab}>
                  <span>Activity</span>
                </Hint>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="comments" className="px-4 pb-4 pt-0 compact:mt-1 compact:px-3 compact:pb-3">
              <ul className="space-y-3 compact:space-y-2">
                {comments.length === 0 ? (
                  <li className="text-sm text-muted-foreground">No comments yet.</li>
                ) : (
                  comments.map((c) => (
                    <li
                      key={c.id}
                      className={`flex gap-3 rounded-xl border p-3.5 compact:p-2.5 ${
                        c.visibility === "private" ? "border-warning/30 bg-warning/5" : "bg-background"
                      }`}
                    >
                      <UserAvatar user={c.author ?? null} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{c.author?.full_name ?? "Someone"}</span>
                          {c.visibility === "private" ? (
                            <Hint label={TICKET_HELP.internalBadge}>
                              <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 font-medium text-warning">
                                <Lock className="h-3 w-3" aria-hidden="true" /> Internal
                              </span>
                            </Hint>
                          ) : null}
                          <span title={whenFull(c.created_at)}>· {when(c.created_at)}</span>
                        </div>
                        <ExpandableHtml
                          html={c.body_html}
                          className={cn("prose prose-sm max-w-none dark:prose-invert", MENTION_CHIP_CLS)}
                        />
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
              {/* Collapsed composer: one line until the agent starts a reply. Never hides
                  a started draft or staged files (showComposer). */}
              {!showComposer ? (
                <div className="mt-4 flex items-center gap-2 compact:mt-3">
                  <UserAvatar user={user} size="sm" className="hidden shrink-0 sm:inline-flex" />
                  <Hint label={TICKET_HELP.publicComment} align="start">
                    <button
                      type="button"
                      onClick={() => {
                        setCommentVisibility("public");
                        setComposerOpen(true);
                      }}
                      className="flex h-[var(--ctl-h)] min-w-0 flex-1 items-center rounded-md border border-input bg-background px-3 text-left text-sm text-muted-foreground transition-colors hover:border-ring/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      Add a comment…
                    </button>
                  </Hint>
                  {canPostPrivate ? (
                    <Hint label={TICKET_HELP.internalNote}>
                      {/* A real (outlined, brand-ink) action button, level with the comment
                          box — as plain ghost text it read as a label (GridCrest 2026-10-29). */}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-[var(--ctl-h)] shrink-0 gap-1.5 border-primary/40 text-primary-ink hover:border-primary/60 hover:bg-primary/5 hover:text-primary-ink"
                        onClick={() => {
                          setCommentVisibility("private");
                          setComposerOpen(true);
                        }}
                      >
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        Internal note
                      </Button>
                    </Hint>
                  ) : null}
                </div>
              ) : (
              <form onSubmit={submitComment} className="mt-4 flex gap-3 compact:mt-3">
                <UserAvatar user={user} size="sm" className="mt-0.5 hidden shrink-0 sm:inline-flex" />
                <div className="min-w-0 flex-1 space-y-2">
                {/* Visibility selector — Public Comment is the default; agents may switch
                    to an Internal note (hidden from the requestor). Requestors don't see it. */}
                {canPostPrivate ? (
                  <div className="inline-flex gap-0.5 rounded-lg border bg-muted/40 p-0.5 text-sm" role="group" aria-label="Comment visibility">
                    <Hint label={TICKET_HELP.publicComment}>
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
                      <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> Public Comment
                    </button>
                    </Hint>
                    <Hint label={TICKET_HELP.internalNote}>
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
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Internal Note
                    </button>
                    </Hint>
                  </div>
                ) : null}
                <RichTextEditor
                  ref={commentEditorRef}
                  autoFocus
                  value={commentBody}
                  onChange={setCommentBody}
                  onImageUpload={handleCommentImage}
                  mentions={searchMentions}
                  minHeight={96}
                  ariaLabel={commentVisibility === "private" ? "Add an internal note" : "Add a comment"}
                  placeholder={
                    commentVisibility === "private"
                      ? `Write an internal note (only agents can see this)… ${TICKET_HELP.mentionPlaceholder}`
                      : `Write a public reply… ${TICKET_HELP.mentionPlaceholder}`
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
                        <span className="max-w-[12rem] truncate" title={f.original_name || "file"}>{f.original_name || "file"}</span>
                        <IconButton
                          label={`Remove ${f.original_name || "file"}`}
                          className="h-5 w-5 text-muted-foreground hover:text-foreground"
                          onClick={() => setCommentFiles((prev) => prev.filter((x) => x.id !== f.id))}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </IconButton>
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
                    <Hint label={attaching ? "" : TICKET_HELP.attachFiles}>
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
                    </Hint>
                    {canCanned && helpdesk?.id ? (
                      <CannedResponsePicker
                        helpdeskId={helpdesk.id}
                        disabled={busy}
                        onInsert={(html) => commentEditorRef.current?.insertContent(html)}
                      />
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={cancelComposer}>
                      Cancel
                    </Button>
                    <Hint
                      label={
                        attaching
                          ? "Wait for attachments to finish uploading"
                          : !commentBody.trim() && commentFiles.length === 0
                            ? "Type a message or attach a file first"
                            : ""
                      }
                    >
                      <Button
                        type="submit"
                        size="sm"
                        disabled={busy || attaching || (!commentBody.trim() && commentFiles.length === 0)}
                      >
                        {commentVisibility === "private" ? "Add internal note" : "Add comment"}
                      </Button>
                    </Hint>
                  </div>
                </div>
                </div>
              </form>
              )}
            </TabsContent>

            <TabsContent value="activity" className="px-4 pb-4 pt-0 compact:mt-1 compact:px-3 compact:pb-3">
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
                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 pb-4 text-sm text-muted-foreground compact:pb-2.5">
                          <span className="font-medium text-foreground">{a.actor?.full_name ?? "System"}</span>
                          <span>{activityVerb(a)}</span>
                          {detail ? <span className="font-medium text-foreground">{detail}</span> : null}
                          <span className="text-xs" title={whenFull(a.created_at)}>· {when(a.created_at)}</span>
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </TabsContent>
          </Tabs>
    </>
  );

  const sideRail = (
    <>
          {sideSections.map((sec) => (
            <SideSectionCard
              key={`${t.id}:${sec.name}`}
              title={sec.name}
              defaultOpen={!startsCollapsed("sidebar", sec.name)}
              collapsedHint={TICKET_HELP.sectionCollapsed}
            >
              {/* Label beside value (one row per field) instead of label above control. */}
              <div className="space-y-2.5 compact:space-y-1.5">
                {sec.rows.map((r) => {
                  const isRequestor = ((r.def.config ?? {}) as { maps_to?: string }).maps_to === "requestor";
                  return (
                    <FieldView
                      key={r.item.id}
                      def={r.def}
                      {...fieldProps}
                      block
                      labelSide
                      trailing={
                        isRequestor ? (
                          <RequestorProfile user={t.requestor} attributes={t.requestor_attributes ?? []} />
                        ) : undefined
                      }
                    />
                  );
                })}
              </div>
            </SideSectionCard>
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
          <dl className="rounded-xl border bg-card shadow-soft p-4 text-sm transition-shadow duration-200 hover:shadow-soft-md compact:px-3 compact:py-1.5">
            <Row label="Type">{t.ticket_type_name ?? "—"}</Row>
            <Row label="Created">{when(t.created_at)}</Row>
            <Row label="Created by">{personOneLine(t.created_by)}</Row>
            <Row label="Last updated">{when(t.updated_at)}</Row>
            <Row label="Updated by">{personOneLine(t.updated_by)}</Row>
          </dl>
    </>
  );

  const stalePill = staleBy ? (
        <div
          className={
            variant === "docked"
              ? "absolute bottom-4 left-1/2 z-40 -translate-x-1/2 print:hidden"
              : "fixed bottom-6 left-1/2 z-40 -translate-x-1/2 print:hidden"
          }
        >
          <Hint label={TICKET_HELP.liveRefresh}>
            <button
              type="button"
              onClick={() => void liveRefresh().catch(() => toast.error("Could not refresh the ticket."))}
              className="inline-flex items-center gap-1.5 rounded-full border bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {staleBy.name ? `Updated by ${staleBy.name} — Refresh` : "Ticket updated — Refresh"}
            </button>
          </Hint>
        </div>
      ) : null;

  const overlays = (
    <>
      {pendingTransition ? (
        <TransitionNoteSheet
          transition={pendingTransition}
          defs={Object.values(defsById)}
          ruleValues={ruleValues}
          busy={busy}
          onCancel={() => setPendingTransition(null)}
          onSubmit={(comment, fields) => void runTransition(pendingTransition, comment, fields)}
        />
      ) : null}

      {celebration ? (
        <SlaCelebration result={celebration} onClose={() => setCelebration(null)} />
      ) : null}

      {sendOpen && ticket ? (
        <SendForApprovalSheet
          ticketId={ticket.id}
          ticketLabel={`${ticket.ticket_number} · ${ticket.summary}`}
          onClose={() => setSendOpen(false)}
          onSent={() => {
            setSendOpen(false);
            setApprovalPending(true);
            setApprovalKey((k) => k + 1);
            void reload();
          }}
        />
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
            router.replace(
              allTickets
                ? `/t/${org}/agent/w/${hk}/all/${moved.ticket_number}`
                : `/t/${org}/agent/w/${hk}/p/${moved.project_key}/${moved.ticket_number}${from}`,
            );
          }}
        />
      ) : null}
    </>
  );

  if (variant === "docked") {
    const pos = wb?.position ?? null;
    const projectName = projectByKey(t.project_key)?.name ?? t.project_key;
    return (
      <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
        {printPortal}
        {/* 3px priority hairline across the top of the card. */}
        <span
          aria-hidden="true"
          className={cn("pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px]", PRIORITY_HAIRLINE[t.priority] ?? "bg-transparent")}
        />
        <div className="shrink-0 border-b px-3 pt-1">
          {/* Row 1: number · project › type | ← i of N → … watch · attach · ⋯ | panel · maximise · close */}
          <div className="flex h-9 min-w-0 items-center gap-1.5">
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-muted-foreground">
              {t.ticket_number}
            </span>
            <span
              className="min-w-0 truncate text-xs text-muted-foreground"
              title={`${projectName}${t.ticket_type_name ? ` › ${t.ticket_type_name}` : ""}`}
            >
              {projectName}
              {t.ticket_type_name ? ` › ${t.ticket_type_name}` : ""}
            </span>
            {wb ? (
              <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 border-l pl-2 text-xs tabular-nums text-muted-foreground">
                <IconButton
                  label={WORKBENCH_HELP.prev}
                  disabledReason={pos ? WORKBENCH_HELP.atFirst : WORKBENCH_HELP.notInList}
                  disabled={!pos || pos.index <= 1}
                  className="h-6 w-6"
                  onClick={() => {
                    if (leaveOk()) wb.navigate(-1);
                  }}
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </IconButton>
                <span aria-live="polite">{pos ? `${pos.index} of ${pos.total}` : "—"}</span>
                <IconButton
                  label={WORKBENCH_HELP.next}
                  disabledReason={pos ? WORKBENCH_HELP.atLast : WORKBENCH_HELP.notInList}
                  disabled={!pos || pos.index >= pos.total}
                  className="h-6 w-6"
                  onClick={() => {
                    if (leaveOk()) wb.navigate(1);
                  }}
                >
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </IconButton>
              </span>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {watchAttach}
              {moreMenu}
              <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
              <IconButton
                label={wb?.panelOpen ? WORKBENCH_HELP.hidePanel : WORKBENCH_HELP.showPanel}
                aria-pressed={!!wb?.panelOpen}
                className="h-7 w-7"
                onClick={() => wb?.togglePanel()}
              >
                <PanelRight className="h-4 w-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                label={wb?.listHidden ? WORKBENCH_HELP.restore : WORKBENCH_HELP.maximise}
                className="h-[26px] w-[26px] bg-success/15 text-success hover:bg-success hover:text-success-foreground"
                onClick={() => wb?.toggleList()}
              >
                {wb?.listHidden ? (
                  <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </IconButton>
              <IconButton
                label={WORKBENCH_HELP.close}
                className="h-[26px] w-[26px] bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => {
                  if (leaveOk()) wb?.close();
                }}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </div>
          </div>
          {/* Row 2: the title (20px, two lines at most) */}
          <div className="px-1 pb-1.5">
            {summaryBlock("line-clamp-2 text-xl font-semibold leading-[1.625rem] tracking-tight")}
          </div>
          {/* Row 3: status · priority · the workflow's buttons … requester · when */}
          <div className="flex flex-wrap items-center gap-1.5 px-1 pb-2">
            <StatusBadge name={t.status_name} category={t.status_category} color={t.status_color} />
            <PriorityTag priority={t.priority} />
            {transitionButtons}
            <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {t.requestor ? <UserAvatar user={t.requestor} size="sm" /> : null}
              <span className="truncate" title={whenFull(t.created_at)}>
                {t.requestor ? `${t.requestor.full_name || t.requestor.username} · ` : ""}
                {when(t.created_at)}
              </span>
            </span>
          </div>
          {/* Row 4: the resolution clock as one horizon bar */}
          <SlaHorizon entry={t.sla?.resolution} className="px-1 pb-2" />
        </div>
        <div className={cn("grid min-h-0 flex-1", wb?.panelOpen ? "grid-cols-[minmax(0,1fr)_320px]" : "grid-cols-1")}>
          <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto p-4">{mainColumn}</div>
          {wb?.panelOpen ? (
            <aside
              aria-label="Ticket details"
              className="min-h-0 space-y-2 overflow-y-auto border-l bg-muted/30 p-2.5 [--side-label-w:6rem]"
            >
              {sideRail}
            </aside>
          ) : null}
        </div>
        {stalePill}
        {overlays}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="space-y-4 compact:space-y-3">
      {/* Print-only ticket sheet — portaled into <body> so the globals.css @media print rule
          can display:none every OTHER body child (no blank trailing pages). It mirrors what's
          on screen: every visible layout field (main + sidebar) via fieldValue(), the requestor
          profile, ticket metadata and public comments. Reuses loaded state (no extra fetch). */}
      {printPortal}

      {/* Frozen header (md+): the card stays under the app header while the page
          scrolls (GridCrest 2026-10-29). The band runs edge to edge in the opaque page
          colour, so content scrolls under it rather than around the card (pb-2 masks the
          card's rounded bottom corners; -mb-2 keeps the resting gap). It must stay the
          root's first child: `space-y` would override its -mt-main-y otherwise. */}
      <div
        ref={frozen.headRef}
        className="relative z-30 -mx-main-x -mb-2 -mt-main-y px-main-x pb-2 pt-main-y md:sticky md:top-header"
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-background" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-muted/30" />
      <div className={cn("relative overflow-hidden rounded-xl border bg-card shadow-soft transition-shadow", frozen.stuck && "shadow-soft-md")}>
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-chart-4/[0.06] to-transparent" />
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary to-chart-4" />
        <div className="relative flex flex-wrap items-start gap-3 p-5 compact:px-4 compact:py-3">
        {/* flex-1: the title takes the row and the action cluster stays beside it
            (without it a long summary pushed every action onto its own line). */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2 compact:mb-1">
            {/* Back crumb — replaces the standalone "Back to queue" row above the card. */}
            {/* Accessible name = the visible crumb text (WCAG 2.5.3); the hint says where it goes. */}
            <Hint label={backLabel} side="bottom" align="start">
              <Link
                href={backHref}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                {crumbLabel}
              </Link>
            </Hint>
            <span className="text-xs text-muted-foreground/60" aria-hidden="true">/</span>
            <span className="rounded-md bg-accent px-2 py-0.5 font-mono text-xs font-semibold text-accent-foreground">
              {t.ticket_number}
            </span>
            <StatusBadge name={t.status_name} category={t.status_category} color={t.status_color} />
            <PriorityTag priority={t.priority} />
          </div>
          {summaryBlock("text-xl font-semibold tracking-tight sm:text-2xl compact:text-xl")}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {watchAttach}
          {transitionButtons}
          {moreMenu}
        </div>
        </div>
      </div>
      </div>

      {/* items-start: the side rail is sticky and must not stretch to the main column. */}
      <div className="grid items-start gap-6 compact:gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* main column — layout "main" fields, then comments + activity */}
        <div className="min-w-0 space-y-6 compact:space-y-4">
          {mainColumn}
        </div>

        {/* details rail — workflow meta + layout "sidebar" fields */}
        {/* Sticky just below the frozen header (--header-h + --ticket-head-h) so status,
            people and SLA stay in view while the main column scrolls — but only while
            the rail fits the viewport; a taller rail scrolls with the page so its lower
            cards stay reachable. No inner scroll: InlineUserPicker's result list isn't
            portaled and would be clipped. The separate Status card was removed — the
            header already shows the status. */}
        <aside
          ref={frozen.railRef}
          aria-label="Ticket details"
          className={cn(
            "space-y-3 compact:space-y-2",
            frozen.railFits && "lg:sticky lg:top-[calc(var(--header-h)+var(--ticket-head-h,0px)+0.75rem)]",
          )}
        >
          {sideRail}
        </aside>
      </div>

      {/* Live-refresh pill — someone else changed the ticket while the agent was
          mid-edit (else it's applied silently). Click = load the latest; drafts in the
          composer / summary / description editors are local state and survive. */}
      {stalePill}
      {overlays}
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
  def,
  value,
  onChange,
  disabled,
}: {
  field: TransitionScreenField;
  /** The field's definition (admin tooltip / description), when loaded. */
  def?: FieldDefinition;
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
          spellCheck
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
          spellCheck
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="block text-sm font-medium">
          {field.name}
          {field.is_mandatory ? <span className="text-destructive"> *</span> : null}
        </label>
        <InfoTip label={`What does ${field.name} mean?`}>{fieldHelp(def ?? { key: field.field_key })}</InfoTip>
      </div>
      {control}
    </div>
  );
}

/** Slide-over that captures a note and/or transition-screen fields when a transition
 *  prompts for them (e.g. Incident Resolve → Resolution Details). Module-top-level
 *  (React focus-stability); it owns the drafts, blocks submit while a mandatory note or
 *  screen field is empty, and hands back the heading-prefixed comment HTML + field values.
 *  A screen field with a layout "show when …" rule follows it live (values = the ticket's
 *  current ones, status = the target status, overlaid by what's typed here): hidden →
 *  not shown, not required, not sent; read-only → disabled, not required, not sent.
 *  The engine applies the same rule (`engine._screen_rule_states`). */
function TransitionNoteSheet({
  transition,
  defs,
  ruleValues,
  busy,
  onCancel,
  onSubmit,
}: {
  transition: Transition;
  defs: FieldDefinition[];
  /** The ticket's current field values keyed by field key (see `ruleValues` above). */
  ruleValues: Values;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (commentHtml: string, fields: Record<string, unknown>) => void;
}) {
  const [note, setNote] = useState("");
  const [fieldVals, setFieldVals] = useState<Record<string, unknown>>({});
  const heading = transition.note_heading?.trim() || transition.name;
  const isPrivate = transition.note_visibility === "private";
  const noteRequired = !!transition.note_required;
  const noteEmpty = !note.trim();
  const ruleCtx: Values = { ...ruleValues, status: transition.to_status_key, ...fieldVals };
  const screenFields = (transition.screen_fields ?? [])
    .map((f) => ({ f, st: evalRule(normRule(f.visibility_rule), ruleCtx) }))
    .filter(({ st }) => st.visible);
  // Fields the agent fills in now: shown and not locked by a rule.
  const editable = screenFields.filter(({ st }) => !st.readonly).map(({ f }) => f);
  const missingNames = editable
    .filter((f) => f.is_mandatory && isEmptyScreenValue(fieldVals[f.field_key]))
    .map((f) => f.name);
  const missingField = missingNames.length > 0;
  const canSubmit = !busy && !(transition.note_prompt && noteRequired && noteEmpty) && !missingField;
  const blockedReason = busy
    ? ""
    : missingNames.length
      ? `Fill in the required fields: ${missingNames.join(", ")}`
      : transition.note_prompt && noteRequired && noteEmpty
        ? "Add a note first"
        : "";

  function submit() {
    if (!canSubmit) return;
    // Prefix the configured heading so the comment/activity log is self-describing.
    const comment = noteEmpty ? "" : `<p><strong>${escapeHtml(heading)}</strong></p>${note}`;
    const out: Record<string, unknown> = {};
    for (const f of editable) {
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
          {screenFields.map(({ f, st }) => (
            <ScreenFieldControl
              key={f.field_key}
              field={st.readonly ? { ...f, is_mandatory: false } : f}
              def={defs.find((d) => d.key === f.field_key)}
              value={fieldVals[f.field_key]}
              onChange={(v) => setFieldVals((prev) => ({ ...prev, [f.field_key]: v }))}
              disabled={busy || st.readonly}
            />
          ))}
          {transition.note_prompt ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {heading}
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
          <Hint label={blockedReason}>
            <Button size="sm" className="gap-1" onClick={submit} disabled={!canSubmit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {transition.name}
            </Button>
          </Hint>
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
    if (!window.confirm(`Remove the link to “${link.other_number}”? This can't be undone.`)) return;
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
    <dl
      className={cn(
        "rounded-xl border bg-card shadow-soft text-sm",
        links.length === 0 && !adding ? "px-4 py-2 compact:px-3 compact:py-1.5" : "p-4 compact:p-3",
      )}
    >
      {/* Empty: a single header row ("Linked issues · None" + Link) instead of a card
          with a "No linked tickets yet." line. */}
      <div className={cn("flex items-center justify-between gap-2", (links.length > 0 || adding) && "mb-2")}>
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Linked issues
          {links.length === 0 && !adding ? (
            <span className="font-normal normal-case tracking-normal text-muted-foreground">· None</span>
          ) : null}
        </p>
        {canEdit && !adding ? (
          <Hint label={busy ? "" : "Link this ticket to another one (relates to, blocks, duplicates…)"}>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Link
            </Button>
          </Hint>
        ) : null}
      </div>


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
                  <IconButton
                    label={`Remove link to ${l.other_number}`}
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    onClick={() => void removeLink(l)}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </IconButton>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {canEdit && adding ? (
        <div className="mt-2 space-y-2 rounded-md border bg-muted/40 p-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">This ticket…</span>
            <InfoTip label="What do the link types mean?">{LINK_TYPE_HELP}</InfoTip>
          </div>
          <Select value={linkType} onValueChange={(v) => setLinkType(v as LinkType)}>
            <SelectTrigger className="h-9" aria-label="Link type"><SelectValue /></SelectTrigger>
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

const CountIconButton = forwardRef<
  HTMLButtonElement,
  { icon: React.ReactNode; count: number; label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function CountIconButton({ icon, count, label, ...props }, ref) {
  // Icon-only popover trigger: IconButton gives it the aria-label AND the hover
  // tooltip. It forwards ref + props, so it is the PopoverTrigger's own child (no
  // wrapping <span> — a span carrying aria-haspopup/aria-expanded failed axe).
  return (
    <IconButton
      ref={ref}
      label={label}
      variant="outline"
      className="relative h-[var(--ctl-h-sm)] w-[var(--ctl-h-sm)]"
      {...props}
    >
      {icon}
      {count > 0 ? (
        <Badge
          variant="secondary"
          className="absolute -right-1.5 -top-1.5 h-4 min-w-[1rem] justify-center rounded-full px-1 text-[10px] leading-none"
        >
          {count}
        </Badge>
      ) : null}
    </IconButton>
  );
});

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
        <CountIconButton
          icon={<Eye className="h-4 w-4" aria-hidden="true" />}
          count={watchers.length}
          label={`Watchers (${watchers.length})`}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Watchers</p>
          {meId != null ? (
            <Hint label={busy ? "" : isSelfWatching ? TICKET_HELP.unwatch : TICKET_HELP.watch}>
              <Button type="button" size="sm" variant={isSelfWatching ? "outline" : "secondary"} disabled={busy} onClick={toggleSelf}>
                <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {isSelfWatching ? "Unwatch" : "Watch"}
              </Button>
            </Hint>
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
                    <IconButton
                      label={`Remove ${w.user.full_name || w.user.username} as a watcher`}
                      detail="Removes immediately — they stop getting updates"
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={busy}
                      onClick={() => void removeWatcher(w)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </IconButton>
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
        <CountIconButton
          icon={<Paperclip className="h-4 w-4" aria-hidden="true" />}
          count={attachments.length}
          label={`Attachments (${attachments.length})`}
        />
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
              <Hint label={uploading ? "" : TICKET_HELP.addFiles}>
                <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {uploading ? "Uploading…" : "Add files"}
                </Button>
              </Hint>
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
                  <Hint label={`Download ${a.original_name || "file"}`}>
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
                  </Hint>
                  {canEdit ? (
                    <IconButton
                      label={`Delete ${a.original_name || "file"}`}
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => void removeAttachment(a)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
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

/** Ticket columns that are captured on the Resolve transition screen (and Record
 *  Known Error for workaround_provided), not edited inline — exactly the
 *  Resolution-Details set left out of IMPACT_ASSESSMENT_MAPS_TO. A layout section made
 *  only of these, all still empty, renders collapsed on the detail view. */
const CAPTURE_ONLY_MAPS_TO = new Set(["resolution_code", "root_cause", "workaround_provided", "resolution_notes"]);

/** Why a field has no inline editor for an agent who can otherwise edit (mirrors
 *  FieldView.buildEditor's read-only branches). */
function readOnlyWhy(def: FieldDefinition): string {
  const cfg = (def.config ?? {}) as Cfg & { system_set?: boolean };
  // The Asset field has its own editor (FieldView's asset branch), never read-only here.
  if (cfg.maps_to === "assets" || def.field_type === "asset_picker") return "";
  if (cfg.maps_to && CAPTURE_ONLY_MAPS_TO.has(cfg.maps_to)) return TICKET_HELP.captureOnly;
  if (cfg.maps_to === "source" || cfg.system_set) return TICKET_HELP.systemSet;
  if (cfg.maps_to) return TICKET_HELP.columnReadOnly;
  if (def.field_type === "user_picker") return TICKET_HELP.userPickerReadOnly;
  return "";
}

const isEmptyValue = (v: unknown) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** Field types that keep their label ABOVE the control even in the side rail's
 *  label-beside-value rows (a tall control doesn't fit a 8rem label column). */
const TALL_FIELD_TYPES = new Set(["richtext", "multiline", "attachment", "multiselect", "cascade", "asset_picker"]);

type FieldViewProps = {
  def: FieldDefinition;
  ticket: TicketDetail;
  attachments: Attachment[];
  block?: boolean;
  /** Side-rail layout: label beside the value on one row (2026-10-14). */
  labelSide?: boolean;
  /** Extra content rendered under the field, full width (the requestor profile). */
  trailing?: React.ReactNode;
  canEdit: boolean;
  groups: Group[];
  savingKey: string | null;
  onSaveColumn: (body: UpdateTicketInput, key: string) => Promise<boolean>;
  onSaveCustom: (key: string, value: unknown) => void;
  /** Save the edited linked-asset list (the "Asset" field). */
  onSaveAssets: (next: LinkedAssetChip[]) => void;
  /** `/t/<org>/agent/w/<hk>/assets/list` — asset page links on the Asset field chips. */
  assetBase: string;
  /** The ticket's helpdesk id (asset search + the requestor's assets). */
  helpdeskId: string | null;
  /** Extra ⓘ help keyed by `config.maps_to` (Priority auto-calc, team whitelist). */
  extraHelp?: Record<string, string>;
};

/** Render one layout field — editable inline when the agent has update rights,
 *  else a read-only value. Column-backed fields (config.maps_to) save through the
 *  ticket PATCH; custom value-backed fields save through the field engine. */
function FieldView({
  def,
  ticket,
  attachments,
  block,
  labelSide,
  trailing,
  canEdit,
  groups,
  savingKey,
  onSaveColumn,
  onSaveCustom,
  onSaveAssets,
  assetBase,
  helpdeskId,
  extraHelp,
}: FieldViewProps) {
  const cfg = (def.config ?? {}) as Cfg;
  // Built once: editor (null ⇒ read-only for this agent) + why it's read-only.
  const editor = canEdit && cfg.maps_to !== "description_html" && def.field_type !== "attachment" ? buildEditor() : null;
  const readOnlyReason = canEdit && !editor ? readOnlyWhy(def) : "";

  // Field label carrying the same tooltip (ⓘ) + hint text the create form shows, so
  // the detail view mirrors the form's guidance. Tooltip: `fieldHelp` = explicit config
  // first, else the built-in FIELD_HELP, else the definition's description. Hint: config only.
  const helpTip = (
    <InfoTip label={`What does ${def.name} mean?`} side="left">
      {[fieldHelp(def), extraHelp?.[cfg.maps_to ?? ""], readOnlyReason ? `Read-only: ${readOnlyReason}.` : ""]
        .filter(Boolean)
        .join("\n")}
    </InfoTip>
  );
  const label = (
    <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      {def.name}
      {helpTip}
    </div>
  );
  const hintNode = cfg.hint ? <p className="mt-1 text-xs text-muted-foreground">{cfg.hint}</p> : null;
  // Side-rail rows put the label in an 8rem column beside the value; tall controls keep
  // the label on top. `minmax(0,1fr)` + `min-w-0` keep long selects inside the card.
  // The label column is `--side-label-w` (8rem; the docked Modern panel sets 6rem).
  // (Was 7rem until the 2026-10-18 hover-help pass gave every standard field an ⓘ —
  // "Assigned Group ⓘ" then wrapped to two lines.)
  const side = !!labelSide && !TALL_FIELD_TYPES.has(def.field_type) && cfg.maps_to !== "description_html";
  // Rail rows get a hover copy icon (values sit inside selects / pickers, so they
  // can't be text-selected). Side rows reserve a fixed third column for it so
  // nothing shifts on hover; label-above rows put it at the end of the label line.
  const copyPayload = labelSide ? fieldCopyPayload(def, ticket, groups) : null;
  const copyButton = copyPayload ? <CopyValueButton payload={copyPayload} field={def.name} /> : null;
  const wrap = (body: React.ReactNode) =>
    side ? (
      <div className="group/row">
        <div className="grid grid-cols-[var(--side-label-w,8rem)_minmax(0,1fr)_1.5rem] items-center gap-x-3 compact:gap-x-2">
          <div className="flex min-w-0 items-center gap-1.5 break-words text-xs font-medium text-muted-foreground">
            {def.name}
            {helpTip}
          </div>
          <div className="min-w-0">{body}</div>
          <div className="flex justify-center">{copyButton}</div>
        </div>
        {cfg.hint ? <p className="ml-[calc(var(--side-label-w,8rem)+0.75rem)] mt-0.5 text-xs text-muted-foreground">{cfg.hint}</p> : null}
        {trailing}
      </div>
    ) : (
      <div className={labelSide ? "group/row" : undefined}>
        {labelSide ? (
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {def.name}
            {helpTip}
            {copyButton ? <span className="-my-1 ml-auto">{copyButton}</span> : null}
          </div>
        ) : (
          label
        )}
        {body}
        {hintNode}
        {trailing}
      </div>
    );

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
          <ExpandableHtml html={ticket.description_html} className="prose prose-sm max-w-none dark:prose-invert" />
        ) : (
          <p className="text-sm text-muted-foreground">No description provided.</p>
        )}
        {hintNode}
      </div>
    );
  }

  // Linked assets (the system "Asset" field): chips linking to each asset page, edited
  // in place through the link / unlink / primary endpoints (needs ticket Update).
  if (cfg.maps_to === "assets" || def.field_type === "asset_picker") {
    const saving = savingKey === "assets";
    return wrap(
      <AssetLinkField
        label={def.name}
        value={(ticket.assets ?? []).map(chipFromTicketLink)}
        readOnly={!canEdit}
        busy={saving}
        disabledReason={saving ? "Saving…" : undefined}
        helpdeskId={helpdeskId}
        requestorId={ticket.requestor ? String(ticket.requestor.id) : null}
        requestorName={ticket.requestor ? ticket.requestor.full_name || ticket.requestor.username : null}
        hrefFor={(id) => `${assetBase}/${id}`}
        onChange={onSaveAssets}
      />,
    );
  }

  // Attachments — read-only chip row (upload/delete lives in the header paperclip
  // popover). Nothing at all when empty: the header button already shows the count.
  if (def.field_type === "attachment") {
    if (attachments.length === 0) return null;
    return wrap(
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {attachments.map((a) => (
          <li key={a.id} className="min-w-0">
            <a
              href={a.file}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{a.original_name || "file"}</span>
            </a>
          </li>
        ))}
      </ul>,
    );
  }

  if (editor) {
    if (block) return wrap(editor);
    return (
      <div className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
        <dt className="shrink-0 text-muted-foreground">{def.name}</dt>
        <dd className="min-w-0 text-right font-medium">{editor}</dd>
      </div>
    );
  }

  // Read-only fallback. An agent who can edit other fields hovers the value to see why
  // this one isn't editable (also in the label's ⓘ for keyboard users).
  const value = fieldValue(def, ticket, true);
  if (block)
    return wrap(
      <Hint label={readOnlyReason} align="start">
        <div className="min-w-0 text-sm">{value}</div>
      </Hint>,
    );
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
            fieldLabel={def.name}
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

/** "TAG · Name, TAG · Name" for the linked assets (primary first). */
function assetsText(ticket: TicketDetail): string {
  return (ticket.assets ?? []).map((a) => `${a.asset_tag} · ${a.name}`).join(", ");
}

/** The Asset field's display name, for the "wasn't saved" toast. */
function assetFieldName(defs: Record<string, FieldDefinition>): string {
  return Object.values(defs).find((d) => d.field_type === "asset_picker")?.name ?? "Asset";
}

/** `expandable`: long rich text gets the 6-line Show more (on screen only — the print
 *  sheet calls this without it and prints everything). */
function fieldValue(def: FieldDefinition, ticket: TicketDetail, expandable = false): React.ReactNode {
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
    case "assets":
      return ticket.assets?.length ? assetsText(ticket) : dash;
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
      return expandable ? (
        <ExpandableHtml html={String(raw)} className="prose prose-sm max-w-none dark:prose-invert" />
      ) : (
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

/** What the rail's copy icon copies for a field — the same text `fieldValue` shows
 *  (option labels, "a › b" cascades, Yes/No), as plain text; people copy via a
 *  name / email menu. `null` ⇒ nothing to copy (empty, description, attachments,
 *  rich text, user-picker custom fields stored as ids). */
function fieldCopyPayload(def: FieldDefinition, ticket: TicketDetail, groups: Group[]): CopyPayload | null {
  const cfg = (def.config ?? {}) as Cfg;
  const text = (s: string | null | undefined): CopyPayload | null =>
    s && s.trim() ? { kind: "text", text: s } : null;
  const person = (u: UserRef | null): CopyPayload | null =>
    u ? { kind: "person", name: u.full_name || u.username, email: u.email } : null;

  switch (cfg.maps_to) {
    case "description_html":
      return null;
    case "summary":
      return text(ticket.summary);
    case "priority":
      return text(PRIORITY_LABELS[ticket.priority as Priority] ?? ticket.priority);
    case "requestor":
      return person(ticket.requestor);
    case "assignee":
      return person(ticket.assignee);
    case "assigned_group":
      return text(ticket.assigned_group_name);
    case "source":
      return text(ticket.source ? capitalize(ticket.source) : "");
    case "assets":
      return text(assetsText(ticket));
    default:
      break;
  }
  if (["attachment", "richtext", "user_picker"].includes(def.field_type)) return null;

  const raw = cfg.maps_to
    ? (ticket as unknown as Record<string, unknown>)[cfg.maps_to]
    : ticket.custom_fields?.[def.key];
  if (raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0)) return null;
  // A group-picker custom field stores the group id — copy the name the select shows.
  if (def.field_type === "group_picker") {
    const id = Array.isArray(raw) ? raw[0] : raw;
    return text(groups.find((g) => g.id === String(id))?.name);
  }
  const labelFor = (val: unknown) => def.options?.find((o) => o.value === String(val))?.label ?? String(val);
  switch (def.field_type) {
    case "cascade":
      return text(Array.isArray(raw) ? raw.map(labelFor).join(" › ") : labelFor(raw));
    case "multiselect":
      return text(Array.isArray(raw) ? raw.map(labelFor).join(", ") : labelFor(raw));
    case "dropdown":
    case "radio":
      return text(labelFor(raw));
    case "checkbox":
      return text(raw ? "Yes" : "No");
    default:
      return text(String(raw));
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2 last:border-0 compact:py-1.5">
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

/** Collapsible "Requestor profile" — the requestor's custom directory attributes
 *  (department, location, …). Collapsed by default since 2026-10-14 (it was open and
 *  its first row repeated the email the requestor chip already shows — dropped).
 *  Renders nothing when the requestor has no attributes. */
function RequestorProfile({ user, attributes }: { user: UserRef | null; attributes: RequestorAttribute[] }) {
  const [open, setOpen] = useState(false);
  if (!user || attributes.length === 0) return null;
  const rows: { label: string; value: React.ReactNode; full?: string }[] = attributes.map((a) => ({
    label: a.label,
    value: formatRequestorAttr(a.value),
    full: Array.isArray(a.value) ? a.value.join(", ") : a.value == null ? undefined : String(a.value),
  }));
  return (
    <div className="mt-1 rounded-md bg-muted/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <span>Requestor profile · {rows.length}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="px-2 pb-1.5">
          {rows.map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-1 py-1 text-sm">
              <span className="shrink-0 text-muted-foreground">{p.label}</span>
              <span className="min-w-0 truncate text-right font-medium" title={p.full}>{p.value}</span>
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

/** One-line person for the metadata rows: avatar + name, then the muted email
 *  (truncated) on the same line; the full "name · email" is in the tooltip. */
function personOneLine(u: UserRef | null): React.ReactNode {
  if (!u) return <span className="text-muted-foreground">—</span>;
  const name = u.full_name || u.username;
  return (
    <span className="flex min-w-0 items-center justify-end gap-1.5" title={u.email ? `${name} · ${u.email}` : name}>
      <UserAvatar user={u} size="xs" />
      <span className="truncate">{name}</span>
      {u.email ? <span className="hidden min-w-0 truncate text-xs font-normal text-muted-foreground 2xl:inline">{u.email}</span> : null}
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
  fieldLabel,
  value,
  placeholder,
  busy,
  block,
  onChange,
}: {
  /** The field's name ("Requestor") for accessible names and hints. */
  fieldLabel: string;
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
    // Accessible name starts with the visible person (WCAG 2.5.3), then the action.
    const shown = value ? value.full_name || value.username : placeholder;
    const changeLabel = `Change ${fieldLabel.toLowerCase()}`;
    if (block) {
      return (
        <Hint label={busy ? "" : changeLabel} side="left">
        <button
          type="button"
          disabled={busy}
          aria-label={`${shown} — ${changeLabel}`}
          title={value?.email ? `${shown} · ${value.email}` : undefined}
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
        </Hint>
      );
    }
    return (
      <button
        type="button"
        disabled={busy}
        aria-label={`${shown} — ${changeLabel}`}
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
    // data-inline-editing: tells the live refresh the agent is mid-edit (pill, not apply).
    <div data-inline-editing="" className={block ? "relative w-full" : "relative w-44"}>
      <Input
        autoFocus
        spellCheck={false}
        value={q}
        placeholder="Search people…"
        aria-label={`Search people for ${fieldLabel.toLowerCase()}`}
        className="h-8"
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setEditing(false), 150)}
      />
      <ul className={`absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 text-left shadow-md ${block ? "left-0" : "right-0"}`}>
        {value ? (
          <li>
            <button
              type="button"
              title={`Remove the current ${fieldLabel.toLowerCase()}`}
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
              title={u.email ? `${u.full_name || u.username} · ${u.email}` : undefined}
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
    const bodyProps: React.HTMLAttributes<HTMLDivElement> = {
      role: "button",
      tabIndex: 0,
      "aria-label": "Edit description",
      onClick: (e) => {
        // Keep links in the description clickable in read mode; a click anywhere
        // else opens the editor (JIRA-style inline edit — no separate Edit button).
        if ((e.target as HTMLElement).closest("a")) return;
        enter();
      },
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          enter();
        }
      },
      className:
        "group relative -mx-2 cursor-text rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
    };
    const editPill = (
      <span className="pointer-events-none absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-md border bg-background/90 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground opacity-0 shadow-soft transition-opacity group-hover:opacity-100">
        <Pencil className="h-3 w-3" aria-hidden="true" /> Edit
      </span>
    );
    // Long email bodies show 6 lines + Show more. The toggle sits OUTSIDE the
    // click-to-edit body, so it never opens the editor (and isn't a nested control).
    if (html)
      return (
        <ExpandableHtml
          html={html}
          className="prose prose-sm max-w-none dark:prose-invert"
          bodyProps={bodyProps}
          bodyExtra={editPill}
        />
      );
    return (
      <div {...bodyProps}>
        <p className="text-sm text-muted-foreground">Add a description…</p>
        {editPill}
      </div>
    );
  }

  return (
    // data-inline-editing: the live refresh stages a "Refresh" pill instead of applying.
    <div data-inline-editing="" className="space-y-2">
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
  ariaLabel,
  onCommit,
}: {
  initial: string;
  type?: string;
  disabled?: boolean;
  block?: boolean;
  ariaLabel?: string;
  onCommit: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  return (
    <Input
      type={type}
      value={v}
      disabled={disabled}
      spellCheck={type === "text"}
      aria-label={ariaLabel}
      title={TICKET_HELP.commitInput}
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
function CommitTextarea({
  initial,
  disabled,
  ariaLabel,
  onCommit,
}: {
  initial: string;
  disabled?: boolean;
  ariaLabel?: string;
  onCommit: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  return (
    <textarea
      value={v}
      disabled={disabled}
      spellCheck
      rows={3}
      aria-label={ariaLabel}
      title="Saves when you leave the field"
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
  return (
    <CascadeSelect
      levels={cfg.levels}
      options={def.options ?? []}
      value={Array.isArray(value) ? value.map(String) : []}
      disabled={disabled}
      onChange={onSave}
    />
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
        <select className={selectCls} aria-label={def.name} disabled={saving} value={String(value ?? "")} onChange={(e) => onSave(e.target.value)}>
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
      return <input type="checkbox" className="h-4 w-4" aria-label={def.name} disabled={saving} checked={Boolean(value)} onChange={(e) => onSave(e.target.checked)} />;
    case "date":
      return <Input type="date" aria-label={def.name} className={block ? inputCls : "h-8 w-44"} disabled={saving} defaultValue={String(value ?? "")} onChange={(e) => onSave(e.target.value)} />;
    case "datetime":
      return <Input type="datetime-local" aria-label={def.name} className={block ? inputCls : "h-8 w-44"} disabled={saving} defaultValue={String(value ?? "")} onChange={(e) => onSave(e.target.value)} />;
    case "number":
      return <CommitInput type="number" ariaLabel={def.name} initial={String(value ?? "")} disabled={saving} block={block} onCommit={(v) => onSave(v)} />;
    case "multiline":
      return <CommitTextarea ariaLabel={def.name} initial={String(value ?? "")} disabled={saving} onCommit={(v) => onSave(v)} />;
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
      return <CommitInput ariaLabel={def.name} initial={String(value ?? "")} disabled={saving} block={block} onCommit={(v) => onSave(v)} />;
  }
}
