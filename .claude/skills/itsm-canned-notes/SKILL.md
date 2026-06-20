# itsm-canned-notes

## Purpose
Reusable comment snippets ("canned responses") an agent can insert into the comment composer,
organized by category. **Status: BUILT.** `CannedNote`/`CannedNoteCategory` live in the
**`itsm_tickets`** app (models in `itsm_tickets/models.py`, migration `0002`). This skill captures
the design and the already-seeded RBAC module.

## Backend app path
`backend/apps/itsm_tickets/` (models live here alongside `Comment`).

## Key concepts
- **`CannedNoteCategory`** — grouping for the snippet library (e.g. "Acknowledgements",
  "Resolutions").
- **`CannedNote`** — `title`, `body_html` (sanitized on create) + `body_text` mirror, `shortcut`,
  `category`, `is_shared`, `owner`, `usage_count`. Inserted into the Tiptap comment composer; may
  support simple variable placeholders (e.g. `{{ticket_number}}`, `{{requestor}}`).

## Frontend path / pages (planned)
A canned-note library editor under `admin/.../canned-notes`; an inserter button in the ticket
detail comment composer.

## API clients
`canned-note-categories`, `canned-notes`, and the `POST canned-notes/{id}/use/` action (increments
`usage_count`).

## RBAC module codes
**`itsm.canned_notes`** — already defined in `itsm_rbac/registry.py` (child of `itsm.tickets`).
Agent: read/create/update (no delete); Supervisor: full.

## Key files
`CannedNote` + `CannedNoteCategory` models in `itsm_tickets/models.py`, plus serializers/views/urls
(`CannedNoteViewSet`, `CannedNoteCategoryViewSet`); the composer inserter lives on the frontend.
Bodies use `itsm_core.sanitize_html` like comments.
