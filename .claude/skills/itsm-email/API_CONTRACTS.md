# itsm-email — API Contracts

**Status: BUILT** — router is live with all four endpoint groups (`email-channels`, `email-rules`,
`inbound-emails`, plus the top-level `email/oauth/callback/`). Base `/api/v1/itsm/`.

## Channels — `itsm.email.channels` (Supervisor write; Agent read-only via inheritance)
- `GET|POST email-channels` — `{ id, name, project, address, domain, effective_domain, is_active,
  protocol("imap"|"pop3"), host, port, use_ssl, username, folder,
  auth_method("basic"|"oauth_google"|"oauth_microsoft"), is_oauth, oauth_authorized,
  password(write-only), has_password,
  outbound_enabled, smtp_host, smtp_port, smtp_security("starttls"|"ssl"|"none"), smtp_username,
  smtp_password(write-only), has_smtp_password, smtp_from_name,
  create_users(bool), default_requestor, default_priority, priority_map(obj), default_group,
  max_attachment_bytes, field_mappings(read-only obj),
  strip_quotes, cc_watchers, reopen_policy, reopen_window_days, ignore_auto_replies, max_age_days,
  max_size_bytes, loop_window_min, loop_max_messages, poll_interval_seconds,
  last_polled_at, last_seen_uid, last_error, created_at }`.
  **Secrets are write-only:** `password` / `smtp_password` / OAuth tokens accept on write, are
  masked/omitted on read (only `has_password`/`has_smtp_password`/`oauth_authorized` booleans). Leaving
  a secret blank on update keeps the stored value. `field_mappings` surfaces every email→ticket mapping
  (subject→summary, body→description, sender→requestor[+create_if_missing], cc→watchers,
  attachments→attachments[+cap], priority→priority[+map+default]) so the UI can show them all.
- `GET|PUT|PATCH|DELETE email-channels/{id}` — DELETE is **soft**.
- `POST email-channels/{id}/test-connection/` → `{ "ok": bool, "detail": "…" }` (inbound IMAP/POP
  connect + authenticate without ingesting).
- `POST email-channels/{id}/test-smtp/` → `{ "ok": bool, "detail": "…" }` (outbound SMTP connect +
  authenticate, basic or XOAUTH2, without sending).
- `POST email-channels/{id}/poll-now/` → immediate inbound poll → `{ channel, processed, failed,
  error }`.
- `POST email-channels/{id}/oauth/start/` → `{ "authorize_url": "https://…" }` (Google/MS consent URL).

## OAuth callback — `itsm.email.channels`
- `GET email/oauth/callback/?code=…&state=…` → exchanges the code, stores encrypted access+refresh
  tokens on the channel, → redirect/`{ "ok": true }`. Top-level (not nested) because the provider
  redirects here per `EMAIL_OAUTH_REDIRECT_URI`.

## Rules — `itsm.email.channels` (Supervisor write)
- `GET|POST email-rules` — `{ id, channel(nullable), rule_type("allow"|"block"), pattern(glob),
  is_active, note, created_at }`. Applied per channel before ingestion; block wins; if any allow rule
  exists the sender must match one. A bare domain is stored as `*@domain`.
- `GET|PUT|PATCH|DELETE email-rules/{id}`. Filters: `channel`, `rule_type`, `is_active`.

## Inbound log — `itsm.email.logs` (Agent read-only)
- `GET inbound-emails` — list: `{ id, channel, from_addr, from_name, subject,
  status("received"|"processed"|"ignored"|"failed"), ignore_reason, action_taken("created_ticket"|
  "added_comment"|""), ticket, ticket_number, attempts, created_at, processed_at }`.
  Filters: `channel`, `status`, `from_addr`; search: `subject`, `from_addr`, `message_id`;
  order: `-created_at`.
- `GET inbound-emails/{id}` — detail adds `message_id, in_reply_to, references, to_addrs, cc_addrs,
  date_header, size_bytes, headers, body_text, comment, requestor, last_error, next_attempt_at`.
- `POST inbound-emails/{id}/retry/` → re-runs ingestion for a `failed` row → updated `InboundEmail`.
  (Idempotency by `(channel, message_id)` still applies — a retry never double-creates.)

## Error codes
- `403` — Agent editing channels/rules (Agents get **read-only** on channels/logs via the `itsm.email`
  parent grant). `retry` is a POST (create) on `itsm.email.logs` → Supervisor-only; Agents 403.
- `400` — OAuth start on a `basic` channel; invalid field.
- `test-connection` / `test-smtp` / `poll-now` connection or auth failures are returned as
  `{ "ok": false, "detail": "…" }` (HTTP 200), not an HTTP error.
- Note: ingestion itself has **no synchronous error surface** to the sender — failures are recorded on
  the `InboundEmail` row and retried by the scheduler.
