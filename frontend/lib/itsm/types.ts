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
  member_count?: number;
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
};

export type LoginResponse = { access: string; refresh: string; user: ItsmUser };

/** Lightweight user reference embedded in ticket payloads. */
export type UserRef = { id: string; username: string; full_name: string; email?: string; first_name?: string; last_name?: string };

// ---- projects -------------------------------------------------------------

export type ProjectType = "incident" | "service_request" | "custom";
export type StatusCategory = "todo" | "in_progress" | "done";
export type Priority = "critical" | "high" | "medium" | "low";

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
};

/** Compact SLA payload returned per ticket in the list endpoint (one per metric). */
export type QueueSlaEntry = {
  state: string;
  due_at: string;
  started_at: string;
  target_minutes: number;
  breached: boolean;
  paused: boolean;
  rag: RagState;
};

export type QueueSla = {
  first_response: QueueSlaEntry | null;
  resolution: QueueSlaEntry | null;
};

/** One populated custom user attribute of the ticket's requestor (detail-only). */
export type RequestorAttribute = { key: string; label: string; type: string; value: unknown };

export type TicketDetail = TicketListItem & {
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
  first_responded_at?: string | null;
  assigned_at?: string | null;
  closed_at?: string | null;
  reopen_count?: number;
  custom_fields?: Record<string, unknown>;
  requestor_attributes?: RequestorAttribute[];
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
  is_global: boolean;
  sort_order: number;
  note_prompt?: boolean;
  note_required?: boolean;
  note_heading?: string;
  note_visibility?: TransitionNoteVisibility;
  /** End-user Service Portal may invoke this transition (e.g. Reopen). */
  portal_allowed?: boolean;
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
};

/** Inline detail-view edits. User/group FKs accept a pk string or null (to clear). */
export type UpdateTicketInput = Partial<{
  priority: Priority;
  summary: string;
  description_html: string;
  impact: string;
  urgency: string;
  requestor: string | null;
  assignee: string | null;
  assigned_group: string | null;
}>;

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
  decision: ApprovalDecision;
  comment: string;
  created_at: string;
};

export type ApprovalRequest = {
  id: string;
  ticket: string;
  ticket_number: string;
  ticket_summary: string;
  workflow_name: string;
  current_stage_name?: string | null;
  current_stage_level?: number | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decided_at?: string | null;
  actions: ApprovalAction[];
  created_at: string;
};

// ---- portal (requestor-scoped) --------------------------------------------

export type PortalTicket = {
  id: string;
  ticket_number: string;
  summary: string;
  description_html: string;
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
export type PortalTicketDetail = PortalTicket & {
  layout: { id: string | null; items: FieldLayoutItem[]; name?: string };
  fields: FieldDefinition[];
  field_values: Record<string, unknown>;
  /** File attachments on the request (view/download/upload from the portal). */
  attachments?: TicketAttachment[];
  /** Watchers (name only — the portal never exposes other users' emails). */
  watchers?: PortalWatcher[];
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
  rag: RagState;
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

export type NotificationMetaItem = { value: string; label: string };
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

export type OptionSource = "statuses" | "groups" | "users" | "ticket_types";

export type FilterFieldOption = { value: string; label: string; color?: string | null };

export type FilterFieldMeta = {
  key: string;
  label: string;
  type: FilterFieldType;
  operators: FilterOperator[];
  options?: FilterFieldOption[];
  options_source?: OptionSource;
  ordering_key?: string;
  group?: string;
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
  project: string | null;
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
};
export type UpdateHelpdeskInput = Partial<CreateHelpdeskInput>;

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
  | "attachment";

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

export type FieldLayout = {
  id: string;
  project: string;
  ticket_type: string | null;
  name: string;
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
};

export type WorkflowGraph = {
  id: string;
  name: string;
  description?: string;
  base_type: ProjectType;
  is_active: boolean;
  version: number;
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
};

export type WorkflowValidation = { valid: boolean; errors: string[]; warnings: string[] };

// ---- settings: approvals (admin) ------------------------------------------

export type ApproverType = "specific_user" | "role" | "group" | "requestor_manager";
export type ApprovalRule = "any" | "all";
export type ApprovalMode = "sequential" | "parallel";

export type ApprovalStage = {
  id: string;
  workflow: string;
  name: string;
  level: number;
  approver_type: ApproverType;
  approver_user: string | null;
  approver_role: string | null;
  approver_group: string | null;
  rule: ApprovalRule;
  min_approvals: number;
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
  /** Nested grant matrix, returned on GET /roles/ and /roles/{id}/. */
  permissions?: RolePermissionRow[];
};

/** A node in the permission tree (GET /itsm/modules/, a bare array). */
export type ItsmModule = {
  id: string;
  code: string;
  name: string;
  description?: string;
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
export type TicketPriority = "critical" | "high" | "medium" | "low";

export type EmailFieldMappings = {
  subject: { label: string; target: string; editable: boolean };
  body: { label: string; target: string; editable: boolean };
  sender: { label: string; target: string; editable: boolean; create_if_missing: boolean; default_requestor: number | null };
  cc: { label: string; target: string; editable: boolean; enabled: boolean };
  attachments: { label: string; target: string; editable: boolean; max_attachment_bytes: number };
  priority: { label: string; target: string; editable: boolean; map: Record<string, string>; default: TicketPriority };
};

export type EmailChannel = {
  id: string;
  name: string;
  project: string | null;
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

  // mappings
  create_users: boolean;
  default_requestor: number | null;
  default_priority: TicketPriority;
  priority_map: Record<string, string>;
  default_group: string | null;
  max_attachment_bytes: number;
  field_mappings: EmailFieldMappings;

  // processing
  strip_quotes: boolean;
  cc_watchers: boolean;
  reopen_policy: ReopenPolicy;
  reopen_window_days: number;
  ignore_auto_replies: boolean;
  max_age_days: number;
  max_size_bytes: number;
  loop_window_min: number;
  loop_max_messages: number;
  poll_interval_seconds: number | null;

  last_polled_at: string | null;
  last_seen_uid: string | null;
  last_error: string | null;
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
