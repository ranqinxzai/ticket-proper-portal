# itsm-templates

## Purpose
Ticket templates: pre-filled ticket blueprints (summary, description, priority, type, default
custom-field values) that prefill the create form. **Status: BUILT.** `TicketTemplate`/
`TemplateCategory` live in the **`itsm_tickets`** app (models in `itsm_tickets/models.py`, migration
`0002`). The RBAC module and the `apply-template` action are implemented.

## Backend app path
`backend/apps/itsm_tickets/` (models live here).

## Key concepts
- **`TemplateCategory`** — grouping for the template library.
- **`TicketTemplate`** — `name`, `description`, `project`, `ticket_type`, `summary_template`,
  `description_html`, `default_priority`, `default_group`, `default_assignee`, `field_defaults`
  (JSON), `category`, `is_active`, `created_by`. Used to seed a new ticket.
- **`apply-template`** — `POST tickets/apply-template/` (detail=False) returns a prefill payload
  for the create form from a `TicketTemplate` by `template_id`. It does **not** mutate a ticket and
  does **not** log an audit event.

## Frontend path / pages (planned)
Template library editor under `admin/.../templates`; the **Create Ticket** 3-step wizard
(type → template → form) prefills `DynamicTicketForm` from the chosen template.

## API clients
`template-categories`, `ticket-templates`; `POST tickets/apply-template/`.

## RBAC module codes
**`itsm.tickets.templates`** — already in `itsm_rbac/registry.py` (child of `itsm.tickets`).
Agent: read/create/update (no delete); Supervisor: full.

## Key files
`TicketTemplate` + `TemplateCategory` models in `itsm_tickets/models.py`, serializers/views/urls
(`TicketTemplateViewSet`, `TemplateCategoryViewSet`), and the `apply_template` action on
`TicketViewSet` (returns a prefill payload; no audit event is written).
