# itsm-canned-notes — Architecture (BUILT)

## Current state
Built. The RBAC module `itsm.canned_notes` is seeded, and the `CannedNote`/`CannedNoteCategory`
models live in `itsm_tickets/models.py` (migration `0002`).

## Layout
```
itsm_tickets/
  models.py        # CannedNoteCategory, CannedNote
  serializers.py   # CannedNote(Category)Serializer
  views.py         # CannedNoteViewSet (module_code="itsm.canned_notes"), CannedNoteCategoryViewSet
  urls.py          # canned-notes, canned-note-categories
```

## Design decisions
- **Lives in `itsm_tickets`, not a new app.** Canned notes are a thin, comment-adjacent feature; the
  plan groups them under the tickets domain and the RBAC tree (`itsm.canned_notes` is a child of
  `itsm.tickets`).
- **Same rich-text discipline as comments.** On create, `CannedNoteViewSet.perform_create` sanitizes
  `body_html` via `itsm_core.sanitize_html` and derives the `body_text` plain mirror via
  `html_to_text`, and sets `owner` to the requesting user — so an inserted snippet renders safely in
  the composer and the resulting comment.
- **Insertion is a frontend action, not a special endpoint.** The composer fetches the library and
  injects the snippet's HTML into the Tiptap document; the resulting comment is posted through the
  normal `tickets/{id}/comments/` path. No server-side "apply canned note" call is required. The
  lightweight `POST canned-notes/{id}/use/` action increments `usage_count` (via `F()`) for ranking.
- **Sharing + categories** keep large libraries navigable: `is_shared` controls visibility and
  `category` groups snippets; `owner` records who created the note. `usage_count` tracks how often a
  note is inserted.
- **Agent-writable.** Per the seeded grants, agents can read/create/update canned notes (they
  curate their own responses); only Supervisors can delete.

## Variable placeholders (optional)
The plan allows simple placeholders resolved client-side at insert time
(`{{ticket_number}}`/`{{requestor}}`/`{{assignee}}`) from the open ticket's context.
