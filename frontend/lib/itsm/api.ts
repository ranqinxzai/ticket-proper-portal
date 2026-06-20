/** Typed API helpers for the ITSM platform. */

import { itsmClient, pickResults, qs } from "./client";
import type {
  ActivityEvent,
  Article,
  ArticleListItem,
  ApprovalRequest,
  BusinessCalendar,
  CatalogCategory,
  CatalogItem,
  CreateTicketInput,
  Helpdesk,
  ItsmUser,
  KBCategory,
  LoginResponse,
  Notification,
  PortalComment,
  PortalTicket,
  Project,
  ReportResult,
  SlaEntry,
  TicketComment,
  TicketDetail,
  TicketListItem,
  Transition,
  WorkflowStatus,
} from "./types";

export const authApi = {
  login: (username: string, password: string) =>
    itsmClient.post<LoginResponse>("/auth/login/", { username, password }, { anon: true }),
  me: () => itsmClient.get<ItsmUser>("/auth/me/"),
};

export const helpdesksApi = {
  list: async (): Promise<Helpdesk[]> => pickResults<Helpdesk>(await itsmClient.get("/helpdesks/")),
};

export const projectsApi = {
  list: async (): Promise<Project[]> => pickResults<Project>(await itsmClient.get("/projects/")),
};

export type TicketListParams = {
  project?: string;
  status?: string;
  priority?: string;
  search?: string;
  ordering?: string;
};

export const ticketsApi = {
  list: async (params: TicketListParams = {}): Promise<TicketListItem[]> =>
    pickResults<TicketListItem>(await itsmClient.get(`/tickets/${qs(params)}`)),
  get: (id: string) => itsmClient.get<TicketDetail>(`/tickets/${id}/`),
  create: (body: CreateTicketInput) => itsmClient.post<TicketDetail>("/tickets/", body),
  availableTransitions: (id: string) =>
    itsmClient.get<Transition[]>(`/tickets/${id}/available-transitions/`),
  transition: (id: string, body: { transition_id: string; comment?: string; comment_visibility?: string }) =>
    itsmClient.post<TicketDetail>(`/tickets/${id}/transition/`, body),
  comments: (id: string) => itsmClient.get<TicketComment[]>(`/tickets/${id}/comments/`),
  addComment: (id: string, body: { body_html: string; visibility?: string }) =>
    itsmClient.post<TicketComment>(`/tickets/${id}/comments/`, body),
  activity: (id: string) => itsmClient.get<ActivityEvent[]>(`/tickets/${id}/activity/`),
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
  request: (id: string) => itsmClient.get<PortalTicket>(`/portal/requests/${id}/`),
  comments: (id: string) => itsmClient.get<PortalComment[]>(`/portal/requests/${id}/comments/`),
  addComment: (id: string, body_html: string) =>
    itsmClient.post<PortalComment>(`/portal/requests/${id}/comments/`, { body_html }),
};

export const slaApi = {
  forTicket: (id: string) => itsmClient.get<SlaEntry[]>(`/tickets/${id}/sla/`),
};

export const notificationsApi = {
  list: async (): Promise<Notification[]> =>
    pickResults<Notification>(await itsmClient.get("/notifications/")),
  unreadCount: () => itsmClient.get<{ unread: number }>("/notifications/unread-count/"),
  markRead: (id: string) => itsmClient.post(`/notifications/${id}/read/`),
  markAllRead: () => itsmClient.post("/notifications/mark-all-read/"),
};

export const workflowsApi = {
  statuses: async (workflowId: string): Promise<WorkflowStatus[]> =>
    pickResults<WorkflowStatus>(await itsmClient.get(`/statuses/${qs({ workflow: workflowId })}`)),
};

export const calendarsApi = {
  list: async (): Promise<BusinessCalendar[]> =>
    pickResults<BusinessCalendar>(await itsmClient.get("/business-calendars/")),
};

export const reportsApi = {
  get: (name: string, params: Record<string, unknown> = {}) =>
    itsmClient.get<ReportResult>(`/reports/${name}/${qs(params)}`),
};
