# itsm-templates — User Flows (BUILT)

## Flow A — Build a template
1. Supervisor/agent opens `admin/.../templates`.
2. `POST ticket-templates` `{ name:"VPN access request", project:REQ, ticket_type:<Access>,
   summary_template, description_html, default_priority:"medium", field_defaults:{...} }`.
3. `created_by` is set server-side; categorize + activate.

## Flow B — Create from a template (form prefill)
1. Agent starts the create form: pick type, then pick a template (filtered by project + type).
2. `POST tickets/apply-template/` `{ template_id }` returns the prefill payload, which hydrates
   `DynamicTicketForm` (summary/description/priority/group/assignee/custom fields).
3. Agent tweaks and submits → normal `POST tickets` creates the ticket.
