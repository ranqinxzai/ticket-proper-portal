# itsm-canned-notes — User Flows (BUILT)

## Flow A — Curate the library
1. Agent/Supervisor opens `admin/.../canned-notes`.
2. Creates categories, then `POST canned-notes` `{ title, body_html, category }`.
3. Body is sanitized server-side (and `body_text` derived); `is_shared` toggles availability.

## Flow B — Insert into a reply
1. In the ticket detail comment composer, the agent clicks the canned-note inserter.
2. Picks a snippet from the (optionally project-scoped, categorized) list.
3. The snippet's HTML is injected into the Tiptap document (placeholders like `{{ticket_number}}`
   resolved from the open ticket).
4. The agent edits if needed and posts → normal `POST tickets/{id}/comments/` (public or internal).
   `POST canned-notes/{id}/use/` bumps the snippet's `usage_count`.

## Flow C — Retire a snippet
Set `is_shared=False` (or Supervisor deletes) → it disappears from the shared picker; existing
comments already posted are unaffected.
