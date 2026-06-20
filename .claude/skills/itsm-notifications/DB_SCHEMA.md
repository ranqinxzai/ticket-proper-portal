# itsm-notifications — DB Schema

**Status: BUILT** — all five models live in `models.py` and are migrated via
`migrations/0001_initial.py`. Models (all `BaseModel` unless noted); shapes from the approved plan.

## `NotificationScheme`
`name`, `project` (FK, scope), `is_default`. One active scheme resolved per project.

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
`channel` (email/in_app/…), `payload` (JSON: recipient, subject, body, deep-link), `status`
(queued/sent/dead), `attempts`, `next_attempt_at`, `dedupe_key`. **Unique index on `dedupe_key`**
(prevents double-send). The flusher claims `queued` rows via `select_for_update(skip_locked=True)`.

## Indexes (intended)
`NotificationOutbox(status, next_attempt_at)` for the flusher claim; `dedupe_key` unique;
`InAppNotification(recipient, is_read)` for the unread-count.
