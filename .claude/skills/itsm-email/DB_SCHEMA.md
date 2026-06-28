# itsm-email — DB Schema

**Status: BUILT** — all four models live in `models.py` and are migrated via
`migrations/0001_initial.py`. All extend `BaseModel` (UUID PK + `created_at`/`updated_at` + soft delete).
Encrypted columns use `crypto.EncryptedField` (Fernet at rest).

## `EmailChannel`
| Field | Type | Notes |
|---|---|---|
| name | char | display label |
| project | FK Project | **PROTECT**; one mailbox per project (`related_name="email_channels"`) |
| address | email | the mailbox address (self-loop detect / outbound From / outbound **Reply-To**) |
| domain | char | override for the synthetic Message-ID host only (blank ⇒ address domain). Reply-To is the full `address`, not derived from this. |
| protocol | char | **enum** imap / pop3 |
| host, port | char / uint | inbound server (blank host ⇒ OAuth provider default) |
| use_ssl | bool | |
| username, folder | char | mailbox login + folder (default INBOX) |
| auth_method | char | **enum** basic / oauth_google / oauth_microsoft |
| password_enc | **EncryptedField** | basic auth secret (Fernet; write-only via API as `password`) |
| oauth_access_token_enc | **EncryptedField** | OAuth2 access token (Google/MS) |
| oauth_refresh_token_enc | **EncryptedField** | OAuth2 refresh token; drives automatic refresh |
| oauth_token_expiry | datetime | refresh trigger |
| oauth_authorized | bool | true once consent + tokens are stored |
| **outbound_enabled** | bool | send ack + agent replies FROM this mailbox |
| **smtp_host, smtp_port** | char / uint | outbound SMTP (blank host ⇒ OAuth provider default) |
| **smtp_security** | char | **enum** starttls / ssl / none |
| **smtp_username** | char | blank ⇒ reuse inbound `username` |
| **smtp_password_enc** | **EncryptedField** | blank ⇒ reuse inbound password (write-only as `smtp_password`) |
| **smtp_from_name** | char | display name on the From header |
| create_users | bool | **default True** — auto-create non-login external requestor for unknown senders |
| default_requestor | FK User | SET_NULL; used when `create_users` is off |
| default_priority | char | **enum** critical/high/medium/low — fallback priority |
| **priority_map** | JSON | email priority signal → ticket priority (admin-editable) |
| default_group | FK Group | SET_NULL; optional initial group |
| **max_attachment_bytes** | biguint | per-attachment cap (default 10 MB); larger parts skipped |
| strip_quotes, cc_watchers, ignore_auto_replies | bool | processing toggles |
| reopen_policy, reopen_window_days | char / uint | reply-to-closed behaviour |
| max_age_days, max_size_bytes | uint / biguint | message age (7d) + whole-message size (25 MB) caps |
| loop_window_min, loop_max_messages | uint | mail-loop throttle |
| poll_interval_seconds | uint? | per-channel override of the global cadence |
| is_active | bool | polled only when true |
| last_polled_at, last_seen_uid, last_error | datetime / biguint / text | polling cursor + status |
- Provider client id/secret are **not** stored here — they live in settings; only granted tokens persist.
- Properties: `effective_domain`, `is_oauth`, `effective_smtp_username`, `effective_smtp_password`,
  `from_header` (RFC From for outbound).

## `InboundEmail` (durable log — the email-logs / failed-requests surface)
| Field | Type | Notes |
|---|---|---|
| channel | FK EmailChannel | PROTECT |
| message_id | char | the RFC `Message-ID` (synthesized deterministically if absent) |
| in_reply_to, references | char / JSON | reply linkage snapshot |
| from_addr, from_name | email / char | |
| to_addrs, cc_addrs | JSON | |
| subject | char | |
| date_header | datetime | parsed `Date` |
| size_bytes | biguint | whole-message size |
| headers | JSON | parsed header snapshot (incl. priority signals) |
| body_text | text | snapshot (truncated to 5000 for the log row) |
| status | char | **enum** received / processed / ignored / failed |
| ignore_reason | char | actual values: `blocklist`, `auto_reply`, `loop`, `age`, `size_cap` |
| action_taken | char | **enum** created_ticket / added_comment / "" |
| ticket | FK Ticket | SET_NULL; the created/updated ticket |
| comment | FK Comment | SET_NULL; the reply comment |
| requestor | FK User | SET_NULL; resolved/created sender |
| attempts | uint | retry counter (capped at `EMAIL_MAX_INBOUND_ATTEMPTS`) |
| last_error | text | last failure traceback/summary |
| next_attempt_at | datetime | picked up by `email.retry_failed_inbound` |
| processed_at | datetime | |
- **Unique constraint:** `(channel, message_id)` — the idempotency key (POP3 redeliveries, restarts,
  refetches never double-create). **Indexes:** `(status, next_attempt_at)`, `(from_addr, created_at)`,
  `(message_id)`.

## `EmailThreadMessage` (inbound resolution map)
| Field | Type | Notes |
|---|---|---|
| channel | FK EmailChannel | CASCADE |
| ticket | FK Ticket | CASCADE; the thread's ticket |
| comment | FK Comment | SET_NULL; the comment this message produced (inbound replies) |
| message_id | char | each outbound/inbound message's `Message-ID` |
| direction | char | **enum** inbound / outbound |
- **Unique constraint:** `(channel, message_id)`. **Indexes:** `message_id` (the lookup for
  `In-Reply-To`/`References` resolution), `ticket`. The In-Reply-To/References *chain* is read off the
  parsed inbound message and matched against prior rows; outbound `build_outbound_headers` mints the
  Message-ID and records the row.

## `EmailRule` (allow/block lists)
| Field | Type | Notes |
|---|---|---|
| channel | FK EmailChannel | CASCADE, **nullable** (null ⇒ applies to all channels) |
| rule_type | char | **enum** allow / block |
| pattern | char | exact address or glob (`*@spam.com`); `matches()` uses `fnmatch` on the sender |
| is_active | bool | |
| note | char | optional label |
- Block rules win; if any active **allow** rule exists, the sender must match one
  (`ignore_reason="blocklist"` otherwise). A bare domain entered in the UI is stored as `*@domain`.

## Indexes (summary)
`InboundEmail` unique `(channel, message_id)` + indexes `(status, next_attempt_at)` /
`(from_addr, created_at)` / `(message_id)`; `EmailThreadMessage` unique `(channel, message_id)` +
indexes `message_id` / `ticket`; `EmailRule` index `(channel, rule_type)`; `EmailChannel` index
`(is_active)`.
