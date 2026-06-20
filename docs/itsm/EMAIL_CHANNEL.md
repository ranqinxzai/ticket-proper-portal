# Email Channel — ITSM Platform

Design for `itsm_email` (built, **M13**). A bidirectional email channel: inbound IMAP/POP polling turns
email into tickets and replies into comments through the **existing** ticket choke-points, and outbound
notification mail is now **threaded** so customer replies land back on the right ticket. Built on top of
the notification engine and `ticket_service`; fully backward compatible (no channel → plain mail,
byte-identical to before).

---

## 1. Overview

```
inbound:  mailbox  ──poll──▶  guards  ──▶  ticket_service.create_ticket / add_comment  ──▶  InboundEmail log
outbound: notification  ──outbox.flush──▶  EmailMultiAlternatives + email_thread_headers  ──▶  Reply-To: support+INC-123@…
```

- **Inbound** reuses `ticket_service.create_ticket(source="email")` (new mail) and `add_comment()`
  (reply) — numbering, routing, SLA, audit, and notifications all come for free.
- **Outbound** threading is a **one-way** hook from the notification outbox into
  `itsm_core.services.hooks.email_thread_headers`; notifications never import `itsm_email`.
- Every inbound message is recorded as an `InboundEmail` row — the durable "email logs / failed
  requests" surface with retry.

## 2. Inbound Pipeline (ordered guards)

`email.poll_inbound` fetches new mail per active channel and runs, **in order**:

| # | Step | Effect on no-pass |
|---|---|---|
| 1 | **Parse MIME** → from/subject/message_id/in_reply_to/references/text/html/attachments | — |
| 2 | **Idempotency** — `(channel, message_id)` already present? | ignore (`duplicate`) |
| 3 | **`EmailRule`** allow/block lists (per channel; block wins) | ignore (`blocked`) |
| 4 | **Auto-reply / bulk** — `Auto-Submitted`, `Precedence: bulk`, OOO subjects, bounces (DSN/mailer-daemon), mailing-list headers, **self-loop** (mail from the channel address) | ignore (`auto_reply`) |
| 5 | **Mail-loop threshold** | ignore (`mail_loop`) |
| 6 | **Caps** — age **> 7 days**, size **> 25 MB** (`EMAIL_MAX_MESSAGE_BYTES`) | ignore (`too_old` / `too_large`) |
| 7 | **Strip quotes / signature** | — |
| 8 | **Resolve sender → user** (§6) | — |
| 9 | **Thread resolution** (§3) → match: `add_comment` (public); no match: `create_ticket(source="email")` | — |
| 10 | **Write `InboundEmail`** (`processed`, `action_taken`, linked ticket/comment) + `EmailThreadMessage` | — |
| 11 | **Mark IMAP `\Seen`** — **only after** the durable write | — |

A failure at any step records `InboundEmail.status=failed` (+ `last_error`, `attempts`,
`next_retry_at`) and **leaves the message unseen**, so `email.retry_failed_inbound` re-ingests it.
Ignored messages are still logged (with `ignore_reason`) — never silently dropped.

## 3. Threading

### Inbound resolution — three signals, tried in order
| Order | Signal | Source |
|---|---|---|
| A | **Header map** — `In-Reply-To` / `References` → `EmailThreadMessage.message_id` | strongest |
| B | **Plus-address token** — `support+INC-123@domain` in To/Delivered-To | strong |
| C | **Subject token** — `[INC-123]` | weakest (users edit subjects) |

No match → a **new ticket**.

### Outbound headers
`outbox.flush` builds an `EmailMultiAlternatives` and stamps, via `email_thread_headers(ticket)`:
- **`Message-ID`** — for this outgoing message (also stored as an outbound `EmailThreadMessage`).
- **`In-Reply-To` / `References`** — chained to the ticket's prior thread messages.
- **`Reply-To: support+INC-123@domain`** — plus-addressed (`EMAIL_REPLY_TO_LOCALPART` + `EMAIL_DOMAIN`)
  so a reply carries the ticket token even if the headers are stripped by an intermediary.

**With no `EmailChannel`, the hook returns `{}` and the mail is byte-identical to the old `send_mail`
path** — notifications are unchanged on installs without email configured.

## 4. OAuth2 — Google & Microsoft 365

- **XOAUTH2 over IMAP** for both providers. Provider **client id/secret live in settings**
  (`GOOGLE_OAUTH_CLIENT_ID/SECRET`, `MICROSOFT_OAUTH_CLIENT_ID/SECRET` + `MICROSOFT_OAUTH_TENANT`);
  per-channel only the **granted tokens** are stored (encrypted).
- **One-time consent:** `POST email-channels/{id}/oauth/start/` → provider consent URL; the provider
  redirects to `EMAIL_OAUTH_REDIRECT_URI` → `GET email/oauth/callback/` exchanges the code for
  access + refresh tokens.
- **Automatic refresh:** the poller refreshes the access token from the stored refresh token on expiry;
  no human re-consent until the refresh token is revoked.
- Basic auth (username + password) remains supported for plain IMAP/POP3 mailboxes.

## 5. Credential Encryption

- `apps/itsm_email/crypto.py` `EncryptedField` wraps every secret column (basic password, OAuth access +
  refresh tokens) with **Fernet** — encrypted at rest.
- The key is **`ITSM_CREDENTIAL_KEY`**, or **derived from `SECRET_KEY`** when unset (dev convenience).
  Rotating `SECRET_KEY` without an explicit `ITSM_CREDENTIAL_KEY` makes stored credentials undecryptable
  — set `ITSM_CREDENTIAL_KEY` in any environment whose `SECRET_KEY` may change.
- Secrets are **write-only** in the API: serializers accept them on write and **mask them on read**
  (never echo a decrypted secret).

## 6. Security — External Requestor & Secrets

- **Sender → user:** `resolve_or_create_user` matches by email. With `create_users` it creates a
  **non-login external account**: **unusable password** + **NO `RoleAssignment`**. Module RBAC denies all
  agent-app access by default, so a customer who emails in can never reach the agent UI — this is the
  **security lever**. When `create_users` is off, the channel's `default_requestor` is used instead.
- **Secrets** are Fernet-encrypted at rest and write-only/masked in the API (§5). Provider client
  secrets stay in settings, never in the DB.
- **Auto-reply / loop guards** (§2 steps 4–5) prevent runaway ticket/auto-reply storms.

## 7. Models

| Entity | Purpose |
|---|---|
| **`EmailChannel`** | one mailbox: protocol (imap/pop3), host/port/ssl, `auth_type` (basic/google/microsoft), encrypted creds/tokens, `default_requestor`, `create_users`, `is_active`, `last_polled_at`. |
| **`InboundEmail`** | durable log per message: `status` (received/processed/ignored/failed), `ignore_reason`, `action_taken`, linked `ticket`/`comment`, retry fields. **Unique `(channel, message_id)`** — the idempotency key. |
| **`EmailThreadMessage`** | header map: `message_id`, `in_reply_to`, `references`, `direction`, `ticket` — resolves inbound replies back to a ticket. Index on `message_id`. |
| **`EmailRule`** | per-channel allow/block list (`rule_type`, `match_field` from/domain/subject, `pattern`). |

All extend `BaseModel` (UUID PK + timestamps + soft delete). See `ERD.md §13`.

## 8. REST API

All under `/api/v1/itsm/`. See `API_DESIGN.md §3.7`.

| Endpoint | Purpose | Module |
|---|---|---|
| `GET/POST email-channels` (+CRUD) | configure mailboxes (secrets write-only) | `itsm.email.channels` |
| `POST email-channels/{id}/test-connection/` | connect + auth, no ingest | `itsm.email.channels` |
| `POST email-channels/{id}/poll-now/` | trigger an immediate inbound poll | `itsm.email.channels` |
| `POST email-channels/{id}/oauth/start/` | get the Google/MS consent URL | `itsm.email.channels` |
| `GET email/oauth/callback/` | exchange the OAuth code, store tokens | `itsm.email.channels` |
| `GET/POST email-rules` (+CRUD) | allow/block lists | `itsm.email.channels` |
| `GET inbound-emails` (RO) | the email log | `itsm.email.logs` |
| `POST inbound-emails/{id}/retry/` | re-run a `failed` row (idempotent) | `itsm.email.logs` |

RBAC: `itsm.email` (parent) → `itsm.email.channels` (Supervisor-only) + `itsm.email.logs`
(Agent read-only). Added to `itsm_rbac/registry.py`; seeded by `seed_rbac()`.

## 9. Scheduler Jobs

| Job | Cadence | Purpose |
|---|---|---|
| `email.poll_inbound` | `EMAIL_POLL_INTERVAL_SECONDS` | poll each active mailbox; ingest new mail (set `\Seen` only after the durable write). |
| `email.retry_failed_inbound` | `EMAIL_RETRY_INBOUND_MINUTES` | re-process `failed` `InboundEmail` rows up to `EMAIL_MAX_INBOUND_ATTEMPTS`. |

Both under the shared `DjangoJobStore`, `max_instances=1, coalesce=True, misfire_grace_time=60`, gated
by `RUN_SCHEDULER`.

## 10. Settings

| Setting | Purpose |
|---|---|
| `ITSM_CREDENTIAL_KEY` | Fernet key for `EncryptedField` (else derived from `SECRET_KEY`). |
| `EMAIL_DOMAIN` | domain for plus-addressed `Reply-To`. |
| `EMAIL_REPLY_TO_LOCALPART` | local-part for the plus-address (e.g. `support`). |
| `EMAIL_POLL_INTERVAL_SECONDS` | inbound poll cadence. |
| `EMAIL_RETRY_INBOUND_MINUTES` | failed-row retry cadence. |
| `EMAIL_MAX_MESSAGE_BYTES` | size cap (25 MB default). |
| `EMAIL_MAX_INBOUND_ATTEMPTS` | retry cap per message. |
| `EMAIL_SYSTEM_ACTOR_USERNAME` | the `email-bot` audit/`created_by` actor. |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | Google XOAUTH2 app credentials. |
| `MICROSOFT_OAUTH_CLIENT_ID/SECRET`, `MICROSOFT_OAUTH_TENANT` | Microsoft 365 XOAUTH2 app credentials. |
| `EMAIL_OAUTH_REDIRECT_URI` | OAuth redirect target → `email/oauth/callback/`. |

New backend dependency: **`cryptography`** (Fernet). Frontend adds **zero** new deps. A non-login
**`email-bot`** system user is seeded via a new `seed_itsm` STEP as the audit actor / `created_by`.

## 11. Verification

`apps/itsm_email/tests.py` — **23 tests passing**: Fernet crypto round-trip; MIME parser; the detectors
(auto-reply/bulk/OOO/bounce/list/self-loop); the three threading signals; idempotency by `Message-ID`;
identity (external non-login account, no RoleAssignment); end-to-end inbound **new** + **reply** with
attachments; outbound thread headers. Frontend pages: `app/(itsm)/admin/email/page.tsx` and
`app/(itsm)/admin/email/logs/page.tsx`.

Manual gates: connect a Gmail mailbox via OAuth → `test-connection` → `poll-now` ingests a new mail to
`INC-N` → reply threads back as a public comment → a failed row retries idempotently → confirm a no-channel
install still sends byte-identical notification mail.
