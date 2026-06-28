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

## Scope dimension (migration `0004`)
- **`is_shared` is server-derived — never trust the client.** It's `read_only` on the serializer and
  set in `validate()` from `scope` (`scope != personal`). Letting a client set it would let an agent
  flip a personal note public (or hide a shared one).
- **Project scope derives its helpdesk server-side** (`project.helpdesk`); a client-sent helpdesk on
  project scope is ignored — prevents a mismatched badge.
- **FKs are `SET_NULL`, not CASCADE.** Deleting a helpdesk/project must NOT delete communal notes;
  the badge falls back to generic "Workspace"/"Project". (CASCADE here would silently wipe a shared
  library.)
- **Scope is the badge label, not an access filter.** Queryset is `is_shared OR owner=me`; helpdesk/
  project membership does NOT narrow the shared library (confirmed product rule: all agents see all
  shared). Object-level safety comes from the queryset — another agent's personal note 404s because
  it isn't in your queryset, so don't add a separate owner check (it would also block editing shared
  notes, which is allowed).
- **Legacy workspace + null helpdesk is valid.** Old `is_shared=True` notes backfill to
  `scope=workspace` with no helpdesk; the serializer/UI must tolerate a null helpdesk on workspace
  scope (badge shows generic "Workspace").
- **Orphaned personal note.** If a personal note's `owner` is deleted (`SET_NULL`), it becomes
  invisible to everyone (never `is_shared`, no owner). Acceptable; noted here.
- **Management page built; composer inserter still pending.** The CRUD page at
  `agent/canned-responses` exists; the in-composer picker does not — don't assume agents can insert
  a snippet into a reply yet.
