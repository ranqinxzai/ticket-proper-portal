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
  `category`, **`scope`** (`personal`/`workspace`/`project`) with **`helpdesk`/`project` label FKs**,
  `is_shared` (server-derived from scope), `owner`, `usage_count`. May support simple variable
  placeholders (e.g. `{{ticket_number}}`, `{{requestor}}`).
- **Helpdesk-isolated (2026-06-25).** Shared (workspace|project) notes are visible only to **members of
  the note's helpdesk**; org-wide shared notes (null helpdesk) stay visible to every agent; only
  `personal` notes are owner-private. The clamp lives in `CannedNoteViewSet.get_queryset` via
  `itsm_helpdesks.services.accessible_helpdesk_ids_cached` — a forged `?helpdesk=` can't widen it
  (`CannedNoteScopeApiTests`). The management UI is now **per-helpdesk** and creates only
  workspace-scoped notes pinned to the current helpdesk. (Previously: all shared notes were visible to
  every agent; the helpdesk/project FK was a badge label only.)

## Frontend path / pages
- **Management page — per-helpdesk Settings (2026-06-25):**
  `app/t/[org]/(agent)/agent/w/[helpdeskKey]/settings/canned-responses/page.tsx` (left-rail "Canned
  Responses" item in `components/settings/settings-nav.tsx` + a card on the settings landing). Renders
  `components/canned-notes/canned-notes-admin.tsx` (now takes a `helpdesk={id,name}` prop and lists
  `cannedNotesApi.list({helpdesk})`) + `canned-note-dialog.tsx` (locked to the current helpdesk — the
  scope/workspace/project picker was removed; every save is `scope="workspace"`, `helpdesk=<current>`).
  Read gates the list; create/update gate the editor; delete = supervisor.
- **Removed (2026-06-25):** the global page `agent/canned-responses`, the `agentCannedResponses` nav
  helper, `components/canned-notes/scope-badge.tsx`, and the Home "Canned Responses" card.
- **Composer inserter — still planned:** the button + picker in the ticket-detail comment composer
  is not built yet (a later change).

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
