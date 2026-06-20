# itsm-templates — Interlinking (BUILT)

## Depends on
- **itsm-core** — `BaseModel`; `sanitize_html`/`html_to_text` on the normal ticket-create path.
- **itsm-tickets** — physically part of that app; `tickets/apply-template/` returns a prefill payload
  that feeds the normal `create_ticket` path. (Apply does not mutate an existing ticket.)
- **itsm-projects** — `TicketTemplate.project`/`ticket_type` scope.
- **itsm-rbac** — gated by `itsm.tickets.templates`.

## Depended on by
- **itsm-tickets** — the create form's template picker (which calls `tickets/apply-template/` to
  prefill).

## Relation to canned notes
Sibling of **itsm-canned-notes**: templates seed a *ticket*; canned notes seed a *comment*. Both are
content libraries on the tickets domain, both reuse the sanitize-on-save discipline.
