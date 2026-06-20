# itsm-canned-notes — API Contracts (BUILT)

**Status: implemented.** Endpoints live under base `/api/v1/itsm/`.
Module: `itsm.canned_notes` (Agent: read/create/update; Supervisor: + delete).

## Canned notes
### `GET|POST canned-notes` · `.../{id}`  search `?search=` (title/body_text/shortcut)  filter `?category=&is_shared=`
`{ id, title, body_html, body_text, shortcut, category, is_shared, owner, usage_count, created_at }`.
On create, `body_html` is sanitized (`sanitize_html`), `body_text` is derived (`html_to_text`), and
`owner` is set to the requesting user.

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
