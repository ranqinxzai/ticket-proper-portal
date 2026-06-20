/** Typed API wrappers for the ITSM platform. */

import { itsmClient, qs, pickResults } from "./client";
import type {
  AccountUser,
  ActivityEvent,
  CannedNote,
  CommentVisibility,
  FieldLayout,
  Group,
  Helpdesk,
  LoginResponse,
  Notification,
  Paginated,
  Project,
  SavedFilter,
  SlaEntry,
  TicketComment,
  TicketDetail,
  TicketListItem,
  TicketTemplate,
  Transition,
  UnreadCount,
  ItsmUser,
  Watcher,
} from "./types";

// ---- auth -----------------------------------------------------------------

export const authApi = {
  login: (username: string, password: string) =>
    itsmClient.post<LoginResponse>("/auth/login/", { username, password }, { anon: true }),
  me: () => itsmClient.get<ItsmUser>("/auth/me/"),
};

// ---- tickets --------------------------------------------------------------

export type TicketQuery = {
  search?: string;
  /** Helpdesk scope (id or key). Advisory — the server clamps it to membership. */
  helpdesk?: string;
  project?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  assigned_group?: string;
  status__category?: string;
  ordering?: string;
  page?: number;
  saved_filter?: string;
};

export type CreateTicketPayload = {
  project: string;
  ticket_type: string;
  summary: string;
  description_html?: string;
  priority: string;
  assigned_group?: string | null;
  assignee?: string | null;
  requestor?: string | null;
  source: string;
  custom_fields?: Record<string, unknown>;
};

export type TransitionPayload = {
  transition_id: string;
  fields?: Record<string, unknown>;
  comment?: string;
  comment_visibility?: CommentVisibility;
};

export type BulkPayload = {
  ids?: string[];
  saved_filter_id?: string;
  op: string;
  value: unknown;
};

export const ticketsApi = {
  list: (q: TicketQuery = {}) =>
    itsmClient.get<Paginated<TicketListItem>>(`/tickets/${qs(q as Record<string, unknown>)}`),
  get: (id: string) => itsmClient.get<TicketDetail>(`/tickets/${id}/`),
  /** Resolve a ticket_number (e.g. "INC-1") to its detail record. */
  async getByNumber(ticketNumber: string): Promise<TicketDetail | null> {
    const page = await ticketsApi.list({ search: ticketNumber, page: 1 });
    const match =
      page.results.find((t) => t.ticket_number.toLowerCase() === ticketNumber.toLowerCase()) ??
      page.results[0];
    if (!match) return null;
    return ticketsApi.get(match.id);
  },
  create: (payload: CreateTicketPayload) => itsmClient.post<TicketDetail>("/tickets/", payload),
  availableTransitions: (id: string) =>
    itsmClient.get<Transition[]>(`/tickets/${id}/available-transitions/`),
  transition: (id: string, payload: TransitionPayload) =>
    itsmClient.post<TicketDetail>(`/tickets/${id}/transition/`, payload),
  assign: (id: string, assignee: string | null, group: string | null) =>
    itsmClient.post<TicketDetail>(`/tickets/${id}/assign/`, { assignee, group }),
  comments: (id: string) =>
    itsmClient
      .get<Paginated<TicketComment> | TicketComment[]>(`/tickets/${id}/comments/`)
      .then((r) => pickResults<TicketComment>(r)),
  addComment: (
    id: string,
    body: { body_html: string; visibility: CommentVisibility; mention_user_ids?: string[] },
  ) => itsmClient.post<TicketComment>(`/tickets/${id}/comments/`, body),
  activity: (id: string) =>
    itsmClient
      .get<Paginated<ActivityEvent> | ActivityEvent[]>(`/tickets/${id}/activity/`)
      .then((r) => pickResults<ActivityEvent>(r)),
  sla: (id: string) => itsmClient.get<SlaEntry[]>(`/tickets/${id}/sla/`),
  watchers: (id: string) =>
    itsmClient
      .get<Paginated<Watcher> | Watcher[]>(`/tickets/${id}/watchers/`)
      .then((r) => pickResults<Watcher>(r)),
  watch: (id: string) => itsmClient.post<void>(`/tickets/${id}/watch/`, {}),
  unwatch: (id: string) => itsmClient.del<void>(`/tickets/${id}/watch/`),
  bulk: (payload: BulkPayload) => itsmClient.post<unknown>("/tickets/bulk/", payload),
  applyTemplate: (templateId: string) =>
    itsmClient.post<Partial<CreateTicketPayload> & Record<string, unknown>>("/tickets/apply-template/", {
      template_id: templateId,
    }),
};

// ---- support / catalogue --------------------------------------------------

export const projectsApi = {
  /** Scoped to the agent's accessible helpdesks; pass a helpdesk id/key to narrow. */
  list: (helpdesk?: string) =>
    itsmClient
      .get<Paginated<Project> | Project[]>(`/projects/${qs({ helpdesk })}`)
      .then((r) => pickResults<Project>(r)),
};

export type HelpdeskMember = {
  id: string;
  helpdesk: string;
  user: string | number;
  username: string;
  full_name: string;
  role_in_helpdesk: "member" | "lead";
  is_active: boolean;
};

export const helpdesksApi = {
  list: () =>
    itsmClient
      .get<Paginated<Helpdesk> | Helpdesk[]>("/helpdesks/")
      .then((r) => pickResults<Helpdesk>(r)),
  create: (body: { name: string; key: string; description?: string; color?: string; icon?: string }) =>
    itsmClient.post<Helpdesk>("/helpdesks/", body),
  update: (id: string, body: Partial<Helpdesk>) => itsmClient.patch<Helpdesk>(`/helpdesks/${id}/`, body),
  members: (id: string) => itsmClient.get<HelpdeskMember[]>(`/helpdesks/${id}/members/`),
  addMember: (id: string, userId: string, role: "member" | "lead" = "member") =>
    itsmClient.post<HelpdeskMember>(`/helpdesks/${id}/add_member/`, { user: userId, role_in_helpdesk: role }),
  removeMember: (id: string, userId: string) =>
    itsmClient.post<void>(`/helpdesks/${id}/remove_member/`, { user: userId }),
};

export const groupsApi = {
  list: () => itsmClient.get<Paginated<Group> | Group[]>("/groups/").then((r) => pickResults<Group>(r)),
};

export const usersApi = {
  /** NB: the accounts endpoint lives at the non-itsm base `/users/`. */
  list: () =>
    itsmClient
      .get<Paginated<AccountUser> | AccountUser[]>("/users/", { itsm: false })
      .then((r) => pickResults<AccountUser>(r)),
};

export const savedFiltersApi = {
  list: () =>
    itsmClient
      .get<Paginated<SavedFilter> | SavedFilter[]>("/saved-filters/")
      .then((r) => pickResults<SavedFilter>(r)),
  create: (body: { name: string; query_spec: Record<string, unknown>; is_shared?: boolean }) =>
    itsmClient.post<SavedFilter>("/saved-filters/", body),
};

export const fieldsApi = {
  resolveLayout: (project: string, ticketType: string) =>
    itsmClient.get<FieldLayout>(`/field-layouts/resolve/${qs({ project, ticket_type: ticketType })}`),
};

export const cannedNotesApi = {
  list: () =>
    itsmClient
      .get<Paginated<CannedNote> | CannedNote[]>("/canned-notes/")
      .then((r) => pickResults<CannedNote>(r)),
};

export const templatesApi = {
  list: (project?: string) =>
    itsmClient
      .get<Paginated<TicketTemplate> | TicketTemplate[]>(`/ticket-templates/${qs({ project })}`)
      .then((r) => pickResults<TicketTemplate>(r)),
};

export const notificationsApi = {
  list: (unreadOnly = false) =>
    itsmClient
      .get<Paginated<Notification> | Notification[]>(`/notifications/${qs({ unread: unreadOnly ? 1 : undefined })}`)
      .then((r) => pickResults<Notification>(r)),
  unreadCount: () => itsmClient.get<UnreadCount>("/notifications/unread-count/"),
  markRead: (id: string) => itsmClient.post<void>(`/notifications/${id}/read/`, {}),
  markAllRead: () => itsmClient.post<void>("/notifications/mark-all-read/", {}),
};

export const reportsApi = {
  get: <T = unknown>(name: string, params: Record<string, unknown> = {}) =>
    itsmClient.get<T>(`/reports/${name}/${qs(params)}`),
};

export const dashboardsApi = {
  list: () => itsmClient.get<Paginated<unknown> | unknown[]>("/dashboards/").then((r) => pickResults(r)),
};
