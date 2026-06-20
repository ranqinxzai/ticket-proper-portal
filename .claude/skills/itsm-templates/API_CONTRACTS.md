# itsm-templates — API Contracts (BUILT)

**Status: implemented.** Endpoints live under base `/api/v1/itsm/`.
Module: `itsm.tickets.templates` (Agent: read/create/update; Supervisor: + delete).

## Ticket templates
### `GET|POST ticket-templates` · `.../{id}`  search `?search=` (name/description)  filter `?project=&category=&is_active=`
`{ id, name, description, project, ticket_type, summary_template, description_html, default_priority,
default_group, default_assignee, field_defaults:{<field_key>: <value>}, category, is_active,
created_by }`.
On create, `created_by` is set to the requesting user.

## Categories
### `GET|POST template-categories` · `.../{id}`
`{ id, name, sort_order }`.

## Apply a template (prefill the create form)
### `POST tickets/apply-template/`  (detail=False)
Body `{ "template_id": "<uuid>" }` → returns a **prefill payload** for the create form (it does
**not** mutate a ticket and writes **no** audit event):
```
{ project, ticket_type, summary, description_html, priority,
  assigned_group, assignee, custom_fields }
```
The frontend hydrates the create form from this payload, then creates the ticket via the normal
`POST tickets`.

## Error codes
- `403` — Agent attempting a delete.
- `404` — unknown `template_id` on `apply-template`.
