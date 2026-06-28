# Email Channel — ITSM Platform

Design for `itsm_email` (**BUILT & live**, 2026-06-22). A bidirectional email channel: inbound IMAP/POP
polling turns email into tickets and replies into comments through the **existing** ticket
choke-points; the project's **own mailbox SMTP** sends the acknowledgement + agent public replies,
**threaded** so customer replies land back on the right ticket. One mailbox = one project
(`EmailChannel.project`). Built on the notification engine + `ticket_service`; fully backward compatible
(no channel → plain mail via the global backend, byte-identical to before).

---

## 1. Overview

```
inbound:  mailbox  ──poll──▶  guards  ──▶  ticket_service.create_ticket / add_comment  ──▶  InboundEmail log
outbound: notification  ──outbox.flush──▶  email_thread_headers + email_outbound_transport  ──▶  mailbox SMTP, From: support@, Reply-To: <configured mailbox address>
```

- **Inbound** reuses `ticket_service.create_ticket(source="email")` (new mail) and `add_comment()`
  (reply) — numbering, routing, SLA, audit, and notifications all come for free. Subject→summary,
  body→description, sender→requestor (auto-created), CC→watchers, attachments→attachments, email
  priority→ticket priority (configurable map).
- **Outbound** is **two one-way hooks** from the notification outbox into `itsm_core.services.hooks`
  (`email_thread_headers` + `email_outbound_transport`); notifications never import `itsm_email`. The
  acknowledgement and agent-reply mail reuse the seeded `TicketCreated`/`CommentAdded` rules — only the
  transport + From are swapped so they leave from the mailbox.
- Every inbound message is recorded as an `InboundEmail` row — the durable "email logs / failed
  requests" surface with retry.

## 2. Inbound Pipeline (ordered guards)

`email.poll_inbound` fetches new mail per active channel and runs, **in order**:

| # | Step | Effect on no-pass |
|---|---|---|
| 1 | **Parse MIME** → from/subject/message_id/in_reply_to/references/text/html/attachments | — |
| 2 | **Idempotency** — `(channel, message_id)` already present? | ignore (`duplicate`) |
| 3 | **`EmailRule`** allow/block lists (per channel; block wins) | ignore (`blocklist`) |
| 4 | **Auto-reply / bulk** — `Auto-Submitted`, `Precedence: bulk`, OOO subjects, bounces (DSN/mailer-daemon), mailing-list headers, **self-loop** (mail from the channel address) | ignore (`auto_reply`) |
| 5 | **Mail-loop threshold** | ignore (`loop`) |
| 6 | **Caps** — age **> `max_age_days`**, whole-message size **> `max_size_bytes`** (25 MB default) | ignore (`age` / `size_cap`) |
| 7 | **Strip quotes / signature** | — |
| 8 | **Resolve sender → user** (§6) | — |
| 9 | **Thread resolution** (§3) → match: `add_comment` (public); no match: resolve priority (§3a) → `create_ticket(source="email")` | — |
| 10 | **Save attachments** — parts over `max_attachment_bytes` are skipped + listed in a private agent note (ticket still created) | — |
| 11 | **Write `InboundEmail`** (`processed`, `action_taken`, linked ticket/comment) + `EmailThreadMessage` | — |
| 12 | **Mark IMAP `\Seen`** — **only after** the durable write | — |

A failure at any step records `InboundEmail.status=failed` (+ `last_error`, `attempts`,
`next_attempt_at`) and **leaves the message unseen**, so `email.retry_failed_inbound` re-ingests it.
Ignored messages are still logged (with `ignore_reason`) — never silently dropped.

### 3a. Priority mapping (email → ticket)

`priority.resolve_priority` reads `X-Priority` (leading digit 1–5), `Importance`, `X-MSMail-Priority`,
and `Priority`; lower-cases each and looks it up in the channel's **editable `priority_map`** (JSON);
the first hit wins, else `default_priority`. Defaults map `1→critical, 2→high, 3→medium, 4/5→low`,
`High→high / Normal→medium / Low→low`, `urgent→critical / non-urgent→low`. Fully visible & editable in
the mailbox **Field Mapping** tab.

## 3. Threading

### Inbound resolution — three signals, tried in order
| Order | Signal | Source |
|---|---|---|
| A | **Header map** — `In-Reply-To` / `References` → `EmailThreadMessage.message_id` | strongest |
| B | **Plus-address token** — `support+INC-123@domain` in To/Delivered-To | strong |
| C | **Subject token** — `[INC-123]` | weakest (users edit subjects) |

No match → a **new ticket**.

### Outbound headers + transport
`outbox.flush` builds an `EmailMultiAlternatives` and, for a ticket-scoped notification, calls two lazy
hooks:
- `email_thread_headers(ticket)` → **`Message-ID`** (stored as an outbound `EmailThreadMessage`),
  **`In-Reply-To` / `References`** (chained to prior thread messages), and **`Reply-To` = the
  configured mailbox `address`** (e.g. `helpdesk@acme.com`) so a reply lands directly in the inbox the
  poller reads. We deliberately do NOT plus-address the Reply-To (`mailbox+INC-123@…`): many mail
  servers reject `+` subaddressing and bounce the reply, and it isn't needed — the reply is matched
  back to the ticket by the `[INC-123]` **subject token** (scanned first) and the `Message-ID` map.
- `email_outbound_transport(ticket)` → the project mailbox's **SMTP `connection`** (basic, or XOAUTH2
  for OAuth channels) + **`From: "IT Support <support@…>"`** (`smtp_from_name` + channel address). The
  durable outbox keeps its retry/backoff/dedupe; an SMTP/OAuth failure falls back to the global backend.

**With no `EmailChannel`, both hooks return `None` and the mail is byte-identical to the old `send_mail`
path** — notifications are unchanged on installs without email configured. No new notification rules
were added — the seeded `TicketCreated`→requestor (acknowledgement) and public `CommentAdded`→requestor
(agent reply) rules already generate the mail.

## 4. OAuth2 — Google & Microsoft 365

- **XOAUTH2 over IMAP (read) and SMTP (send)** for both providers. Google's `https://mail.google.com/`
  scope covers both; Microsoft requests `IMAP.AccessAsUser.All` + `SMTP.Send` + `offline_access`.
  Provider **client id/secret live in settings** (`GOOGLE_OAUTH_CLIENT_ID/SECRET`,
  `MICROSOFT_OAUTH_CLIENT_ID/SECRET` + `MICROSOFT_OAUTH_TENANT`); per-channel only the **granted
  tokens** are stored (encrypted).
- **One-time consent:** `POST email-channels/{id}/oauth/start/` → provider consent URL; the provider
  redirects to `EMAIL_OAUTH_REDIRECT_URI` → `GET email/oauth/callback/` exchanges the code for
  access + refresh tokens, then redirects back to the helpdesk's Mailboxes settings page.
- **Automatic refresh:** both the poller and the outbound transport refresh the access token from the
  stored refresh token on expiry; no human re-consent until it's revoked. SMTP send uses
  `smtp_backend.XOAuth2EmailBackend` (Django's stock SMTP backend can't do XOAUTH2).
- Basic auth (username + password) remains supported for plain IMAP/POP3 + SMTP mailboxes.

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
| **`EmailChannel`** | one mailbox per **`project`**: inbound protocol (imap/pop3), host/port/ssl, `auth_method` (basic/oauth_google/oauth_microsoft), encrypted creds/tokens; **outbound SMTP** (`outbound_enabled`, `smtp_host/port/security/username/smtp_password_enc/smtp_from_name`); mapping (`create_users` default **True**, `default_requestor`, `default_priority`, **`priority_map`**, `default_group`, **`max_attachment_bytes`**); processing toggles; `is_active`, polling cursor. |
| **`InboundEmail`** | durable log per message: `status` (received/processed/ignored/failed), `ignore_reason` (`blocklist`/`auto_reply`/`loop`/`age`/`size_cap`), `action_taken`, linked `ticket`/`comment`/`requestor`, retry fields. **Unique `(channel, message_id)`** — the idempotency key. |
| **`EmailThreadMessage`** | message-id ↔ ticket map: `channel`, `message_id`, `ticket`, `comment`, `direction` — resolves inbound replies back to a ticket. Unique `(channel, message_id)`; indexes on `message_id`, `ticket`. |
| **`EmailRule`** | allow/block list (`channel` nullable = all, `rule_type` allow/block, `pattern` glob via `fnmatch`, `note`). A bare domain is stored as `*@domain`. |

All extend `BaseModel` (UUID PK + timestamps + soft delete). See `ERD.md §13`.

## 8. REST API

All under `/api/v1/itsm/`. See `API_DESIGN.md §3.7`.

| Endpoint | Purpose | Module |
|---|---|---|
| `GET/POST email-channels` (+CRUD) | configure mailboxes (secrets write-only; read exposes `field_mappings`) | `itsm.email.channels` |
| `POST email-channels/{id}/test-connection/` | inbound IMAP/POP connect + auth, no ingest | `itsm.email.channels` |
| `POST email-channels/{id}/test-smtp/` | outbound SMTP connect + auth (basic/XOAUTH2), no send | `itsm.email.channels` |
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
| `EMAIL_DOMAIN` | fallback host for the synthetic `Message-ID` only (Reply-To is the mailbox `address`). |
| `EMAIL_POLL_INTERVAL_SECONDS` | inbound poll cadence. |
| `EMAIL_RETRY_INBOUND_MINUTES` | failed-row retry cadence. |
| `EMAIL_MAX_MESSAGE_BYTES` | size cap (25 MB default). |
| `EMAIL_MAX_INBOUND_ATTEMPTS` | retry cap per message. |
| `EMAIL_SYSTEM_ACTOR_USERNAME` | the `email-bot` audit/`created_by` actor. |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | Google XOAUTH2 app credentials. |
| `MICROSOFT_OAUTH_CLIENT_ID/SECRET`, `MICROSOFT_OAUTH_TENANT` | Microsoft 365 XOAUTH2 app credentials. |
| `EMAIL_OAUTH_REDIRECT_URI` | OAuth redirect target → `email/oauth/callback/`. |

No new runtime deps: **`cryptography`** (Fernet) + APScheduler are already present; OAuth uses stdlib
`urllib`; frontend adds **zero** new deps. A non-login **`email-bot`** system user is seeded via the
`seed_itsm` STEP as the audit actor / `created_by`.

## 11. Verification

`apps/itsm_email/tests.py` — **35 tests passing**: Fernet crypto round-trip; MIME parser; the detectors
(auto-reply/bulk/OOO/bounce/list/self-loop); the three threading signals; idempotency by `Message-ID`;
identity (external non-login account, no RoleAssignment); end-to-end inbound **new** + **reply** with
attachments; outbound thread headers; **priority-map resolution** (X-Priority/Importance → mapped +
default fallback); **attachment-cap skip + note**; **`transport.get_outbound_config`** (basic / OAuth
unauthorized → fallback / no host / disabled); **outbox transport swap** (From + connection +
threading); **`test-smtp`** config validation. The `itsm_notifications` outbox and `itsm_tickets`
suites stay green (48 ticket tests). Frontend: per-helpdesk settings
`app/(agent)/agent/w/[helpdeskKey]/settings/email/page.tsx` (tabbed mailbox editor) +
`.../settings/email/logs/page.tsx`; `tsc --noEmit` clean and both routes compile in `next build`.

Manual gates: connect a Gmail mailbox via OAuth → **Test inbound** + **Test SMTP** → `poll-now` ingests
a new mail to `INC-N` (mapped priority, attachments) → the requestor gets the acknowledgement **from the
support address** → reply threads back as a public comment → an agent public comment emails out
threaded → a failed row retries idempotently → confirm a no-channel install still sends byte-identical
notification mail.
