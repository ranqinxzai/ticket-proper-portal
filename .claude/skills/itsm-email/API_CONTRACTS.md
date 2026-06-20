# itsm-email — API Contracts

**Status: BUILT** — router is live with all four endpoint groups (`email-channels`, `email-rules`,
`inbound-emails`, plus the top-level `email/oauth/callback/`). Base `/api/v1/itsm/`.

## Channels — `itsm.email.channels` (Supervisor-only)
- `GET|POST email-channels` — `{ id, name, address, protocol("imap"|"pop3"), host, port, use_ssl,
  auth_type("basic"|"google"|"microsoft"), username, password(write-only), oauth_status,
  default_requestor, create_users(bool), is_active, last_polled_at, created_at, updated_at }`.
  **Secrets are write-only:** `password` / OAuth tokens accept on write, are masked/omitted on read.
- `GET|PUT|PATCH|DELETE email-channels/{id}` — DELETE is **soft**.
- `POST email-channels/{id}/test-connection/` → `{ "ok": true }` or `{ "ok": false, "error": "…" }`
  (connect + authenticate without ingesting).
- `POST email-channels/{id}/poll-now/` → triggers an immediate inbound poll → `{ "fetched": n,
  "processed": n, "ignored": n, "failed": n }`.
- `POST email-channels/{id}/oauth/start/` → `{ "authorize_url": "https://…" }` (Google/MS consent URL).

## OAuth callback — `itsm.email.channels`
- `GET email/oauth/callback/?code=…&state=…` → exchanges the code, stores encrypted access+refresh
  tokens on the channel, → redirect/`{ "ok": true }`. Top-level (not nested) because the provider
  redirects here per `EMAIL_OAUTH_REDIRECT_URI`.

## Rules — `itsm.email.channels` (Supervisor-only)
- `GET|POST email-rules` — `{ id, channel, rule_type("allow"|"block"), match_field("from"|"domain"|
  "subject"), pattern, is_active }`. Applied per channel before ingestion; block wins.
- `GET|PUT|PATCH|DELETE email-rules/{id}`.

## Inbound log — `itsm.email.logs` (Agent read-only)
- `GET inbound-emails` — `{ id, channel, message_id, from_address, subject, received_at,
  status("received"|"processed"|"ignored"|"failed"), ignore_reason, action_taken("created_ticket"|
  "added_comment"|null), ticket, comment, attempts, last_error, created_at }`.
  Filters: `channel`, `status`; search: `from_address`, `subject`, `message_id`; order: `-created_at`.
- `GET inbound-emails/{id}` — adds the parsed body preview + attachment metadata.
- `POST inbound-emails/{id}/retry/` → re-runs ingestion for a `failed` row → updated `InboundEmail`.
  (Idempotency by `(channel, message_id)` still applies — a retry never double-creates.)

## Error codes
- `403` — Agent editing channels/rules (logs are read-only Agent-accessible; retry is Agent-allowed on
  the logs surface).
- `400` — bad protocol/auth combination; OAuth start on a `basic` channel; rule with unknown field.
- `502/400` — `test-connection` / `poll-now` connection or auth failure (surfaced as `{ ok:false,
  error }`).
- Note: ingestion itself has **no synchronous error surface** to the sender — failures are recorded on
  the `InboundEmail` row and retried by the scheduler.
