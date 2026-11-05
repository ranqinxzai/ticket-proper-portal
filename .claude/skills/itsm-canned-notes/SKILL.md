# itsm-canned-notes

## Update (2026-10-18) — Bug-fix batch: picker shows org-wide + personal notes, scope badges
- **C4/U11.** `CannedNoteViewSet.get_queryset` accepts `?for_helpdesk=<uuid>` = this helpdesk's notes + org-wide (null helpdesk) + own personal.
  - `?helpdesk=` stays an exact match, which hid both.
  - An invalid id is ignored. The membership clamp still applies, so it can't widen.
- **Picker.** `canned-response-picker.tsx` calls `cannedNotesApi.list({ for_helpdesk, page_size: 200 })` (was capped at 25) and groups results. **`components/canned-notes/scope-badge.tsx` is back**: `cannedScopeOf(note)` gives personal / project / helpdesk / organisation, and `<CannedScopeBadge>` renders it with a Hint.
- **Wording.** The canned-note delete confirm wording is aligned.
- Supersedes: the 2026-06-25 "Removed: … `scope-badge.tsx`", and the composer note that the picker lists with `{ helpdesk }`.
- Batch context: `docs/BUG_LOG.md` "2026-10-18 — Bug-fix batch"; QA: `docs/QA_CHECKLIST.md` "Bug-fix batch (added 2026-10-18)".

## Update (2026-10-18b) — Canned notes in automation comments
- An automation rule's **Add comment** action can reference a **shared** canned note (`is_shared=True`, i.e. workspace or project scope; personal notes are refused).
- Its *current* `body_html` is used each time the rule runs. `usage_count` is not bumped.
- The editor lists `cannedNotesApi.list({helpdesk})` filtered to `is_shared`. See **itsm-automation**.

## Update (2026-10-18) — Canned notes hover help + shortcut copy fix
- **Admin list:** edit and delete are `IconButton`s, and delete still confirms. The /shortcut chip has a Hint, and title and body carry `title`.
- **Shortcut copy:** the hint now reads "Optional keyword — type it in the Canned response search to find this reply fast". It used to imply a "/ack" slash command, which doesn't exist; the shortcut only matches the picker search.
- **Note dialog:** submit is disabled with a reason ("Add a title and a body first"). Before, it silently did nothing.
- **Composer picker:** the trigger hints "Insert a saved reply at the cursor".
- Primitives: `ui/hint.tsx` (`Hint`), `ui/icon-button.tsx` (`IconButton`), `ui/info-tip.tsx` (`InfoTip`); copy in `lib/itsm/help/*`. Rules + verification: `docs/QA_CHECKLIST.md` "Hover help / tooltips (2026-10-18)". Behaviour mismatches found (not fixed) are listed in `docs/BUG_LOG.md` 2026-10-18 — tooltips describe the REAL behaviour.

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
  `is_shared` (server-derived from scope), `owner`, `usage_count`. Inserted as **literal HTML** — no
  variable-placeholder substitution (e.g. `{{ticket_number}}`) is implemented (possible follow-up).
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
- **Composer inserter — BUILT (2026-06-28):** `components/canned-notes/canned-response-picker.tsx` — a
  **"Canned response"** button in the ticket-detail comment composer action bar (next to "Attach
  files") that opens a searchable `Popover` of the helpdesk's snippets (`cannedNotesApi.list({helpdesk})`,
  client-filtered by title/shortcut/body_text, grouped by category). Picking one calls
  `onInsert(body_html)` and fires `cannedNotesApi.use(id)` for usage tracking. Gated in
  `ticket-detail.tsx` on `hasPerm("itsm.canned_notes","read")` && a current helpdesk; works for both
  Public Comment and Internal Note (same composer). Insertion is at the cursor via a new imperative
  handle on the shared editor: `RichTextEditor` is now a `forwardRef` exposing
  `RichTextEditorHandle { insertContent(html), focus() }` (`editor.chain().focus().insertContent(html).run()`,
  which fires `onChange` so the draft stays in sync). The `ref` is optional — other `RichTextEditor`
  callers are unaffected.

## API clients
`canned-note-categories`, `canned-notes`, and the `POST canned-notes/{id}/use/` action (increments
`usage_count`).

## RBAC module codes
**`itsm.canned_notes`** — already defined in `itsm_rbac/registry.py` (child of `itsm.tickets`).
Agent: read/create/update (no delete); Supervisor: full.

## Key files
`CannedNote` + `CannedNoteCategory` models in `itsm_tickets/models.py`, plus serializers/views/urls
(`CannedNoteViewSet`, `CannedNoteCategoryViewSet`). Frontend: management UI in
`components/canned-notes/canned-notes-admin.tsx` + `canned-note-dialog.tsx`; the **composer inserter**
in `components/canned-notes/canned-response-picker.tsx`, wired into
`components/tickets/ticket-detail.tsx` via the `RichTextEditorHandle.insertContent` imperative handle
on `components/ui/rich-text-editor.tsx`. Bodies use `itsm_core.sanitize_html` like comments.
