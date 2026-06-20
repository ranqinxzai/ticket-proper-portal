# itsm-tickets — Bug Log / Gotchas

- **Ticket numbering uses `select_for_update` — keep it in a transaction.** `create_ticket` is
  atomic; `generate_ticket_number` locks the per-project `TicketSequence`. Calling numbering
  outside a transaction loses the concurrency guarantee. `ticket_number` is DB-unique as a backstop.
- **Private comments leak if you bypass the list action.** The `comments` list action filters to
  public unless the caller has `itsm.tickets.comments_private` read. The generic `CommentViewSet`
  (`/comments?ticket=`) is gated only by `itsm.tickets.comments` and does **not** apply the private
  filter — don't use it to render a ticket's comments for users who shouldn't see internal notes.
- **`first_responded_at` is stamped by the first PUBLIC comment only.** Internal comments don't set
  it (it's the SLA first-response signal). Stamped via a guarded `.update(... isnull=True)` so it's
  set at most once.
- **Status changes don't go through this app's services.** Use the workflow engine; `ticket_service`
  has no "change status" function. `assign` changes group/assignee only.
- **`CannedNote` / `TicketTemplate` aren't here yet.** The `itsm.tickets.templates` /
  `itsm.canned_notes` modules and the `apply-template`/`bulk`/`reopen` ticket actions are planned
  (M7); see the itsm-canned-notes / itsm-templates skills. There is currently no `tickets/seed.py`.
- **`project`/`ticket_type`/`status`/`workflow` are PROTECT.** You cannot delete those config rows
  while tickets reference them. Tickets soft-delete; they're never hard-removed via the API.
- **`TicketLink` directionality is manual.** Creating `blocks` does NOT auto-create the inverse
  `blocked_by` on the other ticket — both link types exist but the inverse must be added explicitly.
- **Attachment metadata is filled server-side in `perform_create`** from the uploaded file; don't
  trust client-supplied `size_bytes`/`content_type` — they're overwritten.
- **`assign` records old/new as `str(...)`** in the audit payload (UUIDs/None stringified); don't
  parse them as raw UUIDs without handling `"None"`.
