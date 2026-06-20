/** Typed API helpers for the ITSM platform. */

import { itsmClient, pickResults, qs } from "./client";
import type {
  ActivityEvent,
  CreateTicketInput,
  Helpdesk,
  ItsmUser,
  LoginResponse,
  Project,
  TicketComment,
  TicketDetail,
  TicketListItem,
  Transition,
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
