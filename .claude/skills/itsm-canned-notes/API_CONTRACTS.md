# itsm-canned-notes — API Contracts (BUILT)

**Status: implemented.** Endpoints live under base `/api/v1/itsm/`.
Module: `itsm.canned_notes` (Agent: read/create/update; Supervisor: + delete).

## Canned notes
### `GET|POST canned-notes` · `.../{id}`  search `?search=` (title/body_text/shortcut)  filter `?category=&scope=&helpdesk=&project=&is_shared=`
```
{ id, title, body_html, body_text, shortcut,
  category, category_name,
  scope, scope_label,            # personal|workspace|project ; "Personal"|"Workspace"|"Project"
  helpdesk, helpdesk_name,       # badge label (nullable)
  project, project_name,         # badge label (nullable)
  is_shared,                     # READ-ONLY — server-derived from scope
  owner, usage_count, created_at }
```
On create, `body_html` is sanitized (`sanitize_html`), `body_text` is derived (`html_to_text`), and
`owner` is set to the requesting user. **`scope` derives the rest** (in `serializer.validate`):
`personal` → both FKs null + `is_shared=False`; `workspace` → `is_shared=True`, optional helpdesk
label (null = all workspaces); `project` → requires `project`, **derives `helpdesk` from
`project.helpdesk`** (client helpdesk ignored), `is_shared=True`. `is_shared` is never client-set.
On update, `perform_update` re-sanitizes the body when `body_html` changes.

**Visibility (queryset):** `GET canned-notes` returns `is_shared=True OR owner=me` — every agent
sees every shared (workspace|project) note regardless of membership; `personal` notes are visible
only to their owner. Deleting another agent's personal note 404s (it isn't in your queryset).

## Categories
### `GET|POST canned-note-categories` · `.../{id}`
`{ id, name, sort_order, is_active }`.

## Usage
### `POST canned-notes/{id}/use/`
Increments `usage_count` (via `F()`); returns `{ "ok": true }`. Call when a note is inserted into a
comment. There is no dedicated "insert" endpoint — the composer fetches `canned-notes`, injects the
chosen snippet's HTML, and the comment is posted via `POST tickets/{id}/comments/` as normal.

## Error codes (intended)
- `403` — Agent attempting a delete (read/create/update allowed).
- `400` — missing title/body.
