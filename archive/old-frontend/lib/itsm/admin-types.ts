/** Types for the admin builder UIs (workflows, fields, SLA, notifications, dashboards). */

// ---- workflows ------------------------------------------------------------

export type WfStatus = {
  id: string;
  workflow: string;
  name: string;
  key: string;
  category: string;
  category_key: "todo" | "in_progress" | "done";
  category_name?: string;
  color: string;
  sort_order: number;
  is_initial: boolean;
  canvas_x: number;
  canvas_y: number;
};

export type WfTransition = {
  id: string;
  workflow: string;
  name: string;
  from_status: string | null;
  from_status_key?: string | null;
  to_status: string;
  to_status_key?: string;
  is_global: boolean;
  sort_order: number;
  post_functions: { type: string; config: Record<string, unknown> }[];
};

export type WorkflowSummary = {
  id: string;
  name: string;
  description?: string;
  base_type: string;
  is_default: boolean;
  is_active: boolean;
  version: number;
  status_count?: number;
};

export type WorkflowGraph = WorkflowSummary & {
  statuses: WfStatus[];
  transitions: WfTransition[];
};

export type StatusCategoryRow = { id: string; key: string; name: string; color: string };
export type GraphValidation = { valid: boolean; errors: string[]; warnings: string[] };

// ---- fields ---------------------------------------------------------------

export type FieldDefinition = {
  id: string;
  project: string | null;
  key: string;
  name: string;
  description?: string;
  field_type: string;
  is_system: boolean;
  is_multi: boolean;
  config?: Record<string, unknown>;
  options?: { id: string; value: string; label: string; color?: string; sort_order?: number }[];
};

export type FieldLayoutItem = {
  id: string;
  layout: string;
  field: string;
  field_key: string;
  field_name: string;
  field_type: string;
  sort_order: number;
  is_hidden: boolean;
  is_mandatory: boolean;
  section: string;
  visibility_rule?: Record<string, unknown> | null;
};

export type FieldLayoutFull = {
  id: string;
  project: string;
  ticket_type: string | null;
  name: string;
  items: FieldLayoutItem[];
};

export type TicketTypeRow = { id: string; project: string; name: string; key: string; base_category: string };

// ---- SLA ------------------------------------------------------------------

export type SlaTarget = { id?: string; metric?: string; priority: string; target_minutes: number };
export type SlaEscalation = { id?: string; metric?: string; threshold_pct: number; action: string; config?: Record<string, unknown> };
export type SlaMetric = {
  id: string;
  policy: string;
  kind: string;
  name: string;
  pause_statuses: string[];
  targets: SlaTarget[];
  escalations: SlaEscalation[];
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
  metrics: SlaMetric[];
};
export type BusinessHourRow = { id?: string; calendar?: string; weekday: number; start_time: string; end_time: string };
export type HolidayRow = { id?: string; calendar?: string; date: string; name: string; recurring_annually?: boolean };
export type BusinessCalendar = {
  id: string;
  name: string;
  timezone: string;
  is_default: boolean;
  hours: BusinessHourRow[];
  holidays: HolidayRow[];
};

// ---- notifications --------------------------------------------------------

export type NotificationRuleRow = {
  id: string;
  scheme: string;
  event_type: string;
  recipients: string[];
  channels: string[];
  email_template: string | null;
  notify_actor: boolean;
  is_active: boolean;
};
export type NotificationSchemeRow = {
  id: string;
  name: string;
  description?: string;
  project: string | null;
  is_default: boolean;
  rules: NotificationRuleRow[];
};
export type EmailTemplateRow = {
  id: string;
  name: string;
  event_type: string;
  subject_template: string;
  body_html_template: string;
  body_text_template: string;
  is_system: boolean;
};

// ---- dashboards -----------------------------------------------------------

export type WidgetType = "kpi" | "pie" | "bar" | "trend" | "sla" | "ticket_list";
export type Widget = {
  id: string;
  dashboard: string;
  widget_type: WidgetType;
  title: string;
  saved_filter: string | null;
  config: Record<string, unknown>;
  sort_order: number;
  position: Record<string, unknown>;
};
export type Dashboard = {
  id: string;
  name: string;
  owner?: string | number | null;
  is_shared: boolean;
  layout: unknown[];
  widgets: Widget[];
};
export type WidgetData = {
  type: string;
  value?: number | string | null;
  label?: string;
  series?: { label: string; value: number; color?: string }[];
  created?: { date: string; value: number }[];
  resolved?: { date: string; value: number }[];
  tickets?: unknown[];
  total?: number;
  met?: number;
  breached?: number;
  compliance_pct?: number | null;
};

// ---- recipient / event vocab (for the notification editor) ----------------

export const NOTIF_EVENTS = [
  "TicketCreated", "TicketUpdated", "StatusChanged", "Assigned", "CommentAdded",
  "CommentAddedPrivate", "Mentioned", "Resolved", "Closed", "SLAWarning", "SLABreach",
] as const;

export const NOTIF_RECIPIENTS = [
  "requestor", "assignee", "assigned_group", "group_lead", "watchers", "mentioned",
] as const;

export const NOTIF_CHANNELS = ["in_app", "email"] as const;
export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---- email channels -------------------------------------------------------

export const EMAIL_PROTOCOLS = ["imap", "pop3"] as const;
export const EMAIL_AUTH_METHODS = ["basic", "oauth_google", "oauth_microsoft"] as const;
export const REOPEN_POLICIES = ["comment_only", "reopen", "new_ticket"] as const;
export const INBOUND_STATUSES = ["received", "processed", "ignored", "failed"] as const;

export type EmailProtocol = (typeof EMAIL_PROTOCOLS)[number];
export type EmailAuthMethod = (typeof EMAIL_AUTH_METHODS)[number];
export type ReopenPolicy = (typeof REOPEN_POLICIES)[number];
export type InboundStatus = (typeof INBOUND_STATUSES)[number];

export type EmailChannel = {
  id: string;
  name: string;
  project: string | null;
  address: string;
  domain: string;
  effective_domain: string;
  is_active: boolean;

  protocol: EmailProtocol;
  host: string;
  port: number;
  use_ssl: boolean;
  username: string;
  folder: string;

  auth_method: EmailAuthMethod;
  is_oauth: boolean;
  oauth_authorized: boolean;
  has_password: boolean;
  /** Write-only; never returned by the API. */
  password?: string;

  create_users: boolean;
  default_requestor: string | null;
  default_priority: "critical" | "high" | "medium" | "low";
  default_group: string | null;

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
  in_reply_to: string | null;
  references: string[];
  to_addrs: string[];
  cc_addrs: string[];
  date_header: string | null;
  size_bytes: number;
  headers: Record<string, unknown>;
  body_text: string;
  comment: string;
  requestor: string | null;
  last_error: string | null;
  next_attempt_at: string | null;
};

// Action response shapes.
export type EmailTestResult = { ok: boolean; detail: string };
export type EmailPollResult = { channel?: string; processed: number; failed: number; error?: string | null };
export type EmailOauthStart = { authorize_url: string };
