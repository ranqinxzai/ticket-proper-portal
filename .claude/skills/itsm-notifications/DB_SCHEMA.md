# itsm-notifications — DB Schema

**Status: BUILT** — all five models live in `models.py` and are migrated via
`migrations/0001_initial.py`. Models (all `BaseModel` unless noted); shapes from the approved plan.

> **2026-06-24 — per-project provisioning + channel enum (no schema change).** The Notifications
> settings tab introduced **no migration**: `NotificationChannel{in_app,email,whatsapp}` is a Python
> `TextChoices` constant (storage stays free-form JSON `channels` / `CharField channel`), and
> per-project config reuses these same models. Each project now owns a `NotificationScheme`
> (`is_default=False`) holding cloned rules that point at **project-owned** `EmailTemplate` copies
> (`is_system=False`); the global `is_default` scheme is the seed source + fallback. Provisioned by
> `seed.ensure_notification_scheme` / `backfill_notification_schemes`.

> **2026-06-25 — HTML email delivery (`migrations/0002`).** `NotificationOutbox` gained a
> **`rendered_html`** TextField. Until now the HTML body was rendered then discarded and only the
> plain-text part was sent. The bus now stores the rendered HTML and the flusher attaches it via
> `EmailMultiAlternatives.attach_alternative(html, "text/html")`. The per-event `body_html_template`
> holds only the **message** (sanitiser-safe `<p>`/`<strong>`); the branded chrome lives in the
> trusted shell (`services/email_layout.py` + `templates/itsm_notifications/email_base.html`) and is
> wrapped around it at send time — never sanitised, never in the DB. `backfill_email_templates` (a
> new `seed_itsm` step) overwrites **all** templates (system + project clones) by `event_type`.

## `NotificationScheme`
`name`, `description`, `project` (FK, nullable, CASCADE — per-project scope), `is_default`. Resolution
prefers the project scheme, falling back to the `is_default` one.

## `NotificationRule`
`scheme` (FK), `event_type` (CharField; the event enum), `recipients` (JSON list of resolver
specs), `template` (FK EmailTemplate), `channels` (JSON, e.g. `["in_app","email"]`), `is_active`.

## `EmailTemplate`
`key`, `subject`, `body_html` (sanitized on save), `body_text` (plain mirror). Rendered with a
whitelisted flat context + Django templating (autoescape + bleach); links are absolute via
`FRONTEND_BASE_URL`.

## `InAppNotification`
`recipient` (FK User), `event_type`, `title`, `body`, `ticket` (FK, nullable), `url`, `is_read`
(bool, db_index), `read_at`. Written synchronously in the emit transaction. Index `(recipient,
is_read)`.

## `NotificationOutbox` (durable queue)
`event_type`, `ticket` (FK, nullable), `recipient` (FK User), `channel` (email/in_app/…),
`rendered_subject`, `rendered_body` (plain text), **`rendered_html`** (the HTML alternative; sent via
`attach_alternative`), `status` (queued/sending/sent/failed/dead), `attempts`, `next_attempt_at`,
`last_error`, `dedupe_key`, `sent_at`. **Unique index on `dedupe_key`** (prevents double-send). The
flusher claims `queued` rows via `select_for_update(skip_locked=True)`.

## Indexes (intended)
`NotificationOutbox(status, next_attempt_at)` for the flusher claim; `dedupe_key` unique;
`InAppNotification(recipient, is_read)` for the unread-count.
