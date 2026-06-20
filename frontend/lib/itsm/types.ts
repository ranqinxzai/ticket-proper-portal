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
