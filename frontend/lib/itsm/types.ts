/** Shared TypeScript types for the ITSM platform. */

export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

// ---- auth / users ---------------------------------------------------------

export type PermAction = "read" | "create" | "update" | "delete";
export type ModulePerms = Record<PermAction, boolean>;
/** module_code -> {read, create, update, delete} */
export type PermissionMap = Record<string, ModulePerms>;

export type ItsmRole = { code: string; name: string };

/** A workspace/department (helpdesk) the user can access. */
export type Helpdesk = {
  id: string;
  key: string;
  name: string;
  icon?: string;
  color?: string;
  description?: string;
  status?: string;
  order?: number;
  /** Sender identity for notification emails (used when a project has no mailbox). */
  notification_from_name?: string;
  notification_from_email?: string;
  /** Admin default column layout for the cross-project "All Tickets" queue. */
  combined_queue_columns?: string[];
  /** All Tickets default view (Configuration → All-Tickets Filters) — a system view
   *  key or "saved:<uuid>". Blank ⇒ product default (PRODUCT_DEFAULT_VIEW_KEY). */
  combined_default_view_key?: string;
  /** System view keys hidden from the All Tickets dropdown ("all" excluded). */
  combined_disabled_view_keys?: string[];
  member_count?: number;
  /** Only on the create response when `with_standard_projects` was sent. */
  standard_projects?: { imported: string[]; errors: string[] };
};

export type ItsmUser = {
  id: string | number;
  username: string;
  full_name: string;
  email: string;
  is_superuser: boolean;
  role: ItsmRole | null;
  permissions: PermissionMap;
  helpdesks?: Helpdesk[];
  /** False for Microsoft-SSO accounts (no local password to change). */
  can_change_password?: boolean;
  /** Agent-app interface the user chose ("" = follow the organisation's default).
   *  Absent on a user cached before 2026-11-05. */
  ui_preference?: "" | "classic" | "modern";
};

export type LoginResponse = { access: string; refresh: string; user: ItsmUser };

/** Lightweight user reference embedded in ticket payloads. */
export type UserRef = { id: string; username: string; full_name: string; email?: string; first_name?: string; last_name?: string };

// ---- projects -------------------------------------------------------------

export type ProjectType = "incident" | "service_request" | "problem" | "custom";

/** One standard-project catalog entry (GET /projects/standard_templates/). */
export type StandardProjectTemplate = {
  template: string;
  name: string;
  description: string;
  project_type: ProjectType;
  color: string;
  icon: string;
  /** The project key an import would create (e.g. "ITPRB"). */
  key: string;
  installed: boolean;
  installed_project_id?: string | null;
  installed_project_key?: string | null;
};
export type StatusCategory = "todo" | "in_progress" | "done";
export type Priority = "p1" | "p2" | "p3" | "p4";

export type TicketType = {
  id: string;
  project: string;
  name: string;
  key: string;
  icon?: string;
  base_category?: string;
  parent?: string | null;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
};

export type Project = {
  id: string;
  helpdesk: string;
  helpdesk_key: string;
  helpdesk_name: string;
  name: string;
  key: string;
  description?: string;
  project_type: ProjectType;
  status: string;
  color?: string;
  icon?: string;
  default_group?: string | null;
  default_group_name?: string | null;
  default_workflow?: string | null;
  default_workflow_name?: string | null;
  calendar?: string | null;
  calendar_name?: string | null;
  /** Default ticket-queue column layout (ordered column keys). Empty ⇒ built-in default. */
  queue_columns?: string[];
  /** Project default queue view — a system view key ("open", "all", …) or
   *  "saved:<uuid>". Blank ⇒ product default (PRODUCT_DEFAULT_VIEW_KEY). */
  default_view_key?: string;
  /** System view keys hidden from this project's queue dropdown ("all" excluded). */
  disabled_view_keys?: string[];
  /** Whitelist of group ids assignable on this project. Empty ⇒ all groups allowed. */
  allowed_group_ids?: string[];
  /** ITIL Priority Matrix — matrix[impact][urgency] -> priority. Drives the
   *  auto-calculated Priority on Incident tickets (mirrored by lib/itsm/priority.ts). */
  priority_matrix?: PriorityMatrix;
  lead?: string | null;
  ticket_types: TicketType[];
  open_ticket_count?: number | null;
  created_at?: string;
};

/** matrix[impact][urgency] -> priority code (see default_priority_matrix on the server). */
export type PriorityMatrix = Record<string, Record<string, Priority>>;

export type CreateProjectInput = {
  helpdesk: string;
  name: string;
  key: string;
  description?: string;
  project_type: ProjectType;
  status?: string;
  color?: string;
  icon?: string;
  default_group?: string | null;
  default_workflow?: string | null;
  calendar?: string | null;
  lead?: string | null;
  queue_columns?: string[];
  default_view_key?: string;
  disabled_view_keys?: string[];
  allowed_group_ids?: string[];
  priority_matrix?: PriorityMatrix;
};

export type UpdateProjectInput = Partial<Omit<CreateProjectInput, "helpdesk">>;

// ---- tickets --------------------------------------------------------------

export type TicketListItem = {
  id: string;
  ticket_number: string;
  project: string;
  project_key: string;
  ticket_type: string;
  ticket_type_name: string | null;
  summary: string;
  status: string;
  status_key: string;
  status_name: string;
  status_category: StatusCategory;
  status_color: string | null;
  priority: Priority;
  assignee: UserRef | null;
  requestor: UserRef | null;
  assigned_group: string | null;
  assigned_group_name: string | null;
  created_by: UserRef | null;
  updated_by: UserRef | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  /** Compact per-metric SLA summary for the queue's RAG-bar columns. */
  sla?: QueueSla | null;
  /** Display-ready custom-field values for the combined queue's custom columns —
   *  keyed `cf:<key>` to match the column id. Present only when the list was
   *  requested with `?cf=`; `null` otherwise (single-project queue + detail). */
  custom_values?: Record<string, string | number | boolean | null> | null;
  /** The ticket's primary linked asset (Asset Management phase 2), or null. */
  primary_asset?: { id: string; asset_tag: string; name: string } | null;
  /** The description as plain text (line breaks kept, ≤ 300 characters + "…") for the
   *  Modern queue's ticket-number hover card (2026-11-05c). "" when there is none. */
  description_preview?: string;
};

/** One asset linked to a ticket (`TicketDetail.assets`, `GET tickets/{id}/assets/`).
 *  Primary first. `is_deleted` = the asset was soft-deleted after linking. */
export type TicketAssetLink = {
  link_id: string;
  id: string;
  asset_tag: string;
  name: string;
  category: string | null;
  sub_category: string | null;
  status: { name: string; color: string; state_type: string } | null;
  location: string | null;
  assigned_user: { id: string | number; username: string; full_name: string } | null;
  is_primary: boolean;
  is_deleted: boolean;
};

/** Response of the ticket asset-link writes (link / unlink / primary). */
export type TicketAssetsResponse = { assets: TicketAssetLink[]; updated_at: string };

/** Compact SLA payload returned per ticket in the list endpoint (one per metric). */
export type QueueSlaEntry = {
  state: string;
  due_at: string;
  started_at: string;
  target_minutes: number;
  breached: boolean;
  paused: boolean;
  /** Business minutes used ÷ target × 100 at fetch time (server, `sla_engine.timer_snapshot`); > 100 when overdue. */
  percent_used: number;
  rag: RagState;
};

export type QueueSla = {
  first_response: QueueSlaEntry | null;
  resolution: QueueSlaEntry | null;
};

/** One populated custom user attribute of the ticket's requestor (detail-only). */
export type RequestorAttribute = { key: string; label: string; type: string; value: unknown };

export type TicketDetail = TicketListItem & {
  /** Key of the ticket's helpdesk — used to canonicalise the URL after a move. */
  helpdesk_key?: string;
  description_html: string;
  description_text?: string;
  workflow: string;
  workflow_name: string;
  impact?: string;
  urgency?: string;
  resolution?: string;
  source?: string;
  /** ITIL Impact Assessment (agent-only; surfaced on Incident projects). */
  business_impact?: string;
  users_affected?: number | null;
  service_downtime?: boolean | null;
  major_incident?: boolean;
  /** ITIL Resolution Details (captured on the Resolve screen). */
  resolution_code?: string;
  root_cause?: string;
  workaround_provided?: boolean | null;
  resolution_notes?: string;
  /** ITIL Problem (KEDB) fields (agent-only; surfaced on Problem projects). */
  workaround_notes?: string;
  investigation_reason?: string;
  first_responded_at?: string | null;
  assigned_at?: string | null;
  closed_at?: string | null;
  reopen_count?: number;
  custom_fields?: Record<string, unknown>;
  requestor_attributes?: RequestorAttribute[];
  /** Linked assets, primary first (Asset Management phase 2). */
  assets?: TicketAssetLink[];
  /** The current status offers "Send for approval" (Workflow → status settings). */
  status_allows_approval?: boolean;
};

/** Note-prompt config carried on a transition: opens a slide-over asking for a note
 *  (posted as a public/internal comment) when the transition runs. */
export type TransitionNoteVisibility = "public" | "private";

export type Transition = {
  id: string;
  workflow: string;
  name: string;
  from_status: string | null;
  from_status_key: string | null;
  to_status: string;
  to_status_key: string;
  /** Display name of the target status (U4, 2026-10-18). */
  to_status_name?: string;
  to_status_category?: StatusCategory;
  from_status_name?: string | null;
  is_global: boolean;
  sort_order: number;
  note_prompt?: boolean;
  note_required?: boolean;
  note_heading?: string;
  note_visibility?: TransitionNoteVisibility;
  /** End-user Service Portal may invoke this transition (e.g. Reopen). */
  portal_allowed?: boolean;
  post_functions?: { type: string; config?: Record<string, unknown> }[];
  /** A field condition that fails on the ticket's CURRENT values (U4): the button is
   *  shown disabled with this reason. Null when nothing blocks it. The server still
   *  re-checks on POST. Only set by GET tickets/{id}/available-transitions/. */
  blocked_reason?: string | null;
  /** Resolved transition-screen fields (e.g. the Incident Resolve screen) — the
   *  agent slide-over renders a control per field. Empty when the transition has
   *  no screen. Provided by GET tickets/{id}/available-transitions/. */
  screen_fields?: TransitionScreenField[];
};

/** One field on a transition screen, resolved with its FieldDefinition metadata so
 *  the client can render the right control (dropdown options, type, label). */
export type TransitionScreenField = {
  field_key: string;
  is_mandatory: boolean;
  sort_order: number;
  name: string;
  field_type: string;
  options: { value: string; label: string }[];
  /** The field's "show when …" rule from the ticket's layout (null = always shown).
   *  The slide-over evaluates it live with `evalRule`; the engine re-checks it, so a
   *  field the rule hides or locks is neither required nor saved (2026-11-05c). */
  visibility_rule?: unknown;
};

export type CommentVisibility = "public" | "private";

export type CommentAttachmentKind = "file" | "image";

export type CommentAttachment = {
  id: string;
  ticket: string | null;
  comment: string | null;
  kind: CommentAttachmentKind;
  file: string;
  original_name: string;
  size_bytes: number;
  content_type: string;
  created_at: string;
};

export type TicketComment = {
  id: string;
  ticket: string;
  author: UserRef | null;
  visibility: CommentVisibility;
  body_html: string;
  body_text?: string;
  edited_at: string | null;
  created_at: string;
  /** File attachments listed under the comment (inline images live in body_html). */
  attachments?: CommentAttachment[];
};

/** A user watching a ticket (notified on activity). */
export type Watcher = { id: string; ticket: string; user: UserRef };

/** The 7 relationship types a ticket link can carry (server `TicketLink.LinkType`). */
export type LinkType =
  | "relates_to" | "blocks" | "blocked_by"
  | "duplicates" | "duplicated_by" | "causes" | "caused_by";

/** One ticket link as seen from the *viewed* ticket. The server merges outbound
 *  (`links_out`) and inbound (`links_in`) rows and, for inbound ones, flips
 *  `link_type` to its inverse — so "A blocks B" reads "blocks" on A and
 *  "is blocked by" on B off the same single row. `other_*` describe the far ticket. */
export type TicketLink = {
  id: string;
  direction: "out" | "in";
  link_type: LinkType;
  link_type_display: string;
  other_id: string;
  other_number: string;
  other_summary: string;
  other_status_name?: string | null;
  other_status_category?: string | null;
  other_status_color?: string | null;
  /** Project + helpdesk keys of the far ticket — used to build its detail route. */
  other_project_key?: string | null;
  other_helpdesk_key?: string | null;
};

/** Ticket-level file attachment. `content_type` drives image-preview detection. */
export type TicketAttachment = {
  id: string;
  file: string;
  original_name: string;
  size_bytes: number;
  content_type?: string;
};

export type ActivityEvent = {
  id: string;
  ticket: string;
  actor: UserRef | null;
  action: string;
  field_key?: string;
  payload?: Record<string, unknown> | null;
  created_at: string;
};

/** One source custom field's proposed mapping when moving projects. */
export type MoveFieldMappingRow = {
  source_key: string;
  source_name: string;
  source_type: string;
  current_display_value: string;
  /** Target field key when key+type (+options) match; null ⇒ auto-drops. */
  proposed_target_key: string | null;
  /** No compatible target field exists at all (drop is the only option). */
  will_drop_forced: boolean;
  target_required: boolean;
  candidates: { key: string; label: string; type: string }[];
};

/** The move wizard proposal returned by `GET tickets/{id}/move-options/`. */
export type MoveOptions = {
  target_project: { id: string; key: string; name: string; helpdesk_key: string; status: string };
  target_types: { id: string; name: string; key: string; is_default: boolean }[];
  default_target_type_id: string;
  target_statuses: { id: string; key: string; name: string; category: string }[];
  suggested_status_id: string | null;
  has_pending_approval: boolean;
  fields: MoveFieldMappingRow[];
  assignment: { group_allowed_in_target: boolean; assignee_will_clear: boolean };
};

/** POST body for `tickets/{id}/move/`. */
export type MoveInput = {
  target_project: string;
  target_ticket_type: string;
  target_status: string;
  target_category?: string[];
  /** sourceKey → targetKey overrides (auto-match used when a key is absent). */
  field_mapping?: Record<string, string>;
  /** source keys the agent chose to drop. */
  drop_field_keys?: string[];
};

export type CreateTicketInput = {
  project: string;
  ticket_type: string;
  summary: string;
  description_html?: string;
  priority?: Priority;
  impact?: string;
  urgency?: string;
  requestor?: string | null;
  assigned_group?: string | null;
  assignee?: string | null;
  source?: string;
  custom_fields?: Record<string, unknown>;
  /** Linked asset ids, primary first (the "Asset" system field, `maps_to: "assets"`). */
  assets?: string[];
};

/** Inline detail-view edits. User/group FKs accept a pk string or null (to clear). */
export type UpdateTicketInput = Partial<{
  priority: Priority;
  summary: string;
  description_html: string;
  impact: string;
  urgency: string;
  // ITIL Impact Assessment (column-backed; editable inline on Incident tickets).
  business_impact: string;
  users_affected: number | null;
  service_downtime: boolean | null;
  major_incident: boolean;
  // ITIL Problem (KEDB) fields (column-backed; Problem projects).
  workaround_notes?: string;
  investigation_reason?: string;
  requestor: string | null;
  assignee: string | null;
  assigned_group: string | null;
  /** Stale-write guard: the ticket `updated_at` the agent last saw (409 if older). */
  expected_updated_at: string;
}>;

/** GET /tickets/{id}/pulse/ — cheap change token for the live ticket detail. */
export type TicketPulse = {
  version: string;
  updated_at: string;
  comment_count: number;
  attachment_count: number;
  last_event_id: string | null;
  last_actor: { id: string; name: string } | null;
};

// ---- request catalog ------------------------------------------------------

export type CatalogCategory = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  color?: string;
  helpdesk_key?: string | null;
};

export type CatalogItem = {
  id: string;
  category: string;
  category_name: string;
  name: string;
  slug: string;
  short_description: string;
  description_html?: string;
  icon?: string;
  project: string;
  project_key: string;
  helpdesk_key: string;
  requires_approval: boolean;
  approval_workflow_name?: string | null;
  default_priority: string;
};

// ---- knowledge base -------------------------------------------------------

export type KBCategory = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parent?: string | null;
  helpdesk?: string | null;
  helpdesk_key?: string | null;
  sort_order?: number;
};

export type ArticleListItem = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  category: string | null;
  category_name?: string | null;
  helpdesk?: string | null;
  status: string;
  visibility: string;
  tags: string[];
  view_count: number;
  published_at?: string | null;
  updated_at: string;
};

export type Article = ArticleListItem & {
  body_html: string;
  author_name?: string | null;
  helpful_count: number;
  not_helpful_count: number;
  created_at: string;
};

/** Create/update payload for an article (KB authoring). `slug` is required + unique. */
export type ArticleInput = {
  title: string;
  slug: string;
  summary?: string;
  body_html: string;
  category?: string | null;
  helpdesk?: string | null;
  tags?: string[];
  visibility?: "portal" | "internal";
  status?: string;
};

/** Create/update payload for a KB category. `slug` is required + unique. */
export type KBCategoryInput = {
  name: string;
  slug: string;
  description?: string;
  parent?: string | null;
  helpdesk?: string | null;
  sort_order?: number;
};

// ---- approvals ------------------------------------------------------------

export type ApprovalDecision = "approved" | "rejected";

export type ApprovalAction = {
  id: string;
  approver_name?: string | null;
  stage_name?: string | null;
  stage_level?: number | null;
  decision: ApprovalDecision;
  comment: string;
  created_at: string;
};

/** A stage currently awaiting a decision, and who it waits for. */
export type ApprovalPendingStage = {
  id: string;
  name: string;
  level: number;
  approver_type: ApproverType;
  /** e.g. "Priya Raman", "anyone with the role “Supervisor”". */
  approver_label: string;
  /** Up to 5 names of people who can still decide this stage. */
  approver_names: string[];
  approver_count: number;
};

export type ApprovalRequest = {
  id: string;
  ticket: string;
  ticket_number: string;
  ticket_summary: string;
  ticket_project_key?: string | null;
  ticket_helpdesk_key?: string | null;
  workflow_name: string;
  mode?: ApprovalMode;
  current_stage_name?: string | null;
  current_stage_level?: number | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decided_at?: string | null;
  actions: ApprovalAction[];
  created_at: string;
  /** Stages awaiting a decision (all of them at once in parallel mode). */
  pending_stages?: ApprovalPendingStage[];
  /** The current user can approve/reject a pending stage right now. */
  can_decide?: boolean;
  /** Why this pending approval can't complete right now (e.g. a stage lost its approver). */
  blocked_reason?: string | null;
  /** "sent" = an agent used Send for approval; "policy" = a workflow transition / catalog item. */
  source?: "policy" | "sent";
  /** The sender's message to the approver (sent requests). */
  note?: string;
  requested_by_name?: string | null;
  /** Sent requests: where the ticket waits, and where it goes back to when decided. */
  waiting_status_name?: string | null;
  return_status_name?: string | null;
  /** The current user may withdraw this pending sent request. */
  can_withdraw?: boolean;
};

// ---- send for approval -----------------------------------------------------

export type OnFlyPool = "any_user" | "group" | "listed_users";

export type SendOptionPerson = { id: number | string; name: string; username?: string; email: string };

export type SendOptionStage = {
  id: string;
  name: string;
  level: number;
  approver_type: ApproverType;
  approver_label: string;
  rule: ApprovalRule;
  min_approvals: number;
  /** Why this stage can't start for this ticket (fixed stages; On fly: its pool). */
  problem: string | null;
  /** Fixed stages: who it resolves to for this ticket (up to 5 names). */
  approver_names: string[];
  approver_count: number;
  /** On fly only. `candidates` is null for "any user" (search the directory). */
  on_fly_pool?: OnFlyPool;
  pool_label?: string;
  candidates?: SendOptionPerson[] | null;
};

export type SendOptionPolicy = {
  id: string;
  name: string;
  description?: string;
  mode: ApprovalMode;
  /** Why this policy can't start for this ticket, or null. */
  problem: string | null;
  stages: SendOptionStage[];
};

export type SendOptions = {
  allowed: boolean;
  reason: string | null;
  status: { id: string; name: string } | null;
  /** Where the ticket waits while the approval is pending (null = it stays put). */
  waiting_status: { id: string; name: string } | null;
  workflows: SendOptionPolicy[];
};

// ---- portal (requestor-scoped) --------------------------------------------

export type PortalTicket = {
  id: string;
  ticket_number: string;
  summary: string;
  description_html: string;
  status_key: string;
  status_name: string;
  status_category: StatusCategory;
  status_color: string | null;
  priority: Priority;
  helpdesk_name: string;
  ticket_type_name?: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
};

/** Portal request detail: the list ticket + the portal-visible field layout,
 *  its field definitions, and the resolved (display-ready) values per field key. */
/** One of the requestor's own assets (`portal/request-intake/my-assets/`). */
export type PortalAsset = { id: string; asset_tag: string; name: string; category: string; sub_category: string | null };

export type PortalTicketDetail = PortalTicket & {
  layout: { id: string | null; items: FieldLayoutItem[]; name?: string };
  fields: FieldDefinition[];
  field_values: Record<string, unknown>;
  /** File attachments on the request (view/download/upload from the portal). */
  attachments?: TicketAttachment[];
  /** Watchers (name only — the portal never exposes other users' emails). */
  watchers?: PortalWatcher[];
  /** How the caller sees this request: only the requestor can reply, reopen, change
   *  watchers, upload or give feedback; approvers and watchers read only. */
  viewer_role?: PortalViewerRole | null;
};

/** Portal watcher: name only (directory-privacy — no email). */
export type PortalWatcher = { id: string; name: string };

/** A portal-invokable transition (e.g. Reopen). */
export type PortalTransition = {
  id: string;
  name: string;
  to_status_name: string;
  to_status_category: StatusCategory;
  note_prompt?: boolean;
  note_required?: boolean;
  note_heading?: string;
};

export type PortalComment = {
  id: string;
  author_name?: string | null;
  body_html: string;
  created_at: string;
};

// ---- canned responses -----------------------------------------------------

export type CannedNoteScope = "personal" | "workspace" | "project";

export type CannedNoteCategory = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export type CannedNote = {
  id: string;
  title: string;
  body_html: string;
  body_text: string;
  shortcut: string;
  category: string | null;
  category_name: string | null;
  scope: CannedNoteScope;
  scope_label: string;
  helpdesk: string | null;
  helpdesk_name: string | null;
  project: string | null;
  project_name: string | null;
  is_shared: boolean;
  owner: UserRef | null;
  usage_count: number;
  created_at?: string;
};

export type CreateCannedNoteInput = {
  title: string;
  body_html: string;
  shortcut?: string;
  category?: string | null;
  scope: CannedNoteScope;
  helpdesk?: string | null;
  project?: string | null;
};
export type UpdateCannedNoteInput = Partial<CreateCannedNoteInput>;
export type CreateCannedNoteCategoryInput = { name: string; sort_order?: number; is_active?: boolean };

// ---- SLA + notifications --------------------------------------------------

export type RagState = "green" | "amber" | "red" | "grey";

export type SlaEntry = {
  metric: string;
  metric_name: string;
  state: string;
  due_at: string | null;
  paused: boolean;
  breached: boolean;
  target_minutes: number | null;
  elapsed_minutes: number | null;
  remaining_minutes: number | null;
  /** Business minutes used ÷ target × 100 (same figure as the queue bar). */
  percent_used?: number | null;
  rag: RagState;
  /** Why a paused clock is paused: "approval" = a pending approval with "Pause SLA while
   *  waiting" holds it; null = a status / workflow pause. Only on GET tickets/{id}/sla/. */
  pause_reason?: "approval" | null;
};

// ---- SLA configuration (project settings → SLA tab) -----------------------

export type SlaMetricKind = "first_response" | "resolution" | "assignment" | "custom";

export type SlaTarget = {
  id: string;
  metric: string;
  priority: Priority;
  target_minutes: number;
};

export type SlaEscalationRule = {
  id: string;
  metric: string;
  threshold_pct: number;
  action: "notify" | "reassign" | "raise_priority";
  config?: Record<string, unknown>;
};

export type SlaMetricConfig = {
  id: string;
  policy: string;
  kind: SlaMetricKind;
  name: string;
  pause_statuses?: string[];
  targets: SlaTarget[];
  escalations: SlaEscalationRule[];
};

export type SlaPolicy = {
  id: string;
  name: string;
  description?: string;
  project: string | null;
  calendar: string | null;
  is_default: boolean;
  is_active: boolean;
  applies_to?: Record<string, unknown>;
  metrics: SlaMetricConfig[];
};

export type Notification = {
  id: string;
  event_type?: string;
  ticket?: string | null;
  ticket_number?: string | null;
  title?: string;
  body_text?: string;
  link?: string | null;
  is_read: boolean;
  read_at?: string | null;
  created_at: string;
};

// ---- notification configuration (per-project scheme / rules / templates) ----

export type NotificationChannelKey = "in_app" | "email" | "whatsapp";

export type EmailTemplate = {
  id: string;
  name: string;
  event_type: string;
  subject_template: string;
  body_html_template: string;
  body_text_template: string;
  is_system: boolean;
};

export type NotificationRule = {
  id: string;
  scheme: string;
  event_type: string;
  recipients: string[];
  channels: NotificationChannelKey[];
  email_template: string | null;
  notify_actor: boolean;
  is_active: boolean;
};

export type NotificationScheme = {
  id: string;
  name: string;
  description?: string;
  project: string | null;
  is_default: boolean;
  rules: NotificationRule[];
};

/** Who is viewing a portal request (`PortalTicketViewSet.retrieve`). */
export type PortalViewerRole = "requestor" | "approver" | "watcher";

/** `events` (recipients only): the events this selector applies to — the matrix shows
 *  the chip only there. Absent = every event. */
export type NotificationMetaItem = { value: string; label: string; events?: string[] };
export type NotificationChannelMeta = {
  value: NotificationChannelKey;
  label: string;
  available: boolean;
  coming_soon?: boolean;
};
export type NotificationMeta = {
  events: NotificationMetaItem[];
  recipients: NotificationMetaItem[];
  channels: NotificationChannelMeta[];
};

// ---- settings (statuses, calendar) + reports ------------------------------

export type WorkflowStatus = {
  id: string;
  workflow: string;
  name: string;
  key: string;
  category: string;
  category_key: StatusCategory;
  category_name: string;
  color: string;
  sort_order: number;
  is_initial: boolean;
  // When true, entering this status pauses all of a ticket's running SLA clocks
  // ("Exclude from SLA calculation"). Optional to stay tolerant of older payloads.
  pauses_sla?: boolean;
  /** Agents may "Send for approval" from this status. */
  allows_send_for_approval?: boolean;
  /** Where the ticket waits while that approval is pending (null = it stays here). */
  approval_waiting_status?: string | null;
  approval_waiting_status_name?: string | null;
};

export type BusinessHours = {
  id: string;
  calendar: string;
  weekday: number; // 0=Mon … 6=Sun
  start_time: string; // "HH:MM:SS"
  end_time: string;
};

export type Holiday = {
  id: string;
  calendar: string;
  date: string; // "YYYY-MM-DD"
  name: string;
  recurring_annually: boolean;
};

export type BusinessCalendar = {
  id: string;
  name: string;
  timezone: string;
  is_default: boolean;
  hours: BusinessHours[];
  holidays: Holiday[];
};

export type CreateCalendarInput = { name: string; timezone: string; is_default?: boolean };

export type ReportResult = { report: string; data: unknown };

// ---- CSAT surveys ---------------------------------------------------------
export type SurveyScaleType = "csat5" | "stars5" | "thumbs" | "nps";
export type SurveyTrigger = "resolved" | "closed";

export type SurveyConfig = {
  id: string;
  project: string | null;
  project_key?: string | null;
  is_default: boolean;
  enabled: boolean;
  trigger: SurveyTrigger;
  scale_type: SurveyScaleType;
  question_text: string;
  intro_text: string;
  scale_labels: string[];
  comment_enabled: boolean;
  comment_prompt: string;
  comment_required: boolean;
  thank_you_text: string;
  email_subject: string;
  email_body_html: string;
  created_at: string;
  updated_at: string;
};

export type SurveyMeta = {
  scale_types: { value: SurveyScaleType; label: string; values: number[] }[];
  triggers: { value: SurveyTrigger; label: string }[];
};

/** The requestor-facing survey slice (portal feedback page) — no email/internal fields. */
export type PortalSurveyConfig = {
  scale_type: SurveyScaleType;
  question_text: string;
  intro_text: string;
  scale_labels: string[];
  comment_enabled: boolean;
  comment_prompt: string;
  comment_required: boolean;
  thank_you_text: string;
};
export type PortalSurveyResponse = {
  id: string;
  status: "pending" | "submitted";
  scale_type: SurveyScaleType;
  rating: number | null;
  comment: string;
  submitted_at: string | null;
} | null;
export type PortalSurveyState = {
  enabled: boolean;
  config: PortalSurveyConfig | null;
  response: PortalSurveyResponse;
};

// ---- filters + saved views ------------------------------------------------

export type FilterMatch = "all" | "any";

export type FilterOperator =
  | "eq" | "neq" | "in" | "not_in" | "is_empty" | "is_not_empty"
  | "contains" | "not_contains"
  | "gt" | "gte" | "lt" | "lte" | "between"
  | "on" | "before" | "after"
  | "today" | "yesterday" | "last_7_days" | "last_30_days" | "this_week" | "this_month"
  | "overdue" | "due_today"
  | "is_true" | "is_false";

export type FilterValue = string | number | boolean | string[] | number[] | null;

export type FilterCondition = {
  field: string; // built-in key or "cf:<key>"
  op: FilterOperator;
  value?: FilterValue;
};

export type FilterSpec = { match: FilterMatch; conditions: FilterCondition[] };

export type FilterFieldType =
  | "select" | "multiselect" | "choice" | "user" | "date" | "text" | "number" | "boolean";

export type OptionSource = "statuses" | "groups" | "users" | "ticket_types" | "projects";

export type FilterFieldOption = {
  value: string;
  label: string;
  color?: string | null;
  /** Other ids that mean the same option (status: same-key statuses of a pre-copy
   *  workflow). A saved filter holding one still shows this label + checked state. */
  aliases?: string[];
};

export type FilterFieldMeta = {
  key: string;
  label: string;
  type: FilterFieldType;
  operators: FilterOperator[];
  options?: FilterFieldOption[];
  options_source?: OptionSource;
  ordering_key?: string;
  group?: string;
  /** Set on a column-backed (`config.maps_to`) system custom field — its value lives
   *  on the Ticket column, so it has no `FieldValue`.
   *  Use `isColumnEligibleCf` (queue-columns.tsx) rather than testing this by hand. */
  maps_to?: string | null;
  /** The server says this field can be a `cf:` queue column (value-backed, or a
   *  column-backed ITIL field such as Resolution Notes). */
  column?: boolean;
};

export type SystemView = {
  key: string;
  name: string;
  query_spec: Partial<FilterSpec> & Record<string, unknown>;
  ordering?: string;
};

export type FilterFieldsResponse = { fields: FilterFieldMeta[]; system_views: SystemView[] };

export type SavedFilter = {
  id: string;
  name: string;
  owner: string | number | null;
  /** Creator's display name (full name, else username); "" when the owner is gone. */
  owner_name?: string;
  project: string | null;
  /** All-Tickets views (`project=null`): the helpdesk whose All Tickets they belong to.
   *  Always null for project views. */
  helpdesk?: string | null;
  is_shared: boolean;
  sort_order: number;
  query_spec: Partial<FilterSpec> & Record<string, unknown>;
  created_at?: string;
};

export type SavedFilterInput = {
  name: string;
  query_spec: Partial<FilterSpec> & Record<string, unknown>;
  is_shared?: boolean;
  project?: string | null;
  /** Required when `project` is null (a view saved from a helpdesk's All Tickets). */
  helpdesk?: string | null;
  sort_order?: number;
};

// ---- settings: helpdesk + groups ------------------------------------------

export type CreateHelpdeskInput = {
  name: string;
  key: string;
  description?: string;
  icon?: string;
  color?: string;
  status?: string;
  notification_from_name?: string;
  notification_from_email?: string;
  combined_queue_columns?: string[];
  combined_default_view_key?: string;
  combined_disabled_view_keys?: string[];
  /** Create only: also import the standard Incident + Service Request projects. */
  with_standard_projects?: boolean;
};
export type UpdateHelpdeskInput = Partial<Omit<CreateHelpdeskInput, "with_standard_projects">>;

export type HelpdeskMembership = {
  id: string;
  helpdesk: string;
  user: string;
  username: string;
  full_name: string;
  role_in_helpdesk: string;
  is_active: boolean;
};

export type GroupType =
  | "service_desk"
  | "network"
  | "infra"
  | "security"
  | "app_support"
  | "custom";

export type Group = {
  id: string;
  helpdesk: string | null;
  helpdesk_name?: string | null;
  name: string;
  key: string;
  description?: string;
  type: GroupType;
  lead: string | null;
  lead_name?: string | null;
  is_active: boolean;
  member_count?: number;
  created_at?: string;
};

export type CreateGroupInput = {
  helpdesk?: string | null;
  name: string;
  key: string;
  description?: string;
  type?: GroupType;
  lead?: string | null;
  is_active?: boolean;
};

// ---- routing rules (create-time auto-routing) -----------------------------

/** A single condition in a routing rule's match spec. `field` is a built-in
 *  attribute (priority / ticket_type / impact / urgency / source / mode) or a
 *  custom field key (e.g. "location"). */
export type RoutingCondition = {
  field: string;
  operator: "eq" | "neq";
  value: string;
};

export type RoutingMatchSpec = {
  match?: "all" | "any";
  conditions?: RoutingCondition[];
  // Legacy flat shape may also carry ticket_type / priority — read-tolerant.
  ticket_type?: string;
  priority?: string;
};

export type RoutingRule = {
  id: string;
  project: string | null;
  name: string;
  priority: number;
  match_spec: RoutingMatchSpec;
  target_group: string;
  target_group_name?: string;
  target_assignee?: string | null;
  target_assignee_name?: string | null;
  is_active: boolean;
};

export type RoutingRuleInput = {
  project: string;
  name: string;
  priority?: number;
  match_spec: RoutingMatchSpec;
  target_group: string;
  target_assignee?: string | null;
  is_active?: boolean;
};

// ---- automation rules (per-project When → If → Then) ----------------------

export type AutomationTriggerType = "ticket_created" | "ticket_updated" | "status_changed";
export type AutomationActionType = "transition" | "set_field" | "add_comment";

export type AutomationTrigger =
  | { type: "ticket_created"; config?: Record<string, never> }
  /** `fields` empty ⇒ any field change. Keys come from the catalog's `update_fields`. */
  | { type: "ticket_updated"; config: { fields: string[] } }
  /** Empty id lists ⇒ any status. */
  | { type: "status_changed"; config: { from_status_ids: string[]; to_status_ids: string[] } };

export type AutomationAction =
  | { type: "transition"; config: { transition_id: string; keep_assignee: boolean } }
  | { type: "set_field"; config: { field: string; value: FilterValue } }
  | {
      type: "add_comment";
      config: { body_html?: string; canned_note_id?: string; visibility: "public" | "private" };
    };

export type AutomationRule = {
  id: string;
  project: string;
  name: string;
  description: string;
  is_active: boolean;
  order: number;
  triggers: AutomationTrigger[];
  /** Same shape as a queue filter; `{}` ⇒ always true. */
  conditions: Partial<FilterSpec>;
  actions: AutomationAction[];
  stop_processing: boolean;
  last_run_at: string | null;
  run_count: number;
  failure_count: number;
  created_by: number | null;
  created_by_name: string | null;
  /** Display names for the user ids the rule references (conditions + set_field values). */
  user_labels: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type AutomationRuleInput = Partial<
  Pick<
    AutomationRule,
    "name" | "description" | "is_active" | "order" | "triggers" | "conditions" | "actions" | "stop_processing"
  >
> & { project?: string };

export type AutomationRun = {
  id: string;
  rule: string;
  ticket: string;
  ticket_number: string;
  event: AutomationTriggerType;
  status: "success" | "failed" | "skipped";
  message: string;
  actions_result: { type: AutomationActionType; status: "done" | "skipped"; detail: string }[];
  created_at: string;
};

/** A field a rule may watch or set. `filter_key` points at the queue filter registry
 *  entry (type + options) used to render the value picker. */
export type AutomationCatalogField = {
  key: string;
  label: string;
  filter_key: string | null;
  /** The field's type (set fields only), e.g. "number", "multiline", "cascade", "group_picker". */
  field_type?: string;
  /** Cascade set fields: the level names and this project's active nodes (for the path picker). */
  cascade?: {
    levels: string[];
    options: { id: string; value: string; label: string; parent: string | null }[];
  };
};

export type AutomationCatalog = {
  triggers: { value: AutomationTriggerType; label: string }[];
  actions: { value: AutomationActionType; label: string }[];
  update_fields: AutomationCatalogField[];
  set_fields: AutomationCatalogField[];
};

export type GroupRole = "member" | "lead";

export type GroupMembership = {
  id: string;
  group: string;
  user: string;
  username: string;
  full_name: string;
  role_in_group: GroupRole;
  is_active: boolean;
};

// ---- settings: custom fields + layouts ------------------------------------

export type FieldType =
  | "text"
  | "multiline"
  | "richtext"
  | "number"
  | "date"
  | "datetime"
  | "dropdown"
  | "multiselect"
  | "checkbox"
  | "radio"
  | "user_picker"
  | "group_picker"
  | "cascade"
  | "attachment"
  /** System-only "Asset" field (`maps_to: "assets"`); never offered in the new-field list. */
  | "asset_picker";

export type FieldOption = {
  id: string;
  field: string;
  parent?: string | null;
  level?: number;
  value: string;
  label: string;
  color?: string;
  sort_order: number;
  is_active: boolean;
};

export type FieldDefinition = {
  id: string;
  project: string | null;
  key: string;
  name: string;
  description?: string;
  field_type: FieldType;
  is_system: boolean;
  is_multi: boolean;
  config?: Record<string, unknown>;
  default_json?: unknown;
  options: FieldOption[];
};

// Conditional show / read-only rule: e.g. show this field only when Status is On hold.
export type FieldVisibilityRule = {
  action: "show" | "readonly";
  field: string; // condition source: a field key or a built-in attribute (e.g. "status")
  operator: "eq" | "neq";
  value: string;
};

export type LayoutRegion = "main" | "sidebar";
export type FieldWidth = "full" | "half";

export type FieldLayoutItem = {
  id: string;
  layout: string;
  field: string;
  field_key?: string;
  field_name?: string;
  field_type?: string;
  sort_order: number;
  is_hidden: boolean;
  /** Shown on the end-user Service Portal request form (independent of is_hidden).
   *  Absent (legacy/synthetic items) is treated as visible. */
  portal_visible?: boolean;
  is_mandatory: boolean;
  section: string;
  region: LayoutRegion;
  width: FieldWidth;
  visibility_rule?: FieldVisibilityRule | Record<string, unknown> | null;
};

/** A section declared on a layout (kept even while empty). Items still carry their
 *  own `section` name; forms only render sections that have visible fields.
 *  `collapsed` = starts collapsed on the agent ticket page (sent only when true). */
export type FieldLayoutSection = { region: LayoutRegion; name: string; collapsed?: boolean };

export type FieldLayout = {
  id: string;
  project: string;
  ticket_type: string | null;
  name: string;
  /** Declared sections in display order (FieldLayout.sections). */
  sections?: FieldLayoutSection[];
  items: FieldLayoutItem[];
};

// ---- settings: workflow editor --------------------------------------------

export type Workflow = {
  id: string;
  name: string;
  description?: string;
  base_type: ProjectType;
  is_default: boolean;
  is_active: boolean;
  version: number;
  status_count?: number;
  created_at?: string;
};

export type WorkflowStatusCategory = {
  id: string;
  key: StatusCategory;
  name: string;
  color: string;
  sort_order: number;
};

export type TransitionConditionType =
  | "role_in"
  | "group_member"
  | "is_assignee"
  | "field_equals"
  | "approval_granted";

export type TransitionCondition = {
  id: string;
  transition: string;
  condition_type: TransitionConditionType;
  config?: Record<string, unknown>;
  negate: boolean;
};

export type WorkflowTransition = {
  id: string;
  workflow: string;
  name: string;
  from_status: string | null;
  from_status_key: string | null;
  to_status: string;
  to_status_key: string;
  to_status_name?: string;
  to_status_category?: StatusCategory;
  from_status_name?: string | null;
  is_global: boolean;
  sort_order: number;
  post_functions?: { type: string; config?: Record<string, unknown> }[];
  auto_assign_rule?: string | null;
  screen?: string | null;
  conditions: TransitionCondition[];
  note_prompt?: boolean;
  note_required?: boolean;
  note_heading?: string;
  note_visibility?: TransitionNoteVisibility;
  /** End-user Service Portal may invoke this transition (e.g. Reopen). */
  portal_allowed?: boolean;
  /** Write-only: toggles the `approval_granted` gate condition on PATCH. The
   * current state is read from `conditions`, not echoed back here. */
  requires_approval?: boolean;
  /** Admin-configurable capture fields for this transition (e.g. Resolve → Root
   * cause / Resolution type). Read from the workflow graph; PATCH the same shape to
   * replace the transition's screen. Each `field_key` is a `FieldDefinition.key`. */
  screen_fields?: TransitionScreenFieldConfig[];
  /** Admin-configurable "block with a custom message" validators. Every rule must pass
   * or the transition is refused with the failing rule's `message` (the button stays
   * visible — unlike `conditions`, which hide it). Plain read/write JSON, PATCH the same
   * shape to replace them. */
  field_conditions?: TransitionFieldCondition[];
};

/** One capture field on a transition, as configured in the workflow editor (distinct
 *  from the runtime `TransitionScreenField`, which is resolved with name/type/options
 *  for rendering the ticket slide-over). */
export type TransitionScreenFieldConfig = {
  field_key: string;
  is_mandatory: boolean;
  sort_order: number;
};

export type TransitionFieldConditionOperator =
  | "is_not_empty"
  | "is_empty"
  | "equals"
  | "not_equals";

/** A JIRA-style *validator* on a transition. When the transition runs, `field_key` must
 *  satisfy `operator` (against `value` for equals/not_equals) or the run is blocked and
 *  `message` is surfaced (as a toast) to the user. Unlike `TransitionCondition` (which
 *  HIDES the button), a failed field condition leaves the button visible. `field_key` is
 *  a `FieldDefinition.key`; `value` is used only by equals/not_equals. */
export type TransitionFieldCondition = {
  field_key: string;
  operator: TransitionFieldConditionOperator;
  value?: string;
  message: string;
};

export type WorkflowGraph = {
  id: string;
  name: string;
  description?: string;
  base_type: ProjectType;
  is_default?: boolean;
  is_active: boolean;
  version: number;
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
};

export type WorkflowValidation = { valid: boolean; errors: string[]; warnings: string[] };

/** GET workflows/{id}/usage/ — which projects use this (shared) workflow (U6). */
export type WorkflowUsage = {
  project_count: number;
  projects: { id: string; key: string; name: string; helpdesk_key: string | null }[];
  /** Projects using it that the viewer can't see (counted, not named). */
  hidden_count: number;
  is_default: boolean;
  base_type: ProjectType;
};

/** POST workflows/{id}/clone/ result: the copy + what happened to automation rules. */
export type WorkflowCloneResult = Workflow & {
  automation?: { repointed: number; unmatched: string[] };
};

// ---- settings: approvals (admin) ------------------------------------------

export type ApproverType = "specific_user" | "role" | "group" | "requestor_manager" | "on_the_fly";
export type ApprovalRule = "any" | "all";
export type ApprovalMode = "sequential" | "parallel";

export type ApprovalStage = {
  id: string;
  workflow: string;
  name: string;
  level: number;
  approver_type: ApproverType;
  approver_user: string | null;
  approver_user_name?: string | null;
  approver_role: string | null;
  approver_role_name?: string | null;
  approver_group: string | null;
  approver_group_name?: string | null;
  /** Config problem that will make starting this approval fail (e.g. "Has no approver — …"). */
  approver_problem?: string | null;
  rule: ApprovalRule;
  min_approvals: number;
  /** On fly only: who the agent may pick from ("group" uses approver_group). */
  on_fly_pool?: OnFlyPool | "";
  candidate_users?: (number | string)[];
  candidate_users_detail?: { id: number | string; name: string; is_active: boolean }[];
};

export type ApprovalWorkflow = {
  id: string;
  name: string;
  description?: string;
  helpdesk: string | null;
  project: string | null;
  project_name?: string | null;
  mode: ApprovalMode;
  is_active: boolean;
  /** "Pause SLA while waiting": a pending request under this policy holds the ticket's
   *  first-response, resolution and assignment clocks (copied onto each request at start). */
  pause_sla?: boolean;
  stages: ApprovalStage[];
};

/** One (role, module) grant row — the four CRUD bits the matrix editor toggles. */
export type RolePermissionRow = {
  id: string;
  role: string;
  module: string;
  module_code: string;
  can_read: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
};

export type SystemRole = {
  id: string;
  code: string;
  name: string;
  description?: string;
  is_system: boolean;
  is_active: boolean;
  /** Users who hold this role (active or not) — a role in use can't be deleted. */
  user_count?: number;
  /** Nested grant matrix, returned on GET /roles/ and /roles/{id}/. */
  permissions?: RolePermissionRow[];
};

/** Which bucket a module belongs to in the role editor (display grouping only). */
export type ItsmModuleCategory = "operations" | "administration";

/** A node in the permission tree (GET /itsm/modules/, a bare array). */
export type ItsmModule = {
  id: string;
  code: string;
  name: string;
  description?: string;
  category: ItsmModuleCategory;
  parent_code?: string | null;
  sort_order: number;
  is_active: boolean;
};

/** Binds a user to one ITSM SystemRole. */
export type RoleAssignment = {
  id: string;
  user: string | number;
  username: string;
  role: string;
  role_code: string;
  role_name: string;
};

export type RoleInHelpdesk = "member" | "lead";

/** A user's membership in one helpdesk, as embedded in a member roster row. */
export type MemberHelpdesk = {
  id: string;
  key: string;
  name: string;
  role_in_helpdesk: RoleInHelpdesk;
};

/** A per-user project access grant, embedded in a member roster row. */
export type MemberProject = {
  id: string;
  key: string;
  name: string;
  /** The owning helpdesk id (so the UI can group projects under their helpdesk). */
  helpdesk: string;
  helpdesk_key: string;
};

/** A per-user project access grant (the `/project-memberships/` resource). */
export type ProjectMembership = {
  id: string;
  project: string;
  project_key: string;
  project_name: string;
  helpdesk: string;
  user: string | number;
  username: string;
  full_name: string;
  is_active: boolean;
};

/** Admin roster row: a user + their ITSM role + per-helpdesk membership. */
export type Member = {
  id: string | number;
  username: string;
  full_name: string;
  email: string;
  is_active: boolean;
  is_superuser: boolean;
  role: ItsmRole | null;
  helpdesks: MemberHelpdesk[];
  /** Per-user project access grants (drives the User-Management project picker). */
  projects: MemberProject[];
  /** Org-defined custom attribute values, keyed by attribute key. */
  attributes: Record<string, unknown>;
  /** email-bot / automation-bot — can't be deactivated or edited. */
  is_system_account?: boolean;
  /** Reporting line; "Requestor's manager" approvals ask this person. */
  manager?: { id: string; username: string; full_name: string } | null;
  /** Only on the create_user response: the generated password to share once.
   *  Absent for Microsoft-SSO users (they have no local password). */
  temp_password?: string;
};

/** The shapes an org admin can give a custom user attribute. */
export type UserAttributeType =
  | "text"
  | "number"
  | "date"
  | "checkbox"
  | "dropdown"
  | "multiselect";

/** Option types backed by a list of choices. */
export const USER_ATTR_OPTION_TYPES: UserAttributeType[] = ["dropdown", "multiselect"];

export type UserAttributeOption = {
  id: string;
  attribute: string;
  value: string;
  label: string;
  color?: string;
  sort_order: number;
  is_active: boolean;
};

/** An org-defined custom attribute carried by every user. */
export type UserAttributeDefinition = {
  id: string;
  key: string;
  name: string;
  description?: string;
  attr_type: UserAttributeType;
  is_required: boolean;
  /** Default-visible roster column (an agent can still toggle it off locally). */
  show_in_table: boolean;
  sort_order: number;
  is_active: boolean;
  config?: Record<string, unknown>;
  options: UserAttributeOption[];
};

/** Roster filter metadata (GET members/filter_fields/). */
export type UserAttributeFilterField = {
  key: string;
  name: string;
  type: UserAttributeType;
  options?: { value: string; label: string }[];
};

/** How a user signs in. Chosen per-user at creation. */
export type AuthMethod = "password" | "microsoft";

export type CreateUserInput = {
  username: string;
  email?: string;
  full_name?: string;
  is_active?: boolean;
  role_code?: string;
  /** Sign-in method. Omit (or "password") for the classic username/password. */
  auth_method?: AuthMethod;
  helpdesks?: { id: string; role_in_helpdesk?: RoleInHelpdesk }[];
  projects?: { id: string }[];
  /** Org-defined custom attribute values, keyed by attribute key. */
  attributes?: Record<string, unknown>;
};

/** Public, pre-auth: what the login page reads to decide whether to show SSO. */
export type SsoPublicConfig = { microsoft_enabled: boolean };

/** Tenant-admin SSO settings (Authentication page). The client secret is
 *  write-only; reads expose only `has_microsoft_client_secret`. */
export type TenantSsoConfig = {
  id: string | null;
  enabled: boolean;
  microsoft_client_id: string;
  microsoft_tenant_id: string;
  /** Write-only on PUT; never returned. */
  microsoft_client_secret?: string;
  has_microsoft_client_secret: boolean;
  auto_provision: boolean;
  allowed_email_domains: string;
  microsoft_configured: boolean;
  microsoft_enabled: boolean;
  /** The exact Redirect URI the tenant must register in their Entra app. */
  redirect_uri: string;
  updated_at: string | null;
};

export type TenantSsoConfigInput = Partial<
  Pick<
    TenantSsoConfig,
    | "enabled"
    | "microsoft_client_id"
    | "microsoft_tenant_id"
    | "microsoft_client_secret"
    | "auto_provision"
    | "allowed_email_domains"
  >
>;

/** Public, pre-auth: the org's Classic / Modern policy for the agent app. */
export type InterfacePublicConfig = {
  ui_default: "classic" | "modern";
  ui_allow_switch: boolean;
  /** ISO date (YYYY-MM-DD) Classic is retired on, or null. */
  ui_classic_retire_on: string | null;
  classic_retired: boolean;
};

/** Tenant-admin Interface settings (Tenant Settings → Interface: Classic or Modern). */
export type TenantInterfaceConfig = InterfacePublicConfig & {
  id: string | null;
  updated_at: string | null;
};

/** Public, pre-auth: the client name, logo + website the login page, print sheet,
 *  and header company-brand mark read. */
export type BrandingPublicConfig = { client_name: string; logo_url: string; website: string };

/** Tenant-admin white-label branding settings (Branding page). The logo is
 *  written as a multipart upload; reads expose the resolved `logo_url`. */
export type BrandingConfig = {
  id: string | null;
  client_name: string;
  /** Absolute URL of the uploaded logo, or "" when none is set. */
  logo_url: string;
  address: string;
  website: string;
  email: string;
  updated_at: string | null;
};

export type CreateRoleInput = {
  code: string;
  name: string;
  description?: string;
  is_active?: boolean;
};

/** One row of the bulk PUT /roles/{id}/permissions/ body. */
export type SetRolePermissionInput = {
  module: string;
  can_read?: boolean;
  can_create?: boolean;
  can_update?: boolean;
  can_delete?: boolean;
};

// ── Email channel (mailbox → tickets; outbound via mailbox SMTP) ──────────────
export type EmailProtocol = "imap" | "pop3";
export type EmailAuthMethod = "basic" | "oauth_google" | "oauth_microsoft";
export type SmtpSecurity = "starttls" | "ssl" | "none";
export type ReopenPolicy = "comment_only" | "reopen" | "new_ticket";
export type TicketPriority = "p1" | "p2" | "p3" | "p4";

export type EmailFieldMappings = {
  subject: { label: string; target: string; editable: boolean };
  body: { label: string; target: string; editable: boolean };
  sender: { label: string; target: string; editable: boolean; create_if_missing: boolean; default_requestor: number | null };
  cc: { label: string; target: string; editable: boolean; enabled: boolean };
  attachments: { label: string; target: string; editable: boolean; max_attachment_bytes: number };
  priority: { label: string; target: string; editable: boolean; map: Record<string, string>; default: TicketPriority };
};

export type RoutingMatchIn = "subject" | "body" | "subject_body";
export type RoutingMatchType = "any" | "all";

/** Keyword → project routing rule for a shared mailbox. Project-only: a rule picks the
 *  target project; group/priority stay at the mailbox level. First match (by `order`) wins. */
export type EmailRoutingRule = {
  id: string;
  channel: string;
  order: number;
  name: string;
  match_in: RoutingMatchIn;
  match_type: RoutingMatchType;
  keywords: string[];
  target_project: string;
  target_project_name?: string;
  is_active: boolean;
  created_at: string;
};

export type EmailRoutingRuleInput = {
  channel: string;
  order?: number;
  name?: string;
  match_in?: RoutingMatchIn;
  match_type?: RoutingMatchType;
  keywords: string[];
  target_project: string;
  is_active?: boolean;
};

export type EmailChannel = {
  id: string;
  name: string;
  project: string | null; // the DEFAULT project (unmatched mail lands here); must be in allowed_projects
  // allowed_projects = the whitelist (only projects this mailbox may create/serve tickets in);
  // routing_rules route matching mail among them. Read+write (list of project ids).
  routing_rules: EmailRoutingRule[];
  allowed_projects: string[];
  address: string;
  domain: string;
  effective_domain: string;
  is_active: boolean;

  // inbound connection
  protocol: EmailProtocol;
  host: string;
  port: number;
  use_ssl: boolean;
  username: string;
  folder: string;
  auth_method: EmailAuthMethod;
  is_oauth: boolean;
  oauth_authorized: boolean;
  // per-org OAuth app (each org registers its own Azure/Google app)
  oauth_client_id: string;
  oauth_tenant_id: string; // Microsoft only
  oauth_client_secret?: string; // write-only
  has_oauth_client_secret: boolean;
  has_password: boolean;
  password?: string; // write-only

  // outbound SMTP
  outbound_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_security: SmtpSecurity;
  smtp_username: string;
  smtp_password?: string; // write-only
  has_smtp_password: boolean;
  smtp_from_name: string;

  // auto-detected outbound send capability (null = never probed)
  outbound_send_verified: boolean | null;
  outbound_verified_at: string | null;
  outbound_verify_error: string;

  // mappings
  create_users: boolean;
  default_requestor: number | string | null;
  /** Read-only display brief of the default requestor (picker label). */
  default_requestor_detail?: UserRef | null;
  default_priority: TicketPriority;
  priority_map: Record<string, string>;
  default_group: string | null;
  max_attachment_bytes: number;
  field_mappings: EmailFieldMappings;

  // processing
  strip_quotes: boolean;
  strip_signatures: boolean;
  signature_markers: string[];
  cc_watchers: boolean;
  reopen_policy: ReopenPolicy;
  reopen_window_days: number;
  ignore_auto_replies: boolean;
  max_age_days: number;
  max_size_bytes: number;
  loop_window_min: number;
  loop_max_messages: number;
  poll_interval_seconds: number | null;

  /** Ingest floor: only mail that arrived at/after this moment becomes tickets. */
  connected_at: string;
  last_polled_at: string | null;
  last_seen_uid: string | null;
  last_error: string | null;
  created_at: string;
};

// ── Per-helpdesk outbound notification transport (system default vs custom) ────
export type TransportMode = "system" | "custom";

/** How a workspace's NOTIFICATION emails are sent. `system` = the platform SMTP
 *  relays them (recipients see the helpdesk From name over the platform address,
 *  Reply-To = the org address). `custom` = the org's own SMTP or Microsoft 365.
 *  Secrets are write-only; `send_verified` is auto-detected (null = never probed). */
export type HelpdeskEmailTransport = {
  id: string;
  helpdesk: string;
  mode: TransportMode;
  address: string;
  smtp_from_name: string;
  auth_method: EmailAuthMethod; // "basic" (SMTP) | "oauth_microsoft" (M365)
  is_oauth: boolean;
  outbound_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_security: SmtpSecurity;
  smtp_username: string;
  smtp_password?: string; // write-only
  has_smtp_password: boolean;
  oauth_client_id: string;
  oauth_tenant_id: string; // Microsoft only
  oauth_client_secret?: string; // write-only
  has_oauth_client_secret: boolean;
  oauth_authorized: boolean;
  send_verified: boolean | null; // null = unknown / never probed (treated as usable)
  verified_at: string | null;
  verify_error: string;
  created_at: string;
};

export type EmailRule = {
  id: string;
  channel: string | null;
  rule_type: "block" | "allow";
  pattern: string;
  is_active: boolean;
  note: string;
  created_at: string;
};

export type InboundStatus = "received" | "processed" | "ignored" | "failed";

export type InboundEmail = {
  id: string;
  channel: string | null;
  from_addr: string;
  from_name: string;
  subject: string;
  status: InboundStatus;
  ignore_reason: string;
  action_taken: "created_ticket" | "added_comment" | "";
  ticket: string | null;
  ticket_number: string | null;
  matched_rule: string | null; // routing rule that picked the project (null = fallback)
  matched_rule_name: string | null;
  attempts: number;
  created_at: string;
  processed_at: string | null;
};

export type InboundEmailDetail = InboundEmail & {
  message_id: string;
  in_reply_to: string;
  references: string[];
  to_addrs: string[];
  cc_addrs: string[];
  date_header: string | null;
  size_bytes: number;
  headers: Record<string, unknown>;
  body_text: string;
  comment: string | null;
  requestor: number | null;
  last_error: string | null;
  next_attempt_at: string | null;
};

export type EmailTestResult = { ok: boolean; detail: string };
export type EmailPollResult = { channel?: string; processed: number; failed: number; error?: string | null };
export type EmailOauthStart = { authorize_url: string };

// ---- admin & security audit log (itsm_core AdminAuditEvent, G8) -----------

/** One changed field. `old`/`new` are display values; secrets arrive as "[redacted]". */
export type AuditChange = {
  field: string;
  label: string;
  old: unknown;
  new: unknown;
  redacted?: boolean;
};

export type AdminAuditEvent = {
  id: string;
  created_at: string;
  /** User id, or null for failed sign-ins and platform-console actions. */
  actor: string | null;
  actor_name: string;
  /** Username at the time (the *attempted* one for a failed sign-in). */
  actor_label: string;
  action: string;
  action_label: string;
  area: string;
  area_label: string;
  object_type: string;
  object_id: string;
  object_repr: string;
  changes: AuditChange[];
  extra: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string;
};

export type AuditFacetOption = { value: string; label: string };

export type AuditFacets = {
  areas: AuditFacetOption[];
  actions: AuditFacetOption[];
  actors: AuditFacetOption[];
  export_max_rows: number;
};

export type AuditLogFilters = {
  date_from?: string;
  date_to?: string;
  actor?: string;
  area?: string;
  action?: string;
  q?: string;
};
