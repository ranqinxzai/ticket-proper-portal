# itsm-templates — Bug Log / Gotchas (BUILT)

- **Built.** The `itsm.tickets.templates` RBAC module is seeded and the `TicketTemplate`/
  `TemplateCategory` models + `ticket-templates`/`template-categories` routes and the
  `tickets/apply-template/` action are live (`itsm_tickets`, migration `0002`).
- **`apply-template` only prefills — it does NOT apply onto a ticket.** The implemented
  `POST tickets/apply-template/` (detail=False) takes a `template_id` and **returns a prefill
  payload** for the create form; it does **not** mutate any ticket. The ticket is made by the normal
  `create_ticket` from the hydrated form.
- **No `template_applied` audit event is written.** Despite the route name and the existing
  `AuditEvent.Action` value, the implemented action emits no audit event. Don't rely on a
  `template_applied` entry in History; the only audit trail is the normal ticket-created event when
  the prefilled form is submitted.
- **`apply-template` is detail=False** — the route is `tickets/apply-template/`, not
  `tickets/{id}/apply-template/`. It carries no target ticket, so there is no project/ticket_type
  "match" check.
- **`field_defaults` is returned verbatim as `custom_fields`.** The action does not route values
  through `field_service` — typed/mandatory validation happens later on the normal create path, not
  during prefill.
- **Agents can create/edit, not delete** (seeded grants). Retire via `is_active=False`.
