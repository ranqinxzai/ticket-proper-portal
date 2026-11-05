/**
 * Hover help for the agent ticket detail view and the ticket create form (the create
 * form's `FieldControl` is also reused by the Service Portal request form, so the
 * create-form strings must read well for requestors too).
 *
 * Every behavioural claim is grounded in the backend — see the file:line notes. Keep
 * these in sync when the behaviour changes (docs/QA_CHECKLIST.md → "Hover help / tooltips").
 */
import type { FieldDefinition, FieldVisibilityRule, Transition } from "@/lib/itsm/types";

export const TICKET_HELP = {
  // itsm_workflows/services/engine.py available_transitions(): a pending approval → [].
  approvalLock:
    "Status changes are locked until the pending approval is approved or rejected.",
  backToQueue: "Back to the queue",
  backToAll: "Back to all tickets",
  // Print sheet in ticket-detail.tsx filters out private comments.
  print: "Print this ticket: its fields, requestor profile and public comments. Internal notes are left out.",
  // itsm_tickets/services/ticket_service.py move_ticket(): new number + TicketNumberAlias,
  // unmapped custom values dropped, pending approval cancelled (approval_engine.cancel_pending).
  move:
    "Move to another project in this helpdesk. It gets a new number (the old one still redirects); field values you don't map are dropped and a pending approval is cancelled.",
  // itsm_rbac ItsmModelViewSet.perform_destroy → soft_delete.
  delete: "Remove this ticket from every queue, report and search",
  // itsm_notifications/seed.py: CommentAdded → requestor, watchers, assignee (in-app + email);
  // CommentAddedPrivate → assignee, watchers (in-app only).
  publicComment:
    "Visible to the requestor. By default it's emailed to the requestor, watchers and assignee.",
  internalNote:
    "Only agents can see it — never sent to the requestor. By default the assignee and watchers get an in-app alert (no email).",
  internalBadge: "Internal note — only agents can see this. It's hidden from the requestor and the portal.",
  activityTab: "Audit trail of every change: field edits, status moves, assignments, links and more",
  cannedInsert: "Insert a saved reply at the cursor",
  attachFiles: "Attach files to this reply. Pasted or dropped images go inline in the text instead.",
  // itsm_notifications/seed.py: watchers get StatusChanged / CommentAdded / Resolved / Closed.
  watch: "Get notified about comments and status changes on this ticket",
  unwatch: "Stop getting notifications about this ticket",
  addFiles: "Upload files to this ticket",
  // copy-value-button.tsx — the hover copy icon on every ticket-rail field.
  copyValue: "Copy value",
  copyPerson: "Copy name or email",
  commitInput: "Saves when you leave the field or press Enter. Esc cancels.",
  // ticket-detail.tsx CAPTURE_ONLY_MAPS_TO — captured on a transition screen (e.g. Resolve).
  captureOnly: "Captured on the Resolve step (the transition's screen), not edited here",
  // itsm_core/seed.py source: system_set.
  systemSet: "Set automatically when the ticket is created",
  userPickerReadOnly: "This person field can't be edited inline yet",
  columnReadOnly: "Set by the system, not edited here",
  editDescription: "Click to edit the description",
  changeRequestor: "Change requestor",
  clearPerson: "Remove the current person",
  // field-section.tsx collapsed capture-only section.
  resolutionCollapsed: "Filled in when the ticket is resolved — click to expand",
  // Layout → section "Collapsed" (FieldLayout.sections[].collapsed)
  sectionCollapsed: "Collapsed by default in this project's layout — click to expand",
  // ticket-detail.tsx live refresh (pulse every ~15s): applied silently when idle,
  // otherwise this pill. Drafts in the composer / summary / description survive.
  liveRefresh:
    "Someone else changed this ticket while you were editing. Click to load the latest version — a reply you're writing is kept.",
  // itsm_tickets views.comments: mention ids come from the body; only active agents
  // who are members of the ticket's helpdesk (403 otherwise). Seeded rule: in-app + email.
  mentionPlaceholder: "(type @ to mention an agent)",
  // itsm_tickets/services/ticket_service.py update_ticket(): impact/urgency change
  // re-derives priority unless priority is set in the same edit.
  priorityAuto:
    "Recalculated automatically from Impact × Urgency whenever either changes. You can still pick a different priority here.",
  groupWhitelist: "Only the teams allowed for this project are listed.",
  // itsm_approvals/services/engine.py decide().
  approve:
    "Records your approval. Once this level has enough approvals it moves to the next level, or completes if this is the last — then status changes unlock.",
  reject:
    "Rejects the whole approval — later levels are skipped and status changes unlock. You'll be asked for a reason, which is kept in the approval history. If the workflow has a Rejected status, the ticket moves there; an approval an agent sent from the ticket returns it to the status it was sent from instead.",
  approverOnly: "Only the approvers of the pending level can approve or reject. Everyone else sees who it's waiting for.",
  // engine.request_state blocked_reason
  approvalBlocked: "Nobody can complete this approval until the problem is fixed. A superuser can still decide it.",
  // itsm_approvals/services/send.py (Send for approval, 2026-10-24)
  sendForApproval:
    "Ask for sign-off now: pick one of this project's approval workflows and, where the workflow lets you, the approvers. Status changes are locked until it's decided.",
  sendNoPolicies:
    "This project has no active approval workflows. An administrator adds them in Settings → Projects → Approval.",
  sendPolicy:
    "The project's active approval workflows. A workflow that can't start for this ticket (e.g. the requestor has no manager) is shown with the reason and can't be picked.",
  sendNote:
    "Shown to the approvers in their approvals inbox, in the Approval needed email and on this ticket's approval panel.",
  // engine._picks_problem: active, in the pool, at least min_approvals
  sendOnFly: (need: number) =>
    `Pick who approves this stage${need > 1 ? ` — at least ${need} people` : ""}. ${need > 1 ? "That many" : "One"} of the picked people approving completes it. They're asked by email and in-app.`,
  // send.can_withdraw: the sender, `itsm.approvals.send` delete, or a superuser
  withdraw:
    "Cancels this approval. The ticket goes back to the status it was sent from and status changes unlock. You can send it again.",
  sentNote: "Message from the person who sent it for approval.",
  waitingReturn: (waiting: string, back: string) =>
    `Waiting in “${waiting}”; it goes back to “${back}” when the approval is decided or withdrawn.`,
  groupLead: "Group lead",
  notInGroup: "This person isn't a member of the selected group — pick someone from the group",
  slaPanel:
    "Service-level clocks for this ticket. Times count business hours of the project's calendar and pause while the ticket is in a status excluded from SLA.",
  slaDot:
    "Dot colour = share of the target used (business time): green under 75%, amber from 75%, red at 100% or breached. A finished clock shows its outcome: green = met, red = breached.",
} as const;

/** Canned-response scopes as the picker groups them. Grounded in
 *  itsm_tickets CannedNoteViewSet.get_queryset: shared notes are visible to every member
 *  of the note's helpdesk (project-scoped ones too), org-wide (no helpdesk) to every
 *  agent, personal ones only to their owner. */
export const CANNED_SCOPE_HELP = {
  personal: "Personal — only you can see and use this response.",
  helpdesk: (name: string) => `Shared with everyone who works in the ${name} helpdesk.`,
  project: (name: string) => `Tagged to the ${name} project — everyone in its helpdesk can use it.`,
  organisation: "Organisation-wide — every agent can use it.",
} as const;

/** What each link type means, for the "add link" picker. */
export const LINK_TYPE_HELP =
  "• relates to — loosely connected\n• blocks / is blocked by — one can't finish until the other is done\n• duplicates / is duplicated by — the same issue raised twice\n• causes / is caused by — one ticket is the cause of the other\nThe other ticket shows the inverse relationship automatically.";

const humanize = (key: string) => {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
};

const AUTO_ASSIGN_LABEL: Record<string, string> = {
  round_robin: "round-robin",
  least_loaded: "least loaded",
  group_lead: "the group lead",
  fixed_user: "a fixed person",
};

/** Hover text for a workflow transition button. Uses the target status's real name
 *  (`to_status_name`, U4); falls back to humanising the key for older payloads.
 *  itsm_workflows engine: auto_assign never overwrites an existing assignee (B17c). */
export function transitionHint(
  tr: Pick<Transition, "to_status_key" | "to_status_name" | "note_prompt" | "note_required" | "screen_fields" | "post_functions">,
): string {
  const lines = [`Move to ${tr.to_status_name || humanize(tr.to_status_key)}`];
  const needsFields = (tr.screen_fields?.length ?? 0) > 0;
  if (tr.note_prompt && needsFields) lines.push(tr.note_required ? "Asks for a note (required) and some fields" : "Asks for a note and some fields");
  else if (tr.note_prompt) lines.push(tr.note_required ? "Asks for a note (required)" : "Asks for a note");
  else if (needsFields) lines.push("Asks you to fill in some fields");
  const auto = tr.post_functions?.find((pf) => pf.type === "auto_assign");
  if (auto) {
    const strategy = String(auto.config?.strategy ?? "round_robin");
    if (strategy !== "keep_current") {
      lines.push(`Assigns someone (${AUTO_ASSIGN_LABEL[strategy] ?? strategy}) only if nobody is assigned yet`);
    }
  }
  return lines.join("\n");
}

/** Hover text for a transition the server reports as blocked by a field condition
 *  (`blocked_reason`, engine.blocked_reasons): the admin's message + how to unblock. */
export function transitionBlockedHint(tr: Pick<Transition, "to_status_key" | "to_status_name" | "blocked_reason">): string {
  return `Can't move to ${tr.to_status_name || humanize(tr.to_status_key)} yet: ${tr.blocked_reason}\nFill in that field on the ticket, then try again.`;
}

/** Why a field is locked by a layout "read-only when …" rule, e.g.
 *  "Locked because Impact is High". `defs` is every field definition on the form. */
export function readonlyRuleReason(
  rule: FieldVisibilityRule | null,
  defs: Pick<FieldDefinition, "key" | "name" | "options">[],
): string {
  if (!rule || rule.action !== "readonly") return "";
  const def = defs.find((d) => d.key === rule.field);
  const fieldName = def?.name ?? humanize(rule.field);
  const optLabel = def?.options?.find((o) => o.value === rule.value)?.label ?? rule.value;
  return `Locked because ${fieldName} ${rule.operator === "neq" ? "is not" : "is"} ${optLabel || "empty"}`;
}


/** Modern workbench (step B4, 2026-11-05): the docked ticket card's header controls. */
export const WORKBENCH_HELP = {
  prev: "Previous ticket in the list (K)",
  next: "Next ticket in the list (J)",
  atFirst: "This is the first ticket in the list",
  atLast: "This is the last ticket in the view",
  notInList: "This ticket isn't in the list's loaded rows (another view, or not loaded yet)",
  showPanel: "Show the details panel (])",
  hidePanel: "Hide the details panel (])",
  maximise: "Maximise: hide the queue ([)",
  restore: "Show the queue again ([)",
  close: "Close the ticket and go back to the queue (Esc)",
} as const;
