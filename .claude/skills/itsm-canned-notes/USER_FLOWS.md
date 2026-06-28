# itsm-canned-notes — User Flows (BUILT)

## Flow A — Curate the library (management page — BUILT)
1. Agent opens **Canned Responses** from the agent Home card → `agent/canned-responses`.
2. Clicks **New response**, fills title + body (rich text) + optional shortcut/category, and picks a
   **scope**:
   - **Workspace** → optionally tag a helpdesk (label); shared with all agents → "Workspace" badge.
   - **Project** → pick a project (helpdesk derived server-side); shared → "Project" badge.
   - **Personal** → private to the creator; no badge.
3. `POST canned-notes` `{ title, body_html, shortcut?, category?, scope, helpdesk?, project? }`.
   Body is sanitized server-side (and `body_text` derived); `is_shared` is set from scope. The list
   shows each response with its scope badge. Edit re-opens the dialog; **delete is supervisor-only**.

## Flow B — Insert into a reply (composer inserter — PLANNED)
1. In the ticket detail comment composer, the agent clicks the canned-note inserter.
2. Picks a snippet from the (optionally project-scoped, categorized) list.
3. The snippet's HTML is injected into the Tiptap document (placeholders like `{{ticket_number}}`
   resolved from the open ticket).
4. The agent edits if needed and posts → normal `POST tickets/{id}/comments/` (public or internal).
   `POST canned-notes/{id}/use/` bumps the snippet's `usage_count`.

## Flow C — Retire a snippet
Set scope to **Personal** (→ `is_shared=False`, leaves the shared library) or have a Supervisor
delete it; existing comments already posted are unaffected.
