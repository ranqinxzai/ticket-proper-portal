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

/** A workspace/department the agent can access (drives the Home selector). */
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
  /** Helpdesks this user may access (server-derived; superusers get all). */
  helpdesks?: Helpdesk[];
};

export type LoginResponse = {
  access: string;
  refresh: string;
  user: ItsmUser;
};

/** Lightweight user reference used inside ticket payloads. */
export type UserRef = {
  id: string | number;
  username: string;
  full_name: string;
};

/** Account row from the (non-itsm) /users/ endpoint. */
export type AccountUser = {
  id: string | number;
  username: string;
  full_name?: string;
  email?: string;
};

// ---- catalogue ------------------------------------------------------------

export type TicketType = {
  id: string;
  name: string;
  key?: string;
  icon?: string;
};

export type ProjectType = "incident" | "service_request" | "custom";

export type Project = {
  id: string;
  key: string;
  name: string;
  project_type?: ProjectType;
  helpdesk?: string;
  helpdesk_key?: string;
  helpdesk_name?: string;
  color?: string;
  icon?: string;
  ticket_types?: TicketType[];
  default_workflow?: string | null;
};

export type Group = {
  id: string;
  name: string;
};

export type StatusCategory = "todo" | "in_progress" | "done";
export type Priority = "critical" | "high" | "medium" | "low";

// ---- tickets --------------------------------------------------------------

export type TicketListItem = {
  id: string;
  ticket_number: string;
  project_key: string;
  summary: string;
  status_name: string;
  status_category: StatusCategory;
  status_color: string | null;
  priority: Priority;
  assignee: UserRef | null;
  assigned_group_name: string | null;
  ticket_type_name: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

export type TicketDetail = TicketListItem & {
  project: string;
  ticket_type: string;
  description_html: string;
  description_text?: string;
  requestor: UserRef | null;
  created_by?: UserRef | null;
  workflow?: string;
  workflow_name?: string;
  status: string;
  assigned_group: string | null;
  impact?: string | null;
  urgency?: string | null;
  resolution?: string | null;
  source?: string;
  custom_fields?: Record<string, unknown>;
  first_responded_at?: string | null;
  assigned_at?: string | null;
  closed_at?: string | null;
  resolved_at?: string | null;
  reopen_count?: number;
};

export type Transition = {
  id: string;
  name: string;
  to_status_key: string;
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
  actor: UserRef | null;
  actor_name?: string;
  action: string;
  verb?: string;
  summary?: string;
  field?: string | null;
  from_value?: string | null;
  to_value?: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
};

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

export type Watcher = {
  id: string;
  user: UserRef;
};

// ---- fields / layouts -----------------------------------------------------

export type FieldType =
  | "text"
  | "textarea"
  | "multiline"
  | "number"
  | "date"
  | "datetime"
  | "dropdown"
  | "select"
  | "multiselect"
  | "checkbox"
  | "boolean"
  | "user"
  | "group";

export type LayoutField = {
  field_key: string;
  field_name: string;
  field_type: FieldType;
  is_mandatory: boolean;
  is_hidden: boolean;
  section?: string | null;
  options?: { value: string; label: string }[] | string[];
  help_text?: string | null;
  default_value?: unknown;
};

export type FieldLayout = { items: LayoutField[] };

// ---- canned notes / templates --------------------------------------------

export type CannedNote = {
  id: string;
  title: string;
  body_html: string;
  category?: string | null;
};

export type TicketTemplate = {
  id: string;
  name: string;
  project?: string;
  ticket_type?: string;
  description?: string | null;
};

// ---- saved filters / notifications ---------------------------------------

export type SavedFilter = {
  id: string;
  name: string;
  query_spec?: Record<string, unknown>;
  is_shared?: boolean;
};

// Matches itsm_notifications.InAppNotificationSerializer exactly.
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

export type UnreadCount = { unread: number };
