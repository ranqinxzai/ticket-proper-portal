# itsm-notifications — API Contracts

**Status: BUILT** — router is live with all four endpoint groups (`notification-schemes`,
`notification-rules`, `email-templates`, `notifications` inbox). Shapes from the approved plan.
Base `/api/v1/itsm/`.

## Schemes / rules — `itsm.notifications.schemes`
- `GET|POST notification-schemes` — `{ id, name, project, is_default, rules:[NotificationRule] }`.
- `GET|POST notification-rules` — `{ id, scheme, event_type, recipients:[resolver...], template,
  channels:["in_app","email"], is_active }`.
  `event_type` ∈ TicketCreated/TicketUpdated/FieldChanged/StatusChanged/Assigned/CommentAdded/
  Resolved/Closed/SLAWarning/SLABreach/Mentioned.
  `recipients` resolvers ∈ requestor/assignee/group_members/group_lead/watchers/role/
  specific_users/mentioned.

## Email templates — `itsm.notifications.templates`
- `GET|POST email-templates` — `{ id, key, subject, body_html, body_text }` (sanitized on save).

## Inbox — `itsm.notifications.inbox` (Agent-accessible)
- `GET notifications` — current user's `InAppNotification`s `{ id, event_type, title, body, ticket,
  url, is_read, created_at }`.
- `POST notifications/{id}/read` → mark one read.
- `POST notifications/mark-all-read` → mark all read.
- `GET notifications/unread-count` → `{ "unread": n }`. `GET notifications?unread=1` filters to unread only.

## Error codes (intended)
- `403` — Agent editing schemes/templates (inbox is allowed).
- `400` — rule referencing an unknown event type / resolver / template.
- Note: `bus.emit` itself has **no error surface** — it never raises; failures are logged + retried
  via the outbox.
