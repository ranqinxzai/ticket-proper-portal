# itsm-templates — Architecture (BUILT)

## Current state
Built. The RBAC module `itsm.tickets.templates` is seeded, and the `TicketTemplate`/
`TemplateCategory` models live in `itsm_tickets/models.py` (migration `0002`).

## Layout
```
itsm_tickets/
  models.py        # TemplateCategory, TicketTemplate
  serializers.py   # TicketTemplate(Category)Serializer
  views.py         # TicketTemplateViewSet (module_code="itsm.tickets.templates"),
                   #   TemplateCategoryViewSet
                   # tickets/apply-template action on TicketViewSet (detail=False)
  urls.py          # ticket-templates, template-categories
```

## Design decisions
- **Lives in `itsm_tickets`.** A template is a ticket blueprint; it belongs to the tickets domain and
  the RBAC tree (`itsm.tickets.templates`).
- **Prefill at create (the single consumption path).** `POST tickets/apply-template/` (detail=False
  on `TicketViewSet`) takes a `template_id` and returns a prefill payload
  (`{project, ticket_type, summary, description_html, priority, assigned_group, assignee,
  custom_fields}`) built straight from the `TicketTemplate`. The create form hydrates from this
  payload; the ticket is then created via the normal `create_ticket` path — the template is just
  initial form state. The action does **not** mutate any ticket and writes **no** audit event.
- **`description_html`** mirrors `Ticket.description_html` and is returned as-is in the prefill
  payload; it is sanitized through the normal create path when the ticket is saved.
- **Default custom-field values** are stored in `field_defaults` (JSON, field key → value) and
  surfaced as `custom_fields` in the prefill payload; they flow into the create form like any other
  initial value.
- **Scoped to project + ticket_type** so the form can offer only relevant templates for the chosen
  type; `is_active` retires a template.

## Audit
The `apply-template` action returns a prefill payload and does **not** write an `AuditEvent`. (The
`template_applied` action value may exist on `AuditEvent.Action`, but the implemented endpoint does
not emit it — creating the ticket from the prefilled form produces the normal ticket-created audit
trail.)
