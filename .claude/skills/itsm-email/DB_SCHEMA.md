# itsm-email — DB Schema

**Status: BUILT** — all four models live in `models.py` and are migrated via
`migrations/0001_initial.py`. All extend `BaseModel` (UUID PK + `created_at`/`updated_at` + soft delete).
Encrypted columns use `crypto.EncryptedField` (Fernet at rest).

## `EmailChannel`
| Field | Type | Notes |
|---|---|---|
| name | char | display label |
| address | email | the mailbox address (used for plus-addressing / self-loop) |
| protocol | char | **enum** imap / pop3 |
| host, port | char / uint | server |
| use_ssl | bool | |
| auth_type | char | **enum** basic / google / microsoft |
| username | char | basic auth / mailbox login |
| password | **EncryptedField** | basic auth secret (Fernet; write-only via API) |
| oauth_access_token | **EncryptedField** | OAuth2 access token (Google/MS) |
| oauth_refresh_token | **EncryptedField** | OAuth2 refresh token; drives automatic refresh |
| oauth_token_expires_at | datetime | refresh trigger |
| default_requestor | FK User | SET_NULL; used when `create_users` is off |
| create_users | bool | create non-login external accounts for unknown senders |
| is_active | bool | polled only when true |
| last_polled_at | datetime | |
- Provider client id/secret are **not** stored here — they live in settings; only granted tokens persist.

## `InboundEmail` (durable log — the email-logs / failed-requests surface)
| Field | Type | Notes |
|---|---|---|
| channel | FK EmailChannel | CASCADE |
| message_id | char | the RFC `Message-ID` |
| from_address | email | |
| subject | char | |
| received_at | datetime | |
| raw_headers | JSON | parsed header snapshot |
| body_text / body_html | text | stripped of quotes/signature |
| status | char | **enum** received / processed / ignored / failed |
| ignore_reason | char | e.g. `auto_reply`, `blocked`, `too_old`, `too_large`, `mail_loop`, `duplicate` |
| action_taken | char | **enum** created_ticket / added_comment / null |
| ticket | FK Ticket | SET_NULL; the created/updated ticket |
| comment | FK Comment | SET_NULL; the reply comment |
| attempts | uint | retry counter (capped at `EMAIL_MAX_INBOUND_ATTEMPTS`) |
| last_error | text | last failure traceback/summary |
| next_retry_at | datetime | picked up by `email.retry_failed_inbound` |
- **Unique constraint:** `(channel, message_id)` — the idempotency key (POP3 redeliveries, restarts,
  refetches never double-create). **Index:** `(channel, status)` for the log/retry queries.

## `EmailThreadMessage` (inbound resolution map)
| Field | Type | Notes |
|---|---|---|
| ticket | FK Ticket | CASCADE; the thread's ticket |
| message_id | char | each outbound/inbound message's `Message-ID` |
| in_reply_to | char | the parent `Message-ID` |
| references | text | the `References` chain |
| direction | char | **enum** inbound / outbound |
- **Index:** `message_id` (the lookup for `In-Reply-To`/`References` resolution). Written when an
  outbound thread mail is sent and when an inbound message is ingested.

## `EmailRule` (allow/block lists)
| Field | Type | Notes |
|---|---|---|
| channel | FK EmailChannel | CASCADE |
| rule_type | char | **enum** allow / block |
| match_field | char | **enum** from / domain / subject |
| pattern | char | substring/glob match |
| is_active | bool | |
- Applied per channel before ingestion; a matching **block** rule wins and ignores the message
  (`ignore_reason="blocked"`).

## Indexes (summary)
`InboundEmail` unique `(channel, message_id)` + index `(channel, status)`; `EmailThreadMessage`
index `message_id`; `EmailChannel` index `(is_active)`.
