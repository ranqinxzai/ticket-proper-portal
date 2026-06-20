# itsm-notifications — Bug Log / Gotchas

- **Built and live.** `itsm_core.hooks.emit_event` now actually calls `bus.emit` (wrapped in
  `_safe`); the engine resolves schemes → rules → recipients and writes in-app rows + enqueues
  email. Domain events (TicketCreated/Assigned/StatusChanged/CommentAdded/Mentioned) are now
  delivered rather than dropped.
- **`bus.emit` must never raise.** It logs and swallows internally; the `itsm_core` hook wraps it in
  `_safe` too (belt and braces). A template render error must not 500 a ticket transition.
- **Emit only inside `transaction.on_commit`.** Notifying on a not-yet-committed (or rolled-back)
  write would email people about changes that didn't happen. The existing services already call the
  hook post-commit.
- **Dedupe twice: by user id (in emit) and by `dedupe_key` (in the outbox).** Recipient resolvers
  overlap (a watcher who is also the assignee); dedupe by user before enqueue, and rely on the
  outbox `dedupe_key` unique index as the last line against double-send.
- **Suppress the actor by default.** Don't notify the person who caused the event unless a rule opts
  in — otherwise every self-action pings the actor.
- **Outbox flusher must use `select_for_update(skip_locked=True)`.** Multiple flusher ticks /
  workers must not grab the same row; skip-locked lets them drain in parallel safely. A reaper must
  reset rows stuck in-flight after a crash.
- **Private comments use a distinct event.** `add_comment` emits `CommentAddedPrivate` for internal
  notes — rules must not surface internal-note bodies to requestors/end-users.
- **Templates are sanitized + autoescaped + absolute-linked.** Render through bleach + Django
  autoescape; build deep-links from `FRONTEND_BASE_URL`, never relative paths (emails have no base).
- **`outbox.flush` now sends via `EmailMultiAlternatives` + the `email_thread_headers` hook.** For
  the email channel (`itsm-email`) it stamps `Message-ID`/`In-Reply-To`/`References` + a plus-addressed
  `Reply-To` so customer replies thread back to the ticket. The hook is **one-way and lazy**: when no
  `EmailChannel` exists it returns `{}` and the sent mail must remain **byte-identical** to the old
  `send_mail` path — do not add unconditional headers or notifications regress on no-email installs.
