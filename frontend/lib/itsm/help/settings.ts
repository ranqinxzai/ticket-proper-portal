/**
 * Project-settings hover help (workspace Settings → Projects → <project> tabs).
 *
 * Every behavioural claim here was checked against the backend (file refs inline).
 * Copy must describe what the system ACTUALLY does — see docs/QA_CHECKLIST.md
 * "Hover help / tooltips". Keep each entry to 1–2 short sentences.
 */

/** Generic disabled reason for a control the viewer can't change. */
export const NO_EDIT_PERMISSION = "You don't have permission to edit this";

// ── Workflow tab (itsm_workflows) ───────────────────────────────────────────

export const WORKFLOW_HELP = {
  // Workflow has no project FK; projects point at it via Project.default_workflow.
  shared:
    "Workflows are shared. Every project whose Default workflow is this one uses the same statuses and transitions, so changes here apply to all of them.",
  // itsm_workflows/validators.py validate_workflow_graph
  validate:
    "Checks the workflow without saving: exactly one initial status, a create transition, at least one Done status. Also warns about unreachable statuses and duplicate transitions.",
  // sla_engine.on_status_change + survey_service._trigger_matches
  category:
    "To Do / In Progress / Done group statuses in the queue and reports. Entering a Done status stops the resolution and first-response SLA clocks and can send the satisfaction survey.",
  // Status.pauses_sla → sla_engine.on_status_change
  excludeSla:
    "While a ticket is in this status all its running SLA clocks pause. They resume when it leaves.",
  // engine.start_status_for: the create transition's target, else is_initial
  initial: "Initial status: new tickets start here (the create transition leads here).",
  slaPaused: "Exclude from SLA is on: all SLA clocks pause while a ticket is in this status.",
  // engine.models_q: is_global → offered from every status
  global: "Global transition: available from every status (shown as “Any status”).",
  // engine.apply_create_transition / begin_create_approvals (B14, 2026-10-18)
  create:
    "(create) runs once, when a ticket is created: new tickets start in its To status. Only Start approval and auto-assign (if nobody is assigned) apply then — conditions, notes, capture fields and field conditions don't. It can't be run on an existing ticket.",
  // validators: a non-global from_status=null transition that isn't the one used
  neverRuns:
    "Never runs: a workflow uses only one create transition. Delete this one, or recreate it with a From status.",
  createSettings:
    "This is the create transition. At creation only “Start approval” (and any auto-assign) runs; the note, capture fields, field conditions, approval gate and portal settings don't apply, so they aren't shown.",
  // engine._apply_post_function auto_assign → pick_assignee_if_unassigned (B17c)
  autoAssign: (strategy: string) =>
    `Auto-assign (${strategy}): picks someone from the ticket's assigned group when this transition runs — only if nobody is assigned. An existing assignee is always kept.`,
  // workflows/{id}/usage (U6)
  sharedBanner:
    "Every project listed uses these same statuses and transitions. To change only this project, make a copy for it.",
  // workflows/{id}/clone (U6) — rule 10: tickets keep the workflow they were created on
  copyForProject:
    "Copies every status, transition and setting into a new workflow used only by this project. New tickets use the copy; tickets already open keep the shared workflow. This project's automation rules are switched to the copy.",
  // views.StatusViewSet.perform_destroy (U1/C5)
  deleteStatus:
    "Deletes the status and every transition into or out of it. Refused while tickets are in it or when new tickets start in it.",
  fields: "Capture fields: the agent fills these in when running this transition. Mandatory ones must be filled.",
  // engine._field_condition_passes (B17a/b)
  rules:
    "Field conditions: running the transition is blocked with your message unless every rule passes; agents see the button disabled with that message. A rule on a field the ticket's project doesn't have is skipped, and a cascading field counts as filled only when a complete path (down to the last level) is chosen.",
  portal: "Requestors can run this transition from the Service Portal. Its conditions still apply.",
  // engine.transition 6d → hooks.begin_approval (in-transaction, non-swallowing); has_pending_approval freezes
  startsApproval:
    "Starts an approval when this transition runs. If a stage has nobody who can approve it (e.g. the requestor has no manager), the transition is refused with a message and the ticket keeps its status. While it's pending, every transition is frozen. An inactive approval workflow starts nothing.",
  // engine._check_condition approval_granted: latest non-cancelled request approved, or none at all
  needsApproval:
    "Requires approval: runs only when the ticket's latest approval was approved, or when it never needed one. After a rejection it stays blocked until a new approval is approved.",
  note: (heading: string, required: boolean) =>
    `Asks for a note${heading ? ` (“${heading}”)` : ""} when this transition runs${required ? "; * = mandatory" : "; optional"}. The note is posted as a comment.`,
  // itsm_tickets/views.py transition → add_comment(visibility)
  noteType:
    "Public comment: the requestor sees it on the portal, and the first public one stops the first-response SLA. Internal note: agents only.",
  portalAllowed: "Off by default: transitions are agent-only unless you allow them here.",
  // Status.allows_send_for_approval → approvals/services/send.blocked_reason
  sendForApproval:
    "Agents see a Send for approval button on tickets in this status. They pick one of the project's approval workflows and, for On-fly stages, the approvers. While it's pending every transition is frozen.",
  // Status.approval_waiting_status → send.waiting_status_for / engine.return_from_waiting
  waitingStatus:
    "While the approval is pending the ticket moves here, and it comes back to this status when the approval is approved, rejected or withdrawn. No transitions are needed. To pause the SLA while it waits, turn on Pause SLA while waiting on the approval (Approval tab) or Exclude from SLA on the waiting status.",
  sendBadge: (waiting: string | null | undefined) =>
    waiting
      ? `Agents can send tickets in this status for approval. They wait in “${waiting}” and come back here when it's decided.`
      : "Agents can send tickets in this status for approval. The ticket stays in this status while it waits.",
  // serializers.TransitionSerializer.validate_post_functions
  onFlyNotHere: "Has an On-fly stage: agents start it with Send for approval, so a transition can't.",
} as const;

// ── SLA tab (itsm_sla) ──────────────────────────────────────────────────────

export const SLA_EDITOR_HELP = {
  // sla_engine.start_trackers: project.calendar or policy.calendar or default; no calendar → 24/7 UTC;
  // business_time.spec_from_calendar: a calendar with no working hours → 24/7 in its timezone
  calendar:
    "Used only when the project has no Business calendar on its Overview tab. “Use project / default” falls back to the default business calendar; clocks run 24/7 (UTC) only if no calendar exists at all. A calendar with no working hours also runs 24/7.",
  // sla_engine._target_minutes: no target ⇒ None ⇒ no tracker; on_priority_change withdraws
  target:
    "Business minutes, counted in the calendar's working hours. Leave a priority blank for no SLA at that priority: no clock starts, and a ticket that changes to it loses that clock.",
  // sla_engine.on_priority_change (hooks.sla_priority_changed from every priority write)
  appliesTo:
    "Clocks start when a ticket is created, using its priority. If the priority changes later, running and paused clocks switch to the new priority's target and keep the time already used. Other saved changes only affect tickets created afterwards.",
  // business_time.spec_from_calendar → 24/7 fallback + warning
  calendarNoHours:
    "has no working hours, so SLA clocks on it run 24/7 (nights and weekends count). Add hours in Configuration → Business Calendars.",
} as const;

// ── Approval tab (itsm_approvals) ───────────────────────────────────────────

export const APPROVAL_HELP = {
  // approvals/services/engine.decide: rule "any", min_approvals 1 (what this UI creates)
  sequential:
    "Sequential: stages run in level order. One approval moves to the next stage; any rejection rejects the whole request.",
  // engine.start_approval PARALLEL: every snapshotted stage pending at once
  parallel:
    "Parallel: every stage is asked at once. The request is approved when each stage has its approval; any rejection rejects the whole request.",
  // engine.start_for_transition: inactive → None (nothing starts)
  inactive:
    "Inactive: a transition that points at it starts no approval — the ticket moves on without sign-off. Approvals already in progress continue.",
  activeToggle: "Switch off to stop starting this approval. Approvals already in progress continue.",
  // ApprovalWorkflow.pause_sla → ApprovalRequest.pause_sla → sla_engine._approval_pauses / sync_pauses
  pauseSla:
    "While a request under this approval is waiting for a decision, the ticket's First response, Resolution and Assignment SLA clocks are paused. They resume when it's approved, rejected, withdrawn or cancelled; a rejection that moves the ticket to Rejected stops them instead. A pause made by an Exclude-from-SLA status or a Pause SLA step stays. Applies to approvals started after you change it.",
  mode: "How the stages run: one after another (Sequential) or all at once (Parallel).",
  level: (n: number) => `Level ${n}: stages are approved in level order.`,
  // serializers.ApprovalStageSerializer.approver_problem (engine.stage_problem, config-only)
  stageProblem: (p: string) =>
    `${p} The transition that starts this approval will be refused until you fix it — delete this stage and add it again with an active approver.`,
  // requestor_manager keeps approver_user as the fallback
  fallback:
    "Optional. Approves when the requestor has no (active) manager. Without one, the transition that starts this approval is refused for those requestors.",
  // engine._on_fly_pool_problem (config-only)
  onFlyProblem: (p: string) =>
    `${p} Agents can't send this approval workflow until you fix it — delete this stage and add it again with an active group or people.`,
  // engine.pool_user_ids
  onFlyPool:
    "Who the agent can pick from: any active person in the organisation (agents and requestors), the active members of a group, or the people you list.",
  // serializers._validate_on_fly: rule "any" → picks must reach min_approvals (1 from this editor)
  onFlyRule: "One of the picked people approving is enough to complete the stage.",
  // serializers._validate_on_fly → engine.policy_start_sites
  onFlyOnlySend:
    "Has an On-fly stage, so only Send for approval on a ticket can start it. You can't use it in a transition's Start approval or on a catalog item.",
  // Status.allows_send_for_approval (Workflow tab → status settings)
  sendSetup:
    "Agents start these from a ticket with Send for approval, in statuses where the Workflow tab allows it. A transition can also start one (Workflow tab → transition settings → Start approval).",
} as const;

/** Per approver type, keyed by ApprovalStage.approver_type (engine.resolve_approver_ids). */
export const APPROVER_TYPE_HELP: Record<string, string> = {
  specific_user: "Only the chosen user can approve this stage. If their account is deactivated, the approval can't start.",
  role: "Anyone active with this role can approve. One approval is enough. A role nobody active holds can't start the approval.",
  group: "Any active member of this group can approve. One approval is enough. An empty group can't start the approval.",
  requestor_manager:
    "The manager on the requestor's user profile approves (or the fallback approver, if you set one). If neither exists, the transition that starts the approval is refused with a message.",
  // engine.ON_THE_FLY: picks stored per request (ApprovalRequestApprover); _picks_problem
  on_the_fly:
    "The agent picks the approver(s) when they use Send for approval on the ticket, from the list you set here. Only Send for approval can start a workflow with this stage — a transition or catalog item can't.",
};

// ── Routing tab (itsm_groups) ───────────────────────────────────────────────

export const ROUTING_HELP = {
  // itsm_groups/services.resolve_group_and_assignee (ordered by priority, first match)
  order: "Rules are checked top to bottom when a ticket is created; the first match wins.",
  matchMode: "Match all: every condition must hold. Match any: one is enough.",
  // ticket_service.create_ticket: routing only when no group AND no assignee chosen
  applies:
    "Only used when the ticket is created with no group and no assignee. An explicit choice is always kept.",
  off: "Turned off: skipped when routing new tickets.",
  shared: "Shared group: not tied to one helpdesk, so it's available in every helpdesk.",
  // resolve_group_and_assignee returns target_assignee unchecked
  technician:
    "Optional: also assign this person. It isn't checked against the group's members, so pick someone in the group.",
  // allowed_group_ids_for: empty ⇒ unrestricted, default_group always added
  restrict:
    "Off: every group can be assigned. On: only the ticked groups (plus the project's default group) can be picked or saved on this project's tickets.",
  defaultAlways: "The project's default group is always allowed",
} as const;

// ── Fields / Layout tabs (itsm_core fields) ─────────────────────────────────

export const FIELD_TYPE_HELP: Record<string, string> = {
  text: "Single line of text.",
  multiline: "Several lines of plain text.",
  richtext: "Formatted text (bold, lists, links). Always full width in the main column.",
  number: "A number.",
  date: "A calendar date.",
  datetime: "A date and time.",
  dropdown: "Pick one option from a list you define.",
  multiselect: "Pick several options from a list you define.",
  checkbox: "A yes/no tick box.",
  radio: "Pick one option, shown as radio buttons.",
  user_picker: "Pick a user.",
  group_picker: "Pick a group.",
  cascade: "Dependent levels, e.g. Category → Subcategory. Each choice narrows the next list.",
  attachment: "File upload.",
  asset_picker:
    "System field only (the “Asset” field): links assets of this helpdesk to the ticket, the first being the primary. It can't be added as a new field.",
};

export const FIELD_TYPE_LABEL: Record<string, string> = {
  text: "Text",
  multiline: "Multi-line text",
  richtext: "Rich text",
  number: "Number",
  date: "Date",
  datetime: "Date & time",
  dropdown: "Dropdown",
  multiselect: "Multi-select",
  checkbox: "Checkbox",
  radio: "Radio",
  user_picker: "User picker",
  group_picker: "Group picker",
  cascade: "Cascading",
  attachment: "Attachment",
  asset_picker: "Asset picker",
};

export const FIELDS_HELP = {
  key: "Internal key, set from the name when the field is created. Filters, routing rules and the API refer to the field by it.",
  system: "Standard field seeded by the system. It can't be deleted.",
  // optionsEditable: column-backed (config.maps_to) globals keep code-derived choices
  fixedChoices: "Choices are fixed by the system for this standard field.",
  // itsm_core/services/fields.validate_required — enforced server-side on agent create
  // and the portal (portal_only filters portal_visible); system creates aren't checked
  required:
    "Must be filled in when an agent creates a ticket in this project, and on the portal when the field is shown there (Layout → Portal). It's not required while the field is Hidden, while its conditional rule hides or locks it, or while a dropdown / cascading field has no options. Tickets from email and automation aren't checked.",
  // ticket-create-form evalRule == fields.visibility_state: unknown fields (e.g. status at creation) never match
  rule:
    "Show: the field appears only while the other field matches. Read-only: the field is locked while it matches. While the rule hides or locks the field it isn't required. A rule on Status never matches on the create form (a new ticket has no status yet).",
  multiselectValue:
    "For a multi-select field the rule matches when the picked values INCLUDE this one (\u201cis not\u201d = it isn\u2019t among them).",
  statusValue: "Pick one of this project's workflow statuses.",
  statusValueFallback:
    "This project's statuses couldn't be loaded. Type the status key: usually its name in lowercase with underscores (On Hold → on_hold).",
  // FieldLayoutItemSerializer.validate_visibility_rule rejects an empty value
  ruleValueRequired: "Choose a value for the condition, or turn the rule off.",
} as const;

export const LAYOUT_HELP = {
  drag: "Drag to move\nOr focus it, press Space, use the arrow keys, then Space to drop",
  remove: "Takes it off the form after you confirm. Its Required, Hidden, Portal and rule settings for this project are lost; the field itself stays in the Fields tab.",
  system: "System field: it can't be removed from the form. Use Hidden instead.",
  richtext: "Rich-text fields always span the full width of the main column and can't move to the sidebar.",
  // fields.validate_required + FieldLayoutItem.is_hidden/portal_visible
  required:
    "Required on the create form (checked by the server too). On the portal only if Portal is also on. Never while Hidden, or while its conditional rule hides or locks it.",
  hidden: "Hidden from the create form, ticket details and the portal. Hidden fields are never required.",
  portal: "Shown on the Service Portal request form. Off = agents only.",
  width: "Full spans the main column; Half sits beside another half-width field.",
  // FieldLayout.sections keeps declared (incl. empty) sections; forms skip empty ones
  section: "Adds a named section to this column. It's saved straight away, even while empty; the ticket form only shows sections that have fields.",
  removeSection: "Deletes this empty section from the layout.",
  rename: "Rename section (renames it for every field in it)",
  // FieldLayout.sections[].collapsed → ticket-detail.tsx startsCollapsed (agent page only)
  collapsed:
    "Starts collapsed on the agent ticket page; agents can still expand it, but each ticket opens this way again. The create form and the Service Portal always show it open.",
} as const;

// ── Columns / Filters tabs ──────────────────────────────────────────────────

export const COLUMNS_HELP = {
  summary: "Summary is always shown: it's the link to the ticket",
  custom: "Custom-field column. Blank for tickets without a value.",
  reset: "Restores the built-in column set. Not saved until you click Save layout.",
} as const;

export const FILTERS_HELP = {
  defaultView:
    "An agent's own default (the star in the queue's view menu) wins. Otherwise this view opens; “Product default” means Open tickets.",
  custom:
    "Shared with everyone who can open this project's queue. A ticket must match all of a filter's conditions.",
  // All-Tickets Filters page (Helpdesk.combined_default_view_key / shared project=null SavedFilters)
  helpdeskDefaultView:
    "An agent's own default (the star in All Tickets' view menu) wins. Otherwise this view opens; “Product default” means Open tickets. Project queues keep their own default.",
  helpdeskCustom:
    "Every agent in this helpdesk sees these, in All Tickets and in each project's queue. A ticket must match all of a filter's conditions.",
  saveDefaults: "Saves the Default views checkboxes above and the default view.",
} as const;

// ── Notifications tab (itsm_notifications) ──────────────────────────────────

/** Keyed by recipient selector (itsm_notifications/services/recipients.py resolve). */
export const RECIPIENT_HELP: Record<string, string> = {
  requestor: "The person who raised the ticket.",
  assignee: "The technician the ticket is assigned to.",
  assigned_group: "Every active member of the ticket's assigned group.",
  group_lead: "The lead of the ticket's assigned group.",
  watchers:
    "Everyone watching the ticket. Internal notes and SLA alerts only reach watchers who are agents on this ticket's helpdesk.",
  mentioned: "People @mentioned in the comment that triggered it.",
  // recipients.pending_approver_ids — the current stage's approvers who haven't acted yet
  approvers:
    "Whoever can still approve the ticket's pending approval step. Their link opens their Approvals inbox.",
  // context watcher_user_id from ticket_service.add_watcher (self-adds never emit)
  added_watcher: "The person who was just added as a watcher. Nobody is notified when they add themselves.",
};

/** Keyed by channel (itsm_notifications/services/bus.py). */
export const CHANNEL_HELP: Record<string, string> = {
  in_app: "Bell notification inside the app.",
  email: "Email to the recipient's address (skipped if they have none), using this event's template.",
  whatsapp: "Coming soon: nothing is sent on this channel yet.",
};

export const NOTIFICATIONS_HELP = {
  // seed.ensure_notification_scheme clones templates per project
  template: "Edit this project's own copy of the email. Other projects aren't affected.",
  templateNoPerm: "You don't have permission to edit email templates",
} as const;

// ── Survey tab (itsm_surveys) ───────────────────────────────────────────────

export const SURVEY_HELP = {
  // survey_service._trigger_matches + maybe_send_survey
  trigger:
    "When resolved: the first time the ticket enters a Done status other than Closed (e.g. Resolved, Fulfilled). When closed: when it enters Closed. Sent once per ticket, only if the requestor has an email address.",
  // models.SCALES satisfied_min + normalize()
  scale:
    "Counts as satisfied: 4–5 on CSAT and stars, thumbs up, 7–10 on NPS. Every scale is also converted to a 0–100 score for the CSAT report.",
  intro: "Shown above the rating question on the portal feedback page.",
  thankYou: "Shown on the feedback page after the requestor submits.",
  // serializers.validate + survey_service.comment_required (B6)
  commentRequiredOff: "Turn on “Ask for a comment” first — a comment can only be required when the box is shown.",
} as const;

// ── Automation tab (itsm_automation) ────────────────────────────────────────

export const AUTOMATION_HELP = {
  // dispatcher.dispatch — rules ordered by `order`, every match runs unless stop_processing
  order:
    "Rules run top to bottom. Every rule whose trigger and conditions match runs, unless an earlier rule that ran has “Stop after this rule” on.",
  // dispatcher._trigger_matches — any one trigger is enough
  triggers: "The rule runs when any one of the ticked events happens.",
  // hooks.automation_dispatch call sites: update_ticket / assign / set-fields
  updated:
    "Fires when an agent (or SLA escalation) changes one of these fields. Leave every field unticked to fire on any field change.",
  statusChanged: "Fires after any workflow transition. Optionally limit it to particular from/to statuses.",
  // conditions.matches — query_builder.build_q against the ticket after the change
  conditions:
    "Checked against the ticket after the change. Same fields and operators as queue filters. No conditions means the rule always runs.",
  // dispatcher: is_automation_bot(actor) → return
  noChain:
    "Changes made by automation never trigger other rules (or the same rule again), so rules can't loop.",
  // dispatcher._run_rule: transaction.atomic per rule
  allOrNothing:
    "Actions run in order. If one fails, the rule's earlier actions are undone and the failure shows in Recent runs; other rules still run.",
  // actions.run_transition: skipped (not failed) when not in the from-status
  transition:
    "Runs through the workflow like a click: approval gates, conditions and field conditions still apply. Skipped if the ticket isn't in the transition's from-status.",
  // engine auto_assign → pick_assignee_if_unassigned: never overwrites (B17c, 2026-10-18)
  keepAssignee:
    "Auto-assign never replaces an agent already on the ticket (this is always on now), so running Assign keeps the person who was picked.",
  // catalog.field_catalog set_fields (2026-10-31): every ticket-detail field except
  // Summary, Description and Requestor; actions.clean_column_value checks ITIL values
  setField:
    "Any field on this project's ticket form: Priority, Assignee, Group, the ITIL fields (Impact, Urgency, Users Affected, Resolution Code, Root Cause…) and custom fields, including multi-select, cascade and group fields. Summary, Description and Requestor can't be set. The new value replaces the old one.",
  // update_ticket: impact/urgency re-derive priority unless priority is in the same write
  setImpactUrgency:
    "Changing Impact or Urgency recalculates Priority from the project's Priority Matrix, as a manual edit does.",
  // actions.run_set_field assigned_group branch
  setGroup:
    "If the current assignee isn't a member of the new group, the assignee is cleared.",
  // ticket_service.add_comment(counts_as_response=False)
  publicComment:
    "Public comments are emailed like any reply, but don't count as the first response for SLA.",
  stop: "When this rule runs successfully, rules below it are skipped for the same event.",
  runAs: "Changes are made by the “Automation” user and show in the ticket's Activity tab.",
  runs: "The last 50 times this rule matched a ticket, with what it did or why it failed.",
  off: "Turned off: never runs.",
} as const;

// ── Priority Matrix tab ─────────────────────────────────────────────────────

export const PRIORITY_MATRIX_HELP = {
  reset: "Restores the standard ITIL matrix. Not saved until you click Save matrix.",
  // ticket_service.update_ticket: re-derived only when Impact/Urgency change
  save: "Existing tickets keep their priority until their Impact or Urgency is changed.",
} as const;

// ── Overview tab (itsm_projects) ────────────────────────────────────────────

export const OVERVIEW_HELP = {
  // workspace-provider filters status=active; portal._portal_projects active only
  status:
    "Inactive projects drop out of the agent workspace's project list and the portal stops accepting requests for them. Existing tickets are kept.",
  // ticket_service.create_ticket: assigned_group or default_group; routing when none chosen
  defaultGroup:
    "New tickets created without a group land here, unless a Routing rule matches first. Always allowed even when the Routing tab restricts groups.",
  defaultWorkflow:
    "The statuses and transitions new tickets follow. Workflows are shared, so editing one changes it for every project using it. Existing tickets keep the workflow they were created with.",
  // sla_engine.start_trackers: project.calendar wins; snapshot per tracker
  calendar:
    "Working hours and holidays for this project's SLA clocks. Overrides the SLA policy's calendar; “Use default” falls back to it, then the default calendar. Applies to clocks started after saving.",
  newWorkflow:
    "Creates a To Do → In Progress → Done starter and selects it. Click Save changes to link it.",
} as const;

// ── Projects list ───────────────────────────────────────────────────────────

export const PROJECT_TYPE_HELP: Record<string, string> = {
  incident: "Standard Incident project: break/fix tickets, priority from the Impact × Urgency matrix.",
  service_request: "Standard Request project: service requests.",
  problem: "Standard Problem project: agent-only root-cause work (never on the portal), no SLA by default.",
  custom: "Custom project you configure yourself.",
};
