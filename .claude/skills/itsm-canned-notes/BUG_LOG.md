# itsm-canned-notes — Bug Log / Gotchas (BUILT)

- **Built.** The `itsm.canned_notes` RBAC module is seeded and the `CannedNote`/`CannedNoteCategory`
  models + `canned-notes`/`canned-note-categories` routes are live (`itsm_tickets`, migration `0002`).
- **Sanitize on create, like comments.** A canned note is rich text that ends up as a comment —
  `perform_create` runs it through `itsm_core.sanitize_html` (and derives `body_text`) so a malicious
  snippet can't smuggle script into a comment.
- **Placeholders resolve client-side.** If `{{...}}` variables are supported, they're substituted in
  the composer at insert time from the open ticket; the stored note keeps the raw placeholders.
- **Agents can create/edit but not delete** (per seeded grants). Use `is_shared=False` to retire a
  snippet rather than expecting agents to delete it.
- **Insertion isn't a server action.** There's no "apply canned note" endpoint; the comment goes
  through the normal comments path, so canned-note content is subject to the same public/private
  visibility rules.
