# itsm-notifications

## Purpose
Rich notification engine: per-project schemes → rules per event → recipient resolution →
templated in-app + email delivery through a durable transactional outbox + scheduled flusher.
**Status: BUILT** — `backend/apps/itsm_notifications/` is fully implemented and validated:
`models.py`, `services/` (`bus`, `recipients`, `templates`, `outbox`), scheduler jobs, seed,
serializers/views/urls, and `migrations/0001_initial.py`. This skill documents the design
(plan deliverable 9). The single entry point it exposes — `bus.emit` — is now called for real
(via `itsm_core.hooks.emit_event`) from the ticket / comment / workflow services.

## Backend app path
`backend/apps/itsm_notifications/` (built — the engine is live).

## Key concepts
- **`NotificationScheme`/`NotificationRule`** — a scheme (per project) holds active rules; each rule
  binds an event type to recipient resolvers + a template.
- **`EmailTemplate`** — subject/body templates (Django templating, autoescape + bleach,
  absolute deep-links).
- **`InAppNotification`** — the bell/inbox row (written synchronously in the same txn).
- **`NotificationOutbox`** — durable queue rows for email/in-app, drained by the flusher;
  `dedupe_key` unique prevents double-send.
- **`bus.emit(event_type, ticket, context, actor)`** — the single choke-point; resolves scheme →
  rules → recipients → renders → writes in-app + enqueues email. **Never raises into callers.**
- **`outbox.flush()`** — claims `queued` rows with `select_for_update(skip_locked=True)`, sends via
  a channel registry, backoff + `dead` after max attempts; a reaper resets stuck rows.

## Events
`TicketCreated`, `TicketUpdated`, `FieldChanged`, `StatusChanged`, `Assigned`, `CommentAdded`
(+ `CommentAddedPrivate`), `Resolved`, `Closed`, `SLAWarning`, `SLABreach`, `Mentioned`.

## Recipient resolvers
`requestor`, `assignee`, `group_members`, `group_lead`, `watchers`, `role`, `specific_users`,
`mentioned`. Dedupe by user id; suppress the actor by default.

## Frontend path / pages (planned)
Notification bell + in-app inbox popover; Notification Scheme Editor + Tiptap email-template editor;
`@mention` wiring in the comment composer.

## API clients
Live endpoints under `/api/v1/itsm/`: `notification-schemes`, `notification-rules`,
`email-templates`, and the in-app inbox `notifications` (ReadOnly, scoped to `request.user`)
with custom actions `GET notifications/unread-count`, `POST notifications/{id}/read`,
`POST notifications/mark-all-read`, plus a `?unread=1` filter.

## RBAC module codes
- Schemes/rules → **`itsm.notifications.schemes`**; templates → **`itsm.notifications.templates`**;
  the personal inbox → **`itsm.notifications.inbox`** (Agent has inbox access; schemes/templates are
  Supervisor-only).

## Key files
`models.py` (scheme/rule/template/in-app/outbox), `services/bus.py`, `services/recipients.py`,
`services/templates.py`, `services/outbox.py`, `serializers.py`, `views.py`, `urls.py`,
`seed.py`, `scheduler.py` (outbox flush + reaper jobs), `migrations/0001_initial.py`.
