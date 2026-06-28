/** Typed API helpers for the ITSM platform. */

import { itsmClient, pickResults, qs } from "./client";
import type {
  ActivityEvent,
  Article,
  ArticleInput,
  ArticleListItem,
  ApprovalRequest,
  ApprovalStage,
  ApprovalWorkflow,
  BusinessCalendar,
  BusinessHours,
  Paginated,
  CannedNote,
  CannedNoteCategory,
  CatalogCategory,
  CatalogItem,
  CommentAttachment,
  CommentAttachmentKind,
  CreateCalendarInput,
  CreateCannedNoteInput,
  CreateCannedNoteCategoryInput,
  CreateGroupInput,
  CreateHelpdeskInput,
  CreateProjectInput,
  CreateRoleInput,
  CreateTicketInput,
  CreateUserInput,
  EmailChannel,
  EmailOauthStart,
  EmailPollResult,
  EmailRule,
  EmailTestResult,
  InboundEmail,
  InboundEmailDetail,
  FieldDefinition,
  FilterFieldsResponse,
  FieldLayout,
  FieldLayoutItem,
  FieldOption,
  Group,
  GroupMembership,
  Helpdesk,
  HelpdeskMembership,
  Holiday,
  ItsmModule,
  ItsmUser,
  KBCategory,
  KBCategoryInput,
  LoginResponse,
  Member,
  ProjectMembership,
  RoleInHelpdesk,
  SetRolePermissionInput,
  EmailTemplate,
  Notification,
  NotificationMeta,
  NotificationRule,
  NotificationScheme,
  PortalComment,
  PortalTicket,
  PortalTicketDetail,
  PortalTransition,
  PortalWatcher,
  Project,
  ReportResult,
  RoutingRule,
  RoutingRuleInput,
  SavedFilter,
  SavedFilterInput,
  SlaEntry,
  SlaPolicy,
  SlaMetricConfig,
  SlaTarget,
  SystemRole,
  TicketAttachment,
  TicketComment,
  TicketDetail,
  TicketListItem,
  Transition,
  Watcher,
  UpdateCannedNoteInput,
  UpdateHelpdeskInput,
  UpdateProjectInput,
  UpdateTicketInput,
  UserRef,
  Workflow,
  WorkflowGraph,
  WorkflowStatus,
  WorkflowStatusCategory,
  WorkflowTransition,
  WorkflowValidation,
} from "./types";

export const authApi = {
  login: (username: string, password: string) =>
    itsmClient.post<LoginResponse>("/auth/login/", { username, password }, { anon: true }),
  me: () => itsmClient.get<ItsmUser>("/auth/me/"),
};

export const helpdesksApi = {
  list: async (): Promise<Helpdesk[]> => pickResults<Helpdesk>(await itsmClient.get("/helpdesks/")),
  get: (id: string) => itsmClient.get<Helpdesk>(`/helpdesks/${id}/`),
  create: (body: CreateHelpdeskInput) => itsmClient.post<Helpdesk>("/helpdesks/", body),
  update: (id: string, body: UpdateHelpdeskInput) =>
    itsmClient.patch<Helpdesk>(`/helpdesks/${id}/`, body),
  reorder: (ids: string[]) => itsmClient.post("/helpdesks/reorder/", { order: ids }),
  members: (id: string) =>
    itsmClient.get<HelpdeskMembership[]>(`/helpdesks/${id}/members/`),
  // Idempotent (update_or_create on helpdesk+user); call again with a new
  // role_in_helpdesk to switch a member between member/lead.
  addMember: (id: string, body: { user: string | number; role_in_helpdesk?: RoleInHelpdesk }) =>
    itsmClient.post<HelpdeskMembership>(`/helpdesks/${id}/add_member/`, body),
  removeMember: (id: string, user: string | number) =>
    itsmClient.post<void>(`/helpdesks/${id}/remove_member/`, { user }),
};

export const projectsApi = {
  list: async (params: { helpdesk?: string } = {}): Promise<Project[]> =>
    pickResults<Project>(await itsmClient.get(`/projects/${qs(params)}`)),
  get: (id: string) => itsmClient.get<Project>(`/projects/${id}/`),
  create: (body: CreateProjectInput) => itsmClient.post<Project>("/projects/", body),
  update: (id: string, body: UpdateProjectInput) =>
    itsmClient.patch<Project>(`/projects/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/projects/${id}/`),
  // Per-user project access (assigned from User Management). Idempotent upsert.
  addMember: (id: string, user: string | number) =>
    itsmClient.post<ProjectMembership>(`/projects/${id}/add_member/`, { user }),
  removeMember: (id: string, user: string | number) =>
    itsmClient.post<void>(`/projects/${id}/remove_member/`, { user }),
  memberships: async (params: { user?: string | number; project?: string } = {}): Promise<ProjectMembership[]> =>
    pickResults<ProjectMembership>(await itsmClient.get(`/project-memberships/${qs(params)}`)),
};

export const cannedNotesApi = {
  list: async (
    params: { scope?: string; helpdesk?: string; project?: string; category?: string; search?: string } = {},
  ): Promise<CannedNote[]> =>
    pickResults<CannedNote>(await itsmClient.get(`/canned-notes/${qs(params)}`)),
  get: (id: string) => itsmClient.get<CannedNote>(`/canned-notes/${id}/`),
  create: (body: CreateCannedNoteInput) => itsmClient.post<CannedNote>("/canned-notes/", body),
  update: (id: string, body: UpdateCannedNoteInput) =>
    itsmClient.patch<CannedNote>(`/canned-notes/${id}/`, body),
  remove: (id: string) => itsmClient.del<void>(`/canned-notes/${id}/`),
  use: (id: string) => itsmClient.post<{ ok: true }>(`/canned-notes/${id}/use/`, {}),
};

export const cannedNoteCategoriesApi = {
  list: async (): Promise<CannedNoteCategory[]> =>
    pickResults<CannedNoteCategory>(await itsmClient.get("/canned-note-categories/")),
  create: (body: CreateCannedNoteCategoryInput) =>
    itsmClient.post<CannedNoteCategory>("/canned-note-categories/", body),
  update: (id: string, body: Partial<CreateCannedNoteCategoryInput>) =>
    itsmClient.patch<CannedNoteCategory>(`/canned-note-categories/${id}/`, body),
  remove: (id: string) => itsmClient.del<void>(`/canned-note-categories/${id}/`),
};

export const usersApi = {
  search: async (search: string): Promise<UserRef[]> =>
    pickResults<UserRef>(await itsmClient.get(`/users/${qs({ search, page_size: 25 })}`, { itsm: false })),
};

export type TicketListParams = {
  project?: string;
  status?: string;
  priority?: string;
  search?: string;
  ordering?: string;
  /** URL-encoded JSON of the operator-based filter spec ({match, conditions}). */
  q?: string;
  page?: number;
  page_size?: number;
};

export const ticketsApi = {
  list: async (params: TicketListParams = {}): Promise<TicketListItem[]> =>
    pickResults<TicketListItem>(await itsmClient.get(`/tickets/${qs(params)}`)),
  /** Paginated variant — keeps `count`/`next`/`previous` for queue paging. */
  listPaged: (params: TicketListParams = {}): Promise<Paginated<TicketListItem>> =>
    itsmClient.get<Paginated<TicketListItem>>(`/tickets/${qs(params)}`),
  /** Filterable field registry + built-in system views for the queue filter UI. */
  filterFields: (project: string) =>
    itsmClient.get<FilterFieldsResponse>(`/tickets/filter-fields/${qs({ project })}`),
  get: (id: string) => itsmClient.get<TicketDetail>(`/tickets/${id}/`),
  create: (body: CreateTicketInput) => itsmClient.post<TicketDetail>("/tickets/", body),
  /** Inline detail-view edits of the standard (column-backed) fields
   *  (priority/assignee/group/requestor/summary/description). Routes through the
   *  server's single write site (audit log + Assigned hook + HTML sanitise). */
  update: (id: string, body: UpdateTicketInput) =>
    itsmClient.patch<TicketDetail>(`/tickets/${id}/`, body),
  /** Inline detail-view edits of custom (value-backed) fields → field engine. */
  setFields: (id: string, custom_fields: Record<string, unknown>) =>
    itsmClient.post<TicketDetail>(`/tickets/${id}/set-fields/`, { custom_fields }),
  availableTransitions: (id: string) =>
    itsmClient.get<Transition[]>(`/tickets/${id}/available-transitions/`),
  transition: (id: string, body: { transition_id: string; comment?: string; comment_visibility?: string }) =>
    itsmClient.post<TicketDetail>(`/tickets/${id}/transition/`, body),
  comments: (id: string) => itsmClient.get<TicketComment[]>(`/tickets/${id}/comments/`),
  addComment: (
    id: string,
    body: { body_html: string; visibility?: string; attachment_ids?: string[] },
  ) => itsmClient.post<TicketComment>(`/tickets/${id}/comments/`, body),
  activity: (id: string) => itsmClient.get<ActivityEvent[]>(`/tickets/${id}/activity/`),
  /** Watchers on a ticket (`id` is the UUID pk). */
  watchers: (id: string) => itsmClient.get<Watcher[]>(`/tickets/${id}/watchers/`),
  /** Add the current user as a watcher (self-toggle). */
  watch: (id: string) => itsmClient.post<void>(`/tickets/${id}/watch/`, {}),
  /** Remove the current user as a watcher (self-toggle). */
  unwatch: (id: string) => itsmClient.del<void>(`/tickets/${id}/watch/`),
};

/** Add/remove an ARBITRARY user as a watcher (agent). `remove` keys off the
 *  watcher row id (from `ticketsApi.watchers`), since the agent client `del()`
 *  has no body and `/watch/` only toggles self. Module: itsm.tickets.watchers. */
export const watchersApi = {
  add: (ticket: string, user: string | number) =>
    itsmClient.post<Watcher>("/watchers/", { ticket, user_id: user }),
  remove: (watcherId: string) => itsmClient.del<void>(`/watchers/${watcherId}/`),
};

export const ticketAttachmentsApi = {
  // `ticket` is the UUID pk (`t.id`), NOT the readable number — see the FK gotcha.
  list: async (ticket: string) =>
    pickResults<TicketAttachment>(await itsmClient.get(`/ticket-attachments/${qs({ ticket })}`)),
  upload: (ticket: string, file: File) => {
    const fd = new FormData();
    fd.append("ticket", ticket);
    fd.append("file", file);
    return itsmClient.upload<TicketAttachment>("/ticket-attachments/", fd);
  },
  remove: (id: string) => itsmClient.del<void>(`/ticket-attachments/${id}/`),
};

// Comment composer attachments: uploaded *before* the reply is posted (the editor
// needs a URL to embed an inline image or show a file chip), then associated via
// `addComment({ attachment_ids })`. `kind="image"` is embedded in the body;
// `kind="file"` is listed under the comment.
export const commentAttachmentsApi = {
  upload: (ticket: string, file: File, kind: CommentAttachmentKind) => {
    const fd = new FormData();
    fd.append("ticket", ticket);
    fd.append("kind", kind);
    fd.append("file", file);
    return itsmClient.upload<CommentAttachment>("/comment-attachments/", fd);
  },
};

export const catalogApi = {
  browse: async (): Promise<CatalogItem[]> => pickResults<CatalogItem>(await itsmClient.get("/catalog/")),
  categories: () => itsmClient.get<CatalogCategory[]>("/catalog/categories/"),
  get: (id: string) => itsmClient.get<CatalogItem>(`/catalog/${id}/`),
  raise: (id: string, body: { summary?: string; field_values?: Record<string, unknown> }) =>
    itsmClient.post<TicketDetail>(`/catalog/${id}/raise/`, body),
};

export const kbApi = {
  browse: async (params: { search?: string; category?: string } = {}): Promise<ArticleListItem[]> =>
    pickResults<ArticleListItem>(await itsmClient.get(`/kb/${qs(params)}`)),
  categories: () => itsmClient.get<KBCategory[]>("/kb/categories/"),
  get: (id: string) => itsmClient.get<Article>(`/kb/${id}/`),

  // ── authoring (admin/agent/lead): /kb-articles/ + /kb-categories/ ──────────
  listArticles: async (
    params: { helpdesk?: string; status?: string; visibility?: string; category?: string; search?: string } = {},
  ): Promise<ArticleListItem[]> =>
    pickResults<ArticleListItem>(await itsmClient.get(`/kb-articles/${qs(params)}`)),
  getArticle: (id: string) => itsmClient.get<Article>(`/kb-articles/${id}/`),
  createArticle: (body: ArticleInput) => itsmClient.post<Article>("/kb-articles/", body),
  updateArticle: (id: string, body: Partial<ArticleInput>) =>
    itsmClient.patch<Article>(`/kb-articles/${id}/`, body),
  deleteArticle: (id: string) => itsmClient.del<void>(`/kb-articles/${id}/`),
  publish: (id: string) => itsmClient.post<Article>(`/kb-articles/${id}/publish/`, {}),
  unpublish: (id: string) => itsmClient.post<Article>(`/kb-articles/${id}/unpublish/`, {}),

  listCategories: async (params: { helpdesk?: string; parent?: string } = {}): Promise<KBCategory[]> =>
    pickResults<KBCategory>(await itsmClient.get(`/kb-categories/${qs(params)}`)),
  createCategory: (body: KBCategoryInput) => itsmClient.post<KBCategory>("/kb-categories/", body),
  updateCategory: (id: string, body: Partial<KBCategoryInput>) =>
    itsmClient.patch<KBCategory>(`/kb-categories/${id}/`, body),
  deleteCategory: (id: string) => itsmClient.del<void>(`/kb-categories/${id}/`),
};

export const approvalsApi = {
  myPending: () => itsmClient.get<ApprovalRequest[]>("/approval-requests/my-pending/"),
  forTicket: async (ticketId: string): Promise<ApprovalRequest[]> =>
    pickResults<ApprovalRequest>(await itsmClient.get(`/approval-requests/${qs({ ticket: ticketId })}`)),
  approve: (id: string, comment = "") =>
    itsmClient.post<ApprovalRequest>(`/approval-requests/${id}/approve/`, { comment }),
  reject: (id: string, comment = "") =>
    itsmClient.post<ApprovalRequest>(`/approval-requests/${id}/reject/`, { comment }),
};

export const portalApi = {
  requests: async (): Promise<PortalTicket[]> =>
    pickResults<PortalTicket>(await itsmClient.get("/portal/requests/")),
  request: (id: string) => itsmClient.get<PortalTicketDetail>(`/portal/requests/${id}/`),
  comments: (id: string) => itsmClient.get<PortalComment[]>(`/portal/requests/${id}/comments/`),
  addComment: (id: string, body_html: string) =>
    itsmClient.post<PortalComment>(`/portal/requests/${id}/comments/`, { body_html }),

  // ── reopen / portal-allowed transitions (e.g. Reopen) ──────────────────────
  availableTransitions: (id: string) =>
    itsmClient.get<PortalTransition[]>(`/portal/requests/${id}/available-transitions/`),
  transition: (id: string, body: { transition_id: string; comment?: string }) =>
    itsmClient.post<PortalTicketDetail>(`/portal/requests/${id}/transition/`, body),

  // ── watchers (add/remove by email — requestors can't browse the directory).
  //    Remove is POST (not DELETE): requestors hold create, not delete, on the module.
  watchers: (id: string) => itsmClient.get<PortalWatcher[]>(`/portal/requests/${id}/watchers/`),
  addWatcher: (id: string, email: string) =>
    itsmClient.post<PortalWatcher>(`/portal/requests/${id}/watchers/`, { email }),
  removeWatcher: (id: string, watcherId: string) =>
    itsmClient.post<void>(`/portal/requests/${id}/watchers/remove/`, { watcher_id: watcherId }),

  // ── "Create Request" intake (end-user): workspaces → projects → layout → create.
  // All under /portal/request-intake/ (module itsm.portal.tickets — requestor-allowed).
  workspaces: async (): Promise<Helpdesk[]> =>
    pickResults<Helpdesk>(await itsmClient.get("/portal/request-intake/workspaces/")),
  intakeProjects: async (helpdesk: string): Promise<Project[]> =>
    pickResults<Project>(await itsmClient.get(`/portal/request-intake/projects/${qs({ helpdesk })}`)),
  resolveLayout: (project: string, ticketType?: string) =>
    itsmClient.get<{
      layout: { id: string | null; items: FieldLayoutItem[]; name?: string };
      fields: FieldDefinition[];
    }>(`/portal/request-intake/layout/${qs({ project, ticket_type: ticketType })}`),
  createRequest: (body: { helpdesk?: string; project: string; fields: Record<string, unknown> }) =>
    itsmClient.post<{ id: string; ticket_number: string }>("/portal/request-intake/", body),
  uploadRequestAttachment: (ticketNumber: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return itsmClient.upload<{ id: string }>(
      `/portal/request-intake/${encodeURIComponent(ticketNumber)}/attachments/`,
      fd,
    );
  },
};

export const slaApi = {
  forTicket: (id: string) => itsmClient.get<SlaEntry[]>(`/tickets/${id}/sla/`),
};

// SLA configuration (project settings → SLA tab). Policies bundle metrics
// (First Response / Resolution); each metric carries per-priority targets.
export const slaPoliciesApi = {
  list: async (params: { project?: string; is_active?: boolean } = {}): Promise<SlaPolicy[]> =>
    pickResults<SlaPolicy>(await itsmClient.get(`/sla-policies/${qs(params)}`)),
  get: (id: string) => itsmClient.get<SlaPolicy>(`/sla-policies/${id}/`),
  create: (body: Partial<SlaPolicy>) => itsmClient.post<SlaPolicy>("/sla-policies/", body),
  update: (id: string, body: Partial<SlaPolicy>) =>
    itsmClient.patch<SlaPolicy>(`/sla-policies/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/sla-policies/${id}/`),
};

export const slaMetricsApi = {
  create: (body: { policy: string; kind: string; name: string; pause_statuses?: string[] }) =>
    itsmClient.post<SlaMetricConfig>("/sla-metrics/", body),
  update: (id: string, body: Partial<{ name: string; pause_statuses: string[] }>) =>
    itsmClient.patch<SlaMetricConfig>(`/sla-metrics/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/sla-metrics/${id}/`),
};

export const slaTargetsApi = {
  create: (body: { metric: string; priority: string; target_minutes: number }) =>
    itsmClient.post<SlaTarget>("/sla-targets/", body),
  update: (id: string, body: { target_minutes: number }) =>
    itsmClient.patch<SlaTarget>(`/sla-targets/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/sla-targets/${id}/`),
};

// Per-user ticket-queue column layout. `get` returns the caller's saved columns
// for a project (or null when none set); `set` upserts them server-side.
export const queueColumnsApi = {
  get: async (project: string): Promise<string[] | null> => {
    const rows = pickResults<{ id: string; project: string; columns: string[] }>(
      await itsmClient.get(`/queue-columns/${qs({ project })}`),
    );
    return rows[0]?.columns ?? null;
  },
  set: (project: string, columns: string[]) =>
    itsmClient.post<{ id: string; project: string; columns: string[] }>("/queue-columns/", {
      project,
      columns,
    }),
};

// Per-user default queue view, per project. `get` returns the caller's chosen
// view key for a project (or null when none set); `set` upserts it server-side.
// A blank/empty key clears the personal default (falls back to project/product).
export const queueViewApi = {
  get: async (project: string): Promise<string | null> => {
    const rows = pickResults<{ id: string; project: string; view_key: string }>(
      await itsmClient.get(`/queue-view/${qs({ project })}`),
    );
    return rows[0]?.view_key ?? null;
  },
  set: (project: string, view_key: string) =>
    itsmClient.post<{ id: string; project: string; view_key: string }>("/queue-view/", {
      project,
      view_key,
    }),
};

export const notificationsApi = {
  list: async (): Promise<Notification[]> =>
    pickResults<Notification>(await itsmClient.get("/notifications/")),
  unreadCount: () => itsmClient.get<{ unread: number }>("/notifications/unread-count/"),
  markRead: (id: string) => itsmClient.post(`/notifications/${id}/read/`),
  markAllRead: () => itsmClient.post("/notifications/mark-all-read/"),
};

// Per-project notification configuration (Notifications settings tab). The scheme
// is auto-provisioned on first `forProject` access; `metadata` drives the matrix.
export const notificationSchemesApi = {
  metadata: () => itsmClient.get<NotificationMeta>("/notification-schemes/metadata/"),
  forProject: (project: string) =>
    itsmClient.get<NotificationScheme>(`/notification-schemes/for-project/${qs({ project })}`),
  list: async (params: { project?: string; is_default?: boolean } = {}): Promise<NotificationScheme[]> =>
    pickResults<NotificationScheme>(await itsmClient.get(`/notification-schemes/${qs(params)}`)),
};

export const notificationRulesApi = {
  update: (id: string, body: Partial<NotificationRule>) =>
    itsmClient.patch<NotificationRule>(`/notification-rules/${id}/`, body),
};

export const emailTemplatesApi = {
  get: (id: string) => itsmClient.get<EmailTemplate>(`/email-templates/${id}/`),
  update: (id: string, body: Partial<EmailTemplate>) =>
    itsmClient.patch<EmailTemplate>(`/email-templates/${id}/`, body),
};

export const workflowsApi = {
  list: async (params: { base_type?: string; is_active?: boolean } = {}): Promise<Workflow[]> =>
    pickResults<Workflow>(await itsmClient.get(`/workflows/${qs(params)}`)),
  get: (id: string) => itsmClient.get<Workflow>(`/workflows/${id}/`),
  create: (body: Partial<Workflow>) => itsmClient.post<Workflow>("/workflows/", body),
  update: (id: string, body: Partial<Workflow>) =>
    itsmClient.patch<Workflow>(`/workflows/${id}/`, body),
  graph: (id: string) => itsmClient.get<WorkflowGraph>(`/workflows/${id}/graph/`),
  validate: (id: string) => itsmClient.post<WorkflowValidation>(`/workflows/${id}/validate/`),
  categories: async (): Promise<WorkflowStatusCategory[]> =>
    pickResults<WorkflowStatusCategory>(await itsmClient.get("/status-categories/")),
  statuses: async (workflowId: string): Promise<WorkflowStatus[]> =>
    pickResults<WorkflowStatus>(await itsmClient.get(`/statuses/${qs({ workflow: workflowId })}`)),
  createStatus: (body: Partial<WorkflowStatus> & { workflow: string }) =>
    itsmClient.post<WorkflowStatus>("/statuses/", body),
  updateStatus: (id: string, body: Partial<WorkflowStatus>) =>
    itsmClient.patch<WorkflowStatus>(`/statuses/${id}/`, body),
  deleteStatus: (id: string) => itsmClient.del<void>(`/statuses/${id}/`),
  transitions: async (workflowId: string): Promise<WorkflowTransition[]> =>
    pickResults<WorkflowTransition>(await itsmClient.get(`/transitions/${qs({ workflow: workflowId })}`)),
  createTransition: (body: Partial<WorkflowTransition> & { workflow: string; to_status: string }) =>
    itsmClient.post<WorkflowTransition>("/transitions/", body),
  updateTransition: (id: string, body: Partial<WorkflowTransition>) =>
    itsmClient.patch<WorkflowTransition>(`/transitions/${id}/`, body),
  deleteTransition: (id: string) => itsmClient.del<void>(`/transitions/${id}/`),
};

export const calendarsApi = {
  list: async (): Promise<BusinessCalendar[]> =>
    pickResults<BusinessCalendar>(await itsmClient.get("/business-calendars/")),
  get: (id: string) => itsmClient.get<BusinessCalendar>(`/business-calendars/${id}/`),
  create: (body: CreateCalendarInput) =>
    itsmClient.post<BusinessCalendar>("/business-calendars/", body),
  update: (id: string, body: Partial<CreateCalendarInput>) =>
    itsmClient.patch<BusinessCalendar>(`/business-calendars/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/business-calendars/${id}/`),
};

export const businessHoursApi = {
  list: async (calendar: string): Promise<BusinessHours[]> =>
    pickResults<BusinessHours>(await itsmClient.get(`/business-hours/${qs({ calendar })}`)),
  create: (body: { calendar: string; weekday: number; start_time: string; end_time: string }) =>
    itsmClient.post<BusinessHours>("/business-hours/", body),
  update: (id: string, body: Partial<{ weekday: number; start_time: string; end_time: string }>) =>
    itsmClient.patch<BusinessHours>(`/business-hours/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/business-hours/${id}/`),
};

export const holidaysApi = {
  list: async (calendar: string): Promise<Holiday[]> =>
    pickResults<Holiday>(await itsmClient.get(`/holidays/${qs({ calendar })}`)),
  create: (body: { calendar: string; date: string; name?: string; recurring_annually?: boolean }) =>
    itsmClient.post<Holiday>("/holidays/", body),
  delete: (id: string) => itsmClient.del<void>(`/holidays/${id}/`),
};

export const groupsApi = {
  list: async (params: { helpdesk?: string; type?: string; is_active?: boolean } = {}): Promise<Group[]> =>
    pickResults<Group>(await itsmClient.get(`/groups/${qs(params)}`)),
  get: (id: string) => itsmClient.get<Group>(`/groups/${id}/`),
  create: (body: CreateGroupInput) => itsmClient.post<Group>("/groups/", body),
  update: (id: string, body: Partial<CreateGroupInput>) =>
    itsmClient.patch<Group>(`/groups/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/groups/${id}/`),
  members: (id: string) => itsmClient.get<GroupMembership[]>(`/groups/${id}/members/`),
  addMember: (id: string, body: { user: string; role_in_group?: "member" | "lead" }) =>
    itsmClient.post<GroupMembership>(`/groups/${id}/add_member/`, body),
  removeMember: (id: string, user: string) =>
    itsmClient.post<void>(`/groups/${id}/remove_member/`, { user }),
};

export const routingRulesApi = {
  list: async (params: { project?: string; is_active?: boolean } = {}): Promise<RoutingRule[]> =>
    pickResults<RoutingRule>(await itsmClient.get(`/routing-rules/${qs(params)}`)),
  create: (body: RoutingRuleInput) => itsmClient.post<RoutingRule>("/routing-rules/", body),
  update: (id: string, body: Partial<RoutingRuleInput>) =>
    itsmClient.patch<RoutingRule>(`/routing-rules/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/routing-rules/${id}/`),
};

export const fieldsApi = {
  list: async (project: string): Promise<FieldDefinition[]> =>
    pickResults<FieldDefinition>(await itsmClient.get(`/field-definitions/${qs({ project })}`)),
  create: (body: Partial<FieldDefinition>) =>
    itsmClient.post<FieldDefinition>("/field-definitions/", body),
  update: (id: string, body: Partial<FieldDefinition>) =>
    itsmClient.patch<FieldDefinition>(`/field-definitions/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/field-definitions/${id}/`),
  createOption: (body: Partial<FieldOption> & { field: string }) =>
    itsmClient.post<FieldOption>("/field-options/", body),
  updateOption: (id: string, body: Partial<FieldOption>) =>
    itsmClient.patch<FieldOption>(`/field-options/${id}/`, body),
  deleteOption: (id: string) => itsmClient.del<void>(`/field-options/${id}/`),
};

export const layoutsApi = {
  list: async (project: string): Promise<FieldLayout[]> =>
    pickResults<FieldLayout>(await itsmClient.get(`/field-layouts/${qs({ project })}`)),
  // Resolve the layout that applies (ticket-type specific, else project default).
  // Returns {id: null, items: []} when none exists.
  resolve: (project: string, ticketType?: string) =>
    itsmClient.get<{ id: string | null; items: FieldLayoutItem[]; name?: string }>(
      `/field-layouts/resolve/${qs({ project, ticket_type: ticketType })}`,
    ),
  create: (body: { project: string; ticket_type?: string | null; name?: string }) =>
    itsmClient.post<FieldLayout>("/field-layouts/", body),
  update: (id: string, body: Partial<{ name: string }>) =>
    itsmClient.patch<FieldLayout>(`/field-layouts/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/field-layouts/${id}/`),
  createItem: (body: Partial<FieldLayoutItem> & { layout: string; field: string }) =>
    itsmClient.post<FieldLayoutItem>("/field-layout-items/", body),
  updateItem: (id: string, body: Partial<FieldLayoutItem>) =>
    itsmClient.patch<FieldLayoutItem>(`/field-layout-items/${id}/`, body),
  deleteItem: (id: string) => itsmClient.del<void>(`/field-layout-items/${id}/`),
};

export const approvalWorkflowsApi = {
  list: async (params: { project?: string; helpdesk?: string } = {}): Promise<ApprovalWorkflow[]> =>
    pickResults<ApprovalWorkflow>(await itsmClient.get(`/approval-workflows/${qs(params)}`)),
  create: (body: Partial<ApprovalWorkflow>) =>
    itsmClient.post<ApprovalWorkflow>("/approval-workflows/", body),
  update: (id: string, body: Partial<ApprovalWorkflow>) =>
    itsmClient.patch<ApprovalWorkflow>(`/approval-workflows/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/approval-workflows/${id}/`),
  createStage: (body: Partial<ApprovalStage> & { workflow: string }) =>
    itsmClient.post<ApprovalStage>("/approval-stages/", body),
  updateStage: (id: string, body: Partial<ApprovalStage>) =>
    itsmClient.patch<ApprovalStage>(`/approval-stages/${id}/`, body),
  deleteStage: (id: string) => itsmClient.del<void>(`/approval-stages/${id}/`),
};

export const reportsApi = {
  get: (name: string, params: Record<string, unknown> = {}) =>
    itsmClient.get<ReportResult>(`/reports/${name}/${qs(params)}`),
  /** Download ONE report as Excel (one sheet) or CSV (one table). Scope params:
   * `helpdesk`, `project`, `group`, `date_from`, `date_to`, `days`. */
  exportOne: (name: string, format: "xlsx" | "csv", params: Record<string, unknown> = {}) =>
    itsmClient.download(
      `/reports/${name}/export/${qs({ ...params, format })}`,
      `${name}.${format}`,
    ),
  /** Download the combined standard-report pack as a single Excel workbook. */
  exportAll: (params: Record<string, unknown> = {}) =>
    itsmClient.download(
      `/reports/export/${qs({ ...params, format: "xlsx" })}`,
      `itsm-reports.xlsx`,
    ),
};

export const savedFiltersApi = {
  list: async (params: { project?: string } = {}): Promise<SavedFilter[]> =>
    pickResults<SavedFilter>(await itsmClient.get(`/saved-filters/${qs(params)}`)),
  create: (body: SavedFilterInput) => itsmClient.post<SavedFilter>("/saved-filters/", body),
  update: (id: string, body: Partial<SavedFilterInput>) =>
    itsmClient.patch<SavedFilter>(`/saved-filters/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/saved-filters/${id}/`),
  results: async (id: string): Promise<TicketListItem[]> =>
    pickResults<TicketListItem>(await itsmClient.get(`/saved-filters/${id}/results/`)),
};

export const rolesApi = {
  list: async (): Promise<SystemRole[]> =>
    pickResults<SystemRole>(await itsmClient.get("/roles/")),
  get: (id: string) => itsmClient.get<SystemRole>(`/roles/${id}/`),
  create: (body: CreateRoleInput) => itsmClient.post<SystemRole>("/roles/", body),
  update: (id: string, body: Partial<CreateRoleInput>) =>
    itsmClient.patch<SystemRole>(`/roles/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/roles/${id}/`),
  // Bulk-set a role's grant matrix; body is a flat ARRAY of rows. Returns the
  // updated role (with nested `permissions`).
  setPermissions: (id: string, rows: SetRolePermissionInput[]) =>
    itsmClient.put<SystemRole>(`/roles/${id}/permissions/`, rows),
};

// The permission tree (modules viewset has pagination_class=None → bare array).
export const modulesApi = {
  list: () => itsmClient.get<ItsmModule[]>("/modules/"),
};

// Org roster: users joined with their ITSM role + helpdesk membership, plus the
// RBAC-gated create/activate actions. Lives under /itsm/.
export const membersApi = {
  list: async (params: { search?: string; is_active?: boolean } = {}): Promise<Member[]> =>
    pickResults<Member>(await itsmClient.get(`/members/${qs(params)}`)),
  // Returns the new member row plus a one-time `temp_password`.
  createUser: (body: CreateUserInput) => itsmClient.post<Member>("/members/create_user/", body),
  setActive: (id: string | number, is_active: boolean) =>
    itsmClient.post<Member>(`/members/${id}/set_active/`, { is_active }),
  // Assign/clear a user's ITSM role by code (""/none clears). Upserts safely.
  setRole: (id: string | number, role_code: string) =>
    itsmClient.post<Member>(`/members/${id}/set_role/`, { role_code }),
  // Reset a user's password; returns a one-time `temp_password` (generated when
  // no explicit password is passed).
  resetPassword: (id: string | number, password?: string) =>
    itsmClient.post<Member>(`/members/${id}/reset_password/`, password ? { password } : {}),
};

// ── Email channel ─────────────────────────────────────────────────────────────
export const emailChannelsApi = {
  list: async (params: { project?: string; is_active?: boolean } = {}): Promise<EmailChannel[]> =>
    pickResults<EmailChannel>(await itsmClient.get(`/email-channels/${qs(params)}`)),
  get: (id: string) => itsmClient.get<EmailChannel>(`/email-channels/${id}/`),
  create: (body: Partial<EmailChannel>) => itsmClient.post<EmailChannel>("/email-channels/", body),
  update: (id: string, body: Partial<EmailChannel>) =>
    itsmClient.patch<EmailChannel>(`/email-channels/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/email-channels/${id}/`),
  testConnection: (id: string) =>
    itsmClient.post<EmailTestResult>(`/email-channels/${id}/test-connection/`, {}),
  testSmtp: (id: string) => itsmClient.post<EmailTestResult>(`/email-channels/${id}/test-smtp/`, {}),
  pollNow: (id: string) => itsmClient.post<EmailPollResult>(`/email-channels/${id}/poll-now/`, {}),
  oauthStart: (id: string) => itsmClient.post<EmailOauthStart>(`/email-channels/${id}/oauth/start/`, {}),
};

export const emailRulesApi = {
  list: async (params: { channel?: string } = {}): Promise<EmailRule[]> =>
    pickResults<EmailRule>(await itsmClient.get(`/email-rules/${qs(params)}`)),
  create: (body: Partial<EmailRule>) => itsmClient.post<EmailRule>("/email-rules/", body),
  update: (id: string, body: Partial<EmailRule>) =>
    itsmClient.patch<EmailRule>(`/email-rules/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/email-rules/${id}/`),
};

export const inboundEmailsApi = {
  list: async (
    params: { channel?: string; status?: string; from_addr?: string; search?: string } = {},
  ): Promise<InboundEmail[]> =>
    pickResults<InboundEmail>(await itsmClient.get(`/inbound-emails/${qs(params)}`)),
  get: (id: string) => itsmClient.get<InboundEmailDetail>(`/inbound-emails/${id}/`),
  retry: (id: string) => itsmClient.post<InboundEmailDetail>(`/inbound-emails/${id}/retry/`, {}),
};
