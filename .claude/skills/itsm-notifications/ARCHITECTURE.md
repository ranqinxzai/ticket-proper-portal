# itsm-notifications — Architecture

## Current state
`backend/apps/itsm_notifications/` is **BUILT** and validated: `models.py` with all five models,
the `services/` package, scheduler jobs, seed, serializers/views/urls, and
`migrations/0001_initial.py`. Tables exist. Design below is the approved plan (deliverable 9).

## Layout
```
itsm_notifications/
  models.py       # NotificationScheme, NotificationRule, EmailTemplate, InAppNotification,
                  # NotificationOutbox  (single module, not a package)
  services/
    bus.py        # emit(event_type, ticket, context, actor)  ← the choke-point
    recipients.py # resolver fan-out (requestor/assignee/group_*/watchers/role/...)
    templates.py  # subject/body rendering, role-aware deep links, shell wrap
    email_layout.py # branded HTML shell: EVENT_ACCENTS + wrap() → render email_base.html
    outbox.py     # flush() (attaches HTML alternative), reap()
  templates/itsm_notifications/email_base.html  # trusted, inline-styled email chrome
  scheduler.py    # outbox_flush + outbox_reaper jobs
  serializers.py / views.py / urls.py / seed.py
  migrations/0001_initial.py, 0002_notificationoutbox_rendered_html.py
  apps.py  # ready() → should_run_scheduler() then start_scheduler() (outbox_flush + reaper)
```
`email` and `in_app` are the live delivery channels (the `channel` field on `NotificationOutbox`,
`channels` on `NotificationRule`); `webhook`/`slack` remain future design.

## Design decisions
- **Single choke-point `bus.emit`** — called from ticket/comment/workflow (and SLA) services inside
  `transaction.on_commit`. It **never raises** into callers (logs + swallows); the `itsm_core` hook
  wraps it too, so a notification failure can never break a ticket write.
- **Pipeline:** resolve `NotificationScheme` (per project) → active `NotificationRule`s for the event
  → recipient resolvers → **dedupe by user id** + **suppress actor by default** → render template
  (whitelisted flat context dict, Django templating, autoescape + bleach, absolute deep-links) →
  write `InAppNotification` synchronously (same txn) + enqueue email rows (subject + plain text +
  **HTML**) in the **transactional outbox**.
- **HTML email shell (2026-06-25).** The per-event `body_html_template` holds only the *message*
  (sanitiser-safe `<p>`/`<strong>`); `templates.render` wraps it at send time in a **trusted branded
  shell** (`services/email_layout.py` → `templates/itsm_notifications/email_base.html`): brand header,
  ticket-details card, accent colour per event, bulletproof CTA button, footer. The design lives in
  **code, not the sanitised DB field** — so it can't be stripped by bleach or mangled by the Tiptap
  editor, stays DRY across all 11 events, and survives admin edits (which only touch the message).
- **Role-aware deep links.** `templates.build_ticket_path(ticket, recipient)` builds the
  tenant-correct path from `connection.schema_name`: the **requestor** → `/t/{org}/portal/requests/{n}`,
  every other (staff) recipient → `/t/{org}/agent/w/{helpdesk}/p/{project}/{n}`. Used for both the
  email CTA and the in-app bell link (the old `/tickets/{n}` was a dead route under multi-tenancy).
- **Delivery = DB outbox + scheduled flusher** (chosen over inline send): at-least-once, survives
  restarts, decoupled from SMTP latency. `outbox.flush` (~30s) claims `queued` rows with
  `select_for_update(skip_locked=True)`, sends via Django's email backend, applies backoff
  (`[1,5,15,60,240]` minutes), marks `dead` after `settings.NOTIFICATIONS_MAX_ATTEMPTS` (default 6).
  A `dedupe_key` unique index prevents double-send; `outbox.reap` resets rows stuck in `sending`.
- **Channels:** `email` (Django email backend — console in dev, SMTP in prod) and `in_app` are the
  live channels today; `webhook`/`slack` are future stubs.
- **Storm control** (`batch_window_seconds` + digest job) is a future design idea, not yet built.

## Integration seam
Exposes `apps.itsm_notifications.services.bus.emit` matching the call in
`itsm_core.services.hooks.emit_event(event_type, ticket, actor=None, context=None)`. The hook now
actually calls `bus.emit` (wrapped in `_safe`). Events emitted by the domain: `TicketCreated`, `Assigned`,
`StatusChanged`, `CommentAdded`/`CommentAddedPrivate`, `Mentioned` (see `ticket_service` +
`workflows.engine`).

## Scheduler wiring
`AppConfig.ready()` calls `itsm_core.scheduler_boot.should_run_scheduler()` then `start_scheduler()`,
which registers two interval jobs on a `DjangoJobStore`: `notifications.outbox_flush`
(every `NOTIFICATIONS_OUTBOX_FLUSH_SECONDS`, default 30s) and `notifications.outbox_reaper`
(every 10 min), both `replace_existing=True, max_instances=1, coalesce=True`.
