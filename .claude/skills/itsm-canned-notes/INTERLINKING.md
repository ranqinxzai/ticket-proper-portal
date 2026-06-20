# itsm-canned-notes — Interlinking (BUILT)

## Depends on
- **itsm-core** — `BaseModel`, `sanitize_html`/`html_to_text` for the snippet body.
- **itsm-tickets** — physically part of that app; snippets are inserted into the `Comment` composer
  and posted via `tickets/{id}/comments/`.
- **itsm-rbac** — gated by `itsm.canned_notes` (child of `itsm.tickets`).

## Depended on by
- **itsm-tickets** — the comment composer's canned-note inserter.

## Relation to templates
Sibling feature to **itsm-templates**: canned notes seed a *comment*; ticket templates seed a *new
ticket*. Both are content libraries layered onto the tickets domain.
