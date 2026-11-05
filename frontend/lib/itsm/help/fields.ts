/**
 * Built-in help text for the standard (seeded) ticket fields — the ⓘ beside a field
 * label on the create form, ticket detail and portal views. Keyed by `config.maps_to`
 * (or the field key). An admin's own `config.tooltip` always wins over these.
 *
 * Some of these fields are shown on the Service Portal, so keep the wording plain enough
 * for a requestor. Copy must describe what the system actually does
 * (docs/QA_CHECKLIST.md → "Hover help / tooltips").
 */
export const FIELD_HELP: Record<string, string> = {
  impact:
    "How widely is this affecting work?\n• Low — one person, minor inconvenience\n• Medium — a team/department slowed down\n• High — many users or a whole site affected\n• Critical — business stopped, nothing works",
  urgency:
    "How quickly does this need fixing?\n• Low — can wait, no deadline\n• Medium — needed soon\n• High — work is blocked, fix ASAP",
  priority:
    "How urgent is this overall?\n• P1 Critical — a major outage, needs action immediately\n• P2 High — seriously affecting work\n• P3 Medium — a moderate problem, or a workaround exists\n• P4 Low — a minor issue\nWhen Impact and Urgency are filled in, it's worked out from them automatically (Impact × Urgency) and can still be changed by hand.",
  requestor:
    "The person who raised the ticket. They receive the email updates and can follow it under My Requests in the Service Portal.",
  assigned_group:
    "The team responsible for this ticket. Set by the project's routing rules (or its default group) when the ticket is created. Only teams allowed for this project are listed.",
  assignee:
    "The technician working on this ticket. Must be a member of the Assigned Group — set the group first.",
  source:
    "How the ticket came in — Agent, Portal, Email, Phone or API. Set automatically; it can't be edited.",
  mode: "How the requestor contacted support (Email, Phone, Portal or Walk-in).",
  business_impact: "What the business can't do because of this, e.g. \"Finance can't issue invoices\".",
  users_affected: "Roughly how many people are affected.",
  service_downtime: "Tick when a service is completely unavailable, not just slow or degraded.",
  major_incident:
    "Tick for a high-impact incident that needs the major-incident process: urgent escalation and regular communication.",
  resolution_code: "How the ticket was resolved. Captured when the ticket is resolved.",
  root_cause: "The underlying cause, once it is known.",
  workaround_provided: "Tick when a temporary workaround was given while a permanent fix is pending.",
  resolution_notes:
    "What was done to resolve or fulfil the request. Captured when the ticket is resolved or fulfilled.",
  workaround_notes: "The temporary workaround for this known error, so agents can apply it to matching incidents.",
  investigation_reason: "Why this problem is being investigated.",
  asset: "Assets linked to this ticket; the first is the primary. Defaults to the requestor's assets.",
};

/** Help for a field definition: the admin's tooltip, else the built-in text, else the
 *  definition's own description. */
export function fieldHelp(def: {
  key?: string | null;
  description?: string | null;
  config?: unknown;
}): string {
  const cfg = (def.config ?? {}) as { tooltip?: string; maps_to?: string };
  return cfg.tooltip || FIELD_HELP[cfg.maps_to ?? ""] || FIELD_HELP[def.key ?? ""] || def.description || "";
}
