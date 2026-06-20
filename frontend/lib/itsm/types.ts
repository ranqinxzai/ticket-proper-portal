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
export type UserRef = { id: string; username: string; full_name: string };

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
  default_workflow?: string | null;
  ticket_types: TicketType[];
  open_ticket_count?: number | null;
};

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
  assigned_group: string | null;
  assigned_group_name: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type TicketDetail = TicketListItem & {
  description_html: string;
  description_text?: string;
  requestor: UserRef | null;
  created_by: UserRef | null;
  workflow: string;
  workflow_name: string;
  impact?: string;
  urgency?: string;
  resolution?: string;
  source?: string;
  first_responded_at?: string | null;
  assigned_at?: string | null;
  closed_at?: string | null;
  reopen_count?: number;
  custom_fields?: Record<string, unknown>;
};

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
};

export type CommentVisibility = "public" | "private";

export type TicketComment = {
  id: string;
  ticket: string;
  author: UserRef | null;
  visibility: CommentVisibility;
  body_html: string;
  body_text?: string;
  edited_at: string | null;
  created_at: string;
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
  source?: string;
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
  helpdesk_key?: string | null;
};

export type ArticleListItem = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  category: string | null;
  category_name?: string | null;
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
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
};

export type PortalComment = {
  id: string;
  author_name?: string | null;
  body_html: string;
  created_at: string;
};

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
};

export type BusinessCalendar = {
  id: string;
  name: string;
  timezone: string;
  is_default: boolean;
  hours: { weekday: number; start_time: string; end_time: string }[];
  holidays: { date: string; name: string }[];
};

export type ReportResult = { report: string; data: unknown };
