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
- **From-address precedence (2026-06-28)** — resolved per row at send time:
  **mailbox `from_header`** (`hooks.email_outbound_transport`, set only when the ticket's project has
  an outbound `EmailChannel`) → **helpdesk `notification_from_header`** (`_helpdesk_from(ticket)` reads
  `ticket.project.helpdesk`, the per-helpdesk "Email Notification" setting; never raises) → global
  **`DEFAULT_FROM_EMAIL`**. The mailbox wins whenever one is configured; the helpdesk From only
  replaces the global default when there's no mailbox. Reply-To/threading headers are unaffected. See
  itsm-email for the channel side and the **Settings → Email Notification** page.

## Events
`TicketCreated`, `TicketUpdated`, `FieldChanged`, `StatusChanged`, `Assigned`, `CommentAdded`
(+ `CommentAddedPrivate`), `Resolved`, `Closed`, `SLAWarning`, `SLABreach`, `Mentioned`.

## Recipient resolvers
`requestor`, `assignee`, `group_members`, `group_lead`, `watchers`, `role`, `specific_users`,
`mentioned`. Dedupe by user id; suppress the actor by default.

## Per-project configuration (2026-06-24 — BUILT)
- **Notifications is now a project-settings tab.** Each project gets its **own** editable
  `NotificationScheme` (a clone of the global default's rules + **project-owned** `EmailTemplate`
  copies), so toggling/editing one project never affects another. The global `is_default` scheme
  stays as the seed source + fallback (`bus._scheme_for` already prefers the project scheme).
- **Provisioning** is idempotent via `seed.ensure_notification_scheme(project)`, called from
  `ProjectViewSet.perform_create` (new projects) and `seed.backfill_notification_schemes()` (a new
  `seed_itsm` step after the projects/layout steps — the backfill path for existing projects). The
  `notification-schemes/for-project` endpoint also self-heals on first open.
- **Default templates now cover all 11 events** (was 5) with text **and** HTML bodies, and a
  `TicketUpdated` default rule was added — so the matrix is fully pre-configured out of the box.

## Branded HTML email (2026-06-25 — BUILT)
- **HTML is now actually delivered.** Previously the HTML body was rendered then discarded and only
  plain text was sent. `NotificationOutbox` gained `rendered_html` (`migrations/0002`); the bus stores
  it and `outbox.flush` attaches it via `EmailMultiAlternatives.attach_alternative(html, "text/html")`.
- **Design lives in a trusted shell, not the DB.** The editable `body_html_template` holds only the
  per-event **message** (sanitiser-safe `<p>`/`<strong>`); `templates.render` wraps it at send time in
  `services/email_layout.py` → `templates/itsm_notifications/email_base.html` (table-based, inline-styled,
  Outlook-safe): "One Helpdesk" wordmark header, a per-event accent colour (`EVENT_ACCENTS`: blue / green
  for resolved-closed / amber SLA-warning / red SLA-breach), a ticket-details card, a bulletproof CTA
  button, and a footer. This keeps the chrome out of reach of the bleach sanitiser + Tiptap editor and
  DRY across all events; admin edits only touch the message.
- **Role-aware deep links.** `templates.build_ticket_path(ticket, recipient)` uses `connection.schema_name`:
  the **requestor** → `/t/{org}/portal/requests/{n}`, other (staff) recipients → `/t/{org}/agent/w/{helpdesk}/p/{project}/{n}`.
  Fixes the old dead `/tickets/{n}` link for both the email CTA and the in-app bell link. **Keep the
  `[{{ ticket.number }}]` subject prefix** — itsm_email threads replies via that token.
- **Rollout = overwrite all.** `seed.backfill_email_templates()` (a new `seed_itsm` step after the
  per-project backfill) force-updates **every** template (system + project clones) by `event_type`.
- **Preview fidelity.** `components/settings/email-shell-preview.tsx` mirrors the backend shell so the
  Notifications-tab template dialog's Preview ≈ the sent email.
- **Channel enum** `NotificationChannel{in_app,email,whatsapp}` (Python constant; storage stays
  free-form JSON). Rule serializer validates channels + recipients.
- **WhatsApp = groundwork only.** A `whatsapp` channel value + a disabled "Coming soon" UI toggle +
  a **no-op** branch in `bus._emit` (it intentionally does NOT enqueue — the outbox flusher only
  sends email, so a rule listing whatsapp is safe and simply produces nothing). No config model, no
  migration, no settings. Future: a transport + per-project config + outbox channel branch.

## Frontend path / pages (BUILT — config tab)
- **Notifications tab** in project settings (`settings/projects/[projectKey]?tab=notifications`):
  `components/settings/notifications-editor.tsx` — a per-event matrix (enable/disable, channel chips
  incl. WhatsApp-disabled, recipient chips, notify-actor, and an **email-template dialog** with a
  subject + the shared Tiptap `rich-text-editor.tsx` and an **Edit/Preview** toggle). Gated by
  `itsm.notifications.schemes` (rules) + `itsm.notifications.templates` (template edits) — both
  Supervisor-only, so the tab is read-only for Agents (it skips the fetch when the user lacks read).
  API clients `notificationSchemesApi`/`notificationRulesApi`/`emailTemplatesApi` in `lib/itsm/api.ts`;
  types in `lib/itsm/types.ts`.
- *(Still planned: notification bell + in-app inbox popover; `@mention` wiring in the composer.)*

## API clients
Live endpoints under `/api/v1/itsm/`: `notification-schemes` (+ `metadata`, `for-project` actions),
`notification-rules`, `email-templates`, and the in-app inbox `notifications` (ReadOnly, scoped to
`request.user`) with custom actions `GET notifications/unread-count`, `POST notifications/{id}/read`,
`POST notifications/mark-all-read`, plus a `?unread=1` filter.

## RBAC module codes
- Schemes/rules → **`itsm.notifications.schemes`**; templates → **`itsm.notifications.templates`**;
  the personal inbox → **`itsm.notifications.inbox`** (Agent has inbox access; schemes/templates are
  Supervisor-only).

## Key files
`models.py` (scheme/rule/template/in-app/outbox + `rendered_html`), `services/bus.py`,
`services/recipients.py`, `services/templates.py` (render + `build_ticket_path` + shell wrap),
`services/email_layout.py` (`EVENT_ACCENTS` + `wrap`), `templates/itsm_notifications/email_base.html`
(branded shell), `services/outbox.py` (attaches HTML alternative), `serializers.py`, `views.py`,
`urls.py`, `seed.py` (`backfill_email_templates`), `scheduler.py`,
`migrations/0001_initial.py` + `0002_notificationoutbox_rendered_html.py`. Frontend:
`components/settings/notifications-editor.tsx` + `components/settings/email-shell-preview.tsx`.
