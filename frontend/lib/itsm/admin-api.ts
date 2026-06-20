/** API wrappers for the admin builder UIs. */

import { itsmClient, qs, pickResults } from "./client";
import type {
  BusinessCalendar,
  Dashboard,
  EmailChannel,
  EmailOauthStart,
  EmailPollResult,
  EmailRule,
  EmailTemplateRow,
  EmailTestResult,
  FieldDefinition,
  FieldLayoutFull,
  FieldLayoutItem,
  GraphValidation,
  HolidayRow,
  InboundEmail,
  InboundEmailDetail,
  NotificationRuleRow,
  NotificationSchemeRow,
  SlaPolicy,
  StatusCategoryRow,
  TicketTypeRow,
  Widget,
  WidgetData,
  WfStatus,
  WfTransition,
  WorkflowGraph,
  WorkflowSummary,
} from "./admin-types";

// ---- workflows ------------------------------------------------------------

export const workflowsApi = {
  list: () =>
    itsmClient.get<WorkflowSummary[] | { results: WorkflowSummary[] }>("/workflows/").then((r) => pickResults<WorkflowSummary>(r)),
  graph: (id: string) => itsmClient.get<WorkflowGraph>(`/workflows/${id}/graph/`),
  validate: (id: string) => itsmClient.post<GraphValidation>(`/workflows/${id}/validate/`, {}),
  categories: () =>
    itsmClient.get<StatusCategoryRow[] | { results: StatusCategoryRow[] }>("/status-categories/").then((r) => pickResults<StatusCategoryRow>(r)),
  createStatus: (body: Partial<WfStatus>) => itsmClient.post<WfStatus>("/statuses/", body),
  updateStatus: (id: string, body: Partial<WfStatus>) => itsmClient.patch<WfStatus>(`/statuses/${id}/`, body),
  deleteStatus: (id: string) => itsmClient.del<void>(`/statuses/${id}/`),
  createTransition: (body: Partial<WfTransition>) => itsmClient.post<WfTransition>("/transitions/", body),
  updateTransition: (id: string, body: Partial<WfTransition>) => itsmClient.patch<WfTransition>(`/transitions/${id}/`, body),
  deleteTransition: (id: string) => itsmClient.del<void>(`/transitions/${id}/`),
};

// ---- fields ---------------------------------------------------------------

export const fieldAdminApi = {
  ticketTypes: (project?: string) =>
    itsmClient.get<TicketTypeRow[] | { results: TicketTypeRow[] }>(`/ticket-types/${qs({ project })}`).then((r) => pickResults<TicketTypeRow>(r)),
  definitions: (project?: string) =>
    itsmClient.get<FieldDefinition[] | { results: FieldDefinition[] }>(`/field-definitions/${qs({ project })}`).then((r) => pickResults<FieldDefinition>(r)),
  createDefinition: (body: Partial<FieldDefinition>) => itsmClient.post<FieldDefinition>("/field-definitions/", body),
  layouts: (project?: string, ticketType?: string) =>
    itsmClient.get<FieldLayoutFull[] | { results: FieldLayoutFull[] }>(`/field-layouts/${qs({ project, ticket_type: ticketType })}`).then((r) => pickResults<FieldLayoutFull>(r)),
  createLayout: (body: { project: string; ticket_type: string | null; name: string }) =>
    itsmClient.post<FieldLayoutFull>("/field-layouts/", body),
  createItem: (body: Partial<FieldLayoutItem>) => itsmClient.post<FieldLayoutItem>("/field-layout-items/", body),
  updateItem: (id: string, body: Partial<FieldLayoutItem>) => itsmClient.patch<FieldLayoutItem>(`/field-layout-items/${id}/`, body),
  deleteItem: (id: string) => itsmClient.del<void>(`/field-layout-items/${id}/`),
};

// ---- SLA ------------------------------------------------------------------

export const slaAdminApi = {
  policies: () =>
    itsmClient.get<SlaPolicy[] | { results: SlaPolicy[] }>("/sla-policies/").then((r) => pickResults<SlaPolicy>(r)),
  policy: (id: string) => itsmClient.get<SlaPolicy>(`/sla-policies/${id}/`),
  updatePolicy: (id: string, body: Partial<SlaPolicy>) => itsmClient.patch<SlaPolicy>(`/sla-policies/${id}/`, body),
  createPolicy: (body: Partial<SlaPolicy>) => itsmClient.post<SlaPolicy>("/sla-policies/", body),
  updateTarget: (id: string, body: { target_minutes: number }) => itsmClient.patch(`/sla-targets/${id}/`, body),
  createTarget: (body: { metric: string; priority: string; target_minutes: number }) => itsmClient.post("/sla-targets/", body),
  createEscalation: (body: { metric: string; threshold_pct: number; action: string; config?: Record<string, unknown> }) =>
    itsmClient.post("/escalation-rules/", body),
  deleteEscalation: (id: string) => itsmClient.del<void>(`/escalation-rules/${id}/`),
  calendars: () =>
    itsmClient.get<BusinessCalendar[] | { results: BusinessCalendar[] }>("/business-calendars/").then((r) => pickResults<BusinessCalendar>(r)),
  calendar: (id: string) => itsmClient.get<BusinessCalendar>(`/business-calendars/${id}/`),
  createHoliday: (body: HolidayRow) => itsmClient.post<HolidayRow>("/holidays/", body),
  deleteHoliday: (id: string) => itsmClient.del<void>(`/holidays/${id}/`),
};

// ---- notifications --------------------------------------------------------

export const notifAdminApi = {
  schemes: () =>
    itsmClient.get<NotificationSchemeRow[] | { results: NotificationSchemeRow[] }>("/notification-schemes/").then((r) => pickResults<NotificationSchemeRow>(r)),
  scheme: (id: string) => itsmClient.get<NotificationSchemeRow>(`/notification-schemes/${id}/`),
  createRule: (body: Partial<NotificationRuleRow>) => itsmClient.post<NotificationRuleRow>("/notification-rules/", body),
  updateRule: (id: string, body: Partial<NotificationRuleRow>) => itsmClient.patch<NotificationRuleRow>(`/notification-rules/${id}/`, body),
  deleteRule: (id: string) => itsmClient.del<void>(`/notification-rules/${id}/`),
  templates: () =>
    itsmClient.get<EmailTemplateRow[] | { results: EmailTemplateRow[] }>("/email-templates/").then((r) => pickResults<EmailTemplateRow>(r)),
  updateTemplate: (id: string, body: Partial<EmailTemplateRow>) => itsmClient.patch<EmailTemplateRow>(`/email-templates/${id}/`, body),
  createTemplate: (body: Partial<EmailTemplateRow>) => itsmClient.post<EmailTemplateRow>("/email-templates/", body),
};

// ---- dashboards -----------------------------------------------------------

export const dashAdminApi = {
  list: () =>
    itsmClient.get<Dashboard[] | { results: Dashboard[] }>("/dashboards/").then((r) => pickResults<Dashboard>(r)),
  get: (id: string) => itsmClient.get<Dashboard>(`/dashboards/${id}/`),
  create: (body: { name: string; is_shared?: boolean; layout?: unknown[] }) => itsmClient.post<Dashboard>("/dashboards/", body),
  update: (id: string, body: Partial<Dashboard>) => itsmClient.patch<Dashboard>(`/dashboards/${id}/`, body),
  remove: (id: string) => itsmClient.del<void>(`/dashboards/${id}/`),
  createWidget: (body: Partial<Widget>) => itsmClient.post<Widget>("/widgets/", body),
  updateWidget: (id: string, body: Partial<Widget>) => itsmClient.patch<Widget>(`/widgets/${id}/`, body),
  deleteWidget: (id: string) => itsmClient.del<void>(`/widgets/${id}/`),
  widgetData: (id: string) => itsmClient.get<WidgetData>(`/widgets/${id}/data/`),
};

// ---- email channels -------------------------------------------------------

export const emailAdminApi = {
  channels: {
    list: () =>
      itsmClient.get<EmailChannel[] | { results: EmailChannel[] }>("/email-channels/").then((r) => pickResults<EmailChannel>(r)),
    get: (id: string) => itsmClient.get<EmailChannel>(`/email-channels/${id}/`),
    create: (body: Partial<EmailChannel>) => itsmClient.post<EmailChannel>("/email-channels/", body),
    update: (id: string, body: Partial<EmailChannel>) => itsmClient.patch<EmailChannel>(`/email-channels/${id}/`, body),
    remove: (id: string) => itsmClient.del<void>(`/email-channels/${id}/`),
    testConnection: (id: string) => itsmClient.post<EmailTestResult>(`/email-channels/${id}/test-connection/`, {}),
    pollNow: (id: string) => itsmClient.post<EmailPollResult>(`/email-channels/${id}/poll-now/`, {}),
    oauthStart: (id: string) => itsmClient.post<EmailOauthStart>(`/email-channels/${id}/oauth/start/`, {}),
  },
  rules: {
    list: (channelId?: string) =>
      itsmClient.get<EmailRule[] | { results: EmailRule[] }>(`/email-rules/${qs({ channel: channelId })}`).then((r) => pickResults<EmailRule>(r)),
    create: (body: Partial<EmailRule>) => itsmClient.post<EmailRule>("/email-rules/", body),
    update: (id: string, body: Partial<EmailRule>) => itsmClient.patch<EmailRule>(`/email-rules/${id}/`, body),
    remove: (id: string) => itsmClient.del<void>(`/email-rules/${id}/`),
  },
  logs: {
    list: (params: { channel?: string; status?: string; from_addr?: string; search?: string } = {}) =>
      itsmClient.get<InboundEmail[] | { results: InboundEmail[] }>(`/inbound-emails/${qs(params)}`).then((r) => pickResults<InboundEmail>(r)),
    get: (id: string) => itsmClient.get<InboundEmailDetail>(`/inbound-emails/${id}/`),
    retry: (id: string) => itsmClient.post<InboundEmailDetail>(`/inbound-emails/${id}/retry/`, {}),
  },
};
