# itsm-notifications — API Contracts

**Status: BUILT** — router is live with all four endpoint groups (`notification-schemes`,
`notification-rules`, `email-templates`, `notifications` inbox). Shapes from the approved plan.
Base `/api/v1/itsm/`.

## Schemes / rules — `itsm.notifications.schemes`
- `GET|POST notification-schemes` — `{ id, name, description, project, is_default, rules:[NotificationRule] }`.
- `GET notification-schemes/metadata` — catalog driving the settings matrix:
  `{ events:[{value,label}×11], recipients:[{value,label}×6], channels:[{value,label,available,coming_soon}] }`.
  `whatsapp` is returned with `available:false, coming_soon:true` (groundwork only).
- `GET notification-schemes/for-project?project=<id>` — the project's scheme, **auto-provisioning**
  the per-project clone (rules + project-owned templates) on first access. The single call the
  Notifications settings tab makes on open. Writes on a GET (self-healing, mirrors layout backfill).
- `GET|POST|PATCH notification-rules` — `{ id, scheme, event_type, recipients:[resolver...],
  email_template, channels:["in_app","email","whatsapp"?], notify_actor, is_active }`.
  `event_type` ∈ TicketCreated/TicketUpdated/StatusChanged/Assigned/CommentAdded/CommentAddedPrivate/
  Mentioned/Resolved/Closed/SLAWarning/SLABreach.
  `recipients` resolvers ∈ requestor/assignee/assigned_group/group_lead/watchers/mentioned (+ dict
  forms `{"users":[…]}`/`{"role":"code"}` accepted but not surfaced in the v1 UI).
  **Validation:** `validate_channels` rejects values outside `NotificationChannel` (`whatsapp` is
  *allowed* — forward-compatible; the UI disables it). `validate_recipients` rejects unknown selector
  strings.

## Email templates — `itsm.notifications.templates`
- `GET|POST|PATCH email-templates` — `{ id, name, event_type, subject_template, body_html_template,
  body_text_template, is_system }`. `body_html_template` is **bleach-sanitised on save**
  (`sanitize_html`); `is_system` is read-only. Per-project rules reference project-owned (`is_system=
  false`) clones, so editing one project's template never affects another's.

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
