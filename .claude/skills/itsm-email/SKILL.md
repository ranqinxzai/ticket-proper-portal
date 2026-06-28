# itsm-email

## Purpose
Bidirectional Email Channel: inbound IMAP/POP polling turns email into tickets and replies into
comments through the existing ticket choke-points; the project's **own mailbox SMTP** sends the
acknowledgement (TicketCreated) and agent public replies, threaded (Message-ID/In-Reply-To/References
+ Reply-To set to the configured mailbox address) so customer replies land back on the right ticket as comments.
**Status: BUILT + WIRED FOR DEPLOY (2026-06-25)** — `backend/apps/itsm_email/` is live in
`INSTALLED_APPS` + `core/urls.py`: `models.py`, `crypto.py` (Fernet `EncryptedField`), inbound
parser/detectors/threading/identity, `priority.py` (email-priority → ticket-priority mapping),
`transport.py` + `smtp_backend.py` (per-mailbox outbound SMTP, basic + XOAUTH2), OAuth2 (Google +
Microsoft 365), APScheduler poll jobs, seed, serializers/views/urls, and `migrations/0001_initial.py`.
**53 tests pass.**

> **Deployment gap that made it "not concrete" (fixed 2026-06-25).** The poll job is gated by
> `RUN_SCHEDULER` (`core/settings.py`) which was set NOWHERE, so the scheduler never booted in the
> running container — inbound mail was never polled (live `public.django_apscheduler_djangojob` had
> 0 rows). Fix: a dedicated **`ticketpilot-scheduler`** compose service runs `manage.py run_scheduler`
> (new command in `apps.itsm_core`) with `RUN_SCHEDULER=1`, so EXACTLY ONE BackgroundScheduler runs
> (the 3 gunicorn web workers keep `RUN_SCHEDULER` OFF). It depends on the backend's new healthcheck
> (gunicorn binds `:8000` only after `migrate_schemas`, so "healthy" == "migrated"). `ITSM_CREDENTIAL_KEY`
> is now set in `backend/.env.docker` (must be set + backed up BEFORE any mailbox secret is stored).
> **Per-org OAuth (Google + MS365) now built (2026-06-25).** Each org registers its OWN provider app;
> the client id/secret/tenant live ON the channel (encrypted), not in shared global settings (those
> remain a fallback). The callback is tenant-aware: the redirect URI is per-org
> `{PUBLIC_BASE_URL}/api/v1/t/<org>/itsm/email/oauth/callback/`, so `PathTenantMiddleware` sets the org
> schema from the path; `state` also carries the org slug (defensive `set_tenant`); success bounces to
> `/t/<org>/agent/w/<hd>/settings/email`. `PUBLIC_BASE_URL`/`FRONTEND_BASE_URL` now point at the live
> HTTPS host. Basic IMAP/SMTP also works. Verified live: callback under `/t/onemed/…` → 302; unknown
> org → 404.

## Backend app path
`backend/apps/itsm_email/` (built — the channel is live).

## Key concepts
- **`EmailChannel`** — one configured mailbox per **project** (`project` FK, PROTECT). Inbound:
  host/port/protocol IMAP|POP3, auth basic|google|microsoft, encrypted `password_enc`/oauth tokens.
  Outbound SMTP: `outbound_enabled`, `smtp_host`/`smtp_port`/`smtp_security`(starttls|ssl|none),
  `smtp_username`/`smtp_password_enc` (blank ⇒ reuse inbound), `smtp_from_name`. Mapping/behaviour:
  `create_users` (default **True** — auto-create the requestor), `default_requestor`,
  `default_priority`, `priority_map` (JSON), `default_group`, `max_attachment_bytes`, `is_active`.
- **Priority mapping** — `priority.resolve_priority(parsed, channel)` reads `X-Priority` (1-5),
  `Importance`, `X-MSMail-Priority`, `Priority`; looks each up in the editable `priority_map`; first
  hit wins, else `default_priority`. The parser retains those headers.
- **Outbound via the mailbox** — `transport.get_outbound_config(ticket)` returns a Django SMTP
  connection (basic) or an XOAUTH2 connection (`smtp_backend.XOAuth2EmailBackend`, OAuth) + a `From`
  built from the channel address; the notification outbox uses it so acks/replies leave FROM support@.
  None ⇒ outbox falls back to the global backend (byte-identical to before).
- **Large-email handling** — whole message > `max_size_bytes` ⇒ `InboundEmail` IGNORED `size_cap`
  (still marked `\Seen`); a single attachment > `max_attachment_bytes` ⇒ that part is skipped, the
  ticket/comment is still created, and a private agent note lists the skipped files.
- **Inbound = ticket/comment via the existing choke-points.** A new email →
  `ticket_service.create_ticket(source="email")`; a reply → `ticket_service.add_comment()` (public).
  Numbering, routing, SLA, audit, notifications are all **reused**, never re-implemented.
- **`InboundEmail`** — the durable log row for **every** message (status received/processed/ignored/
  failed, `ignore_reason`, `action_taken`, linked `ticket`/`comment`, retry fields). The "email logs /
  failed requests" surface.
- **`EmailThreadMessage`** — the header map row (`message_id`, `in_reply_to`, `references`, ticket) used
  to resolve inbound replies back to their ticket.
- **`EmailRule`** — allow/block lists (per channel) applied before ingestion.
- **Threading (inbound resolution) — subject-first (2026-06-28, Jira parity):** (1) **subject token**
  `[INC-123]` (scanned FIRST; if it resolves to a live ticket, thread there and DO NOT scan headers),
  (2) **header map** (In-Reply-To/References → `EmailThreadMessage`; reached only when the subject had
  no usable ticket number), (3) **plus-address token** (`support+INC-123@…`). No match → new ticket.
  A subject miss (no token / unknown or deleted ticket) is NOT terminal — it falls through to the
  header map, so a reply whose subject was edited away still threads.
  - **Subject path is UNGATED (2026-06-28).** A valid `[KEY-N]` in the subject threads on any match,
    even from a non-participant — the explicit ticket number is trusted (Jira-style). This **reverses**
    the 2026-06-25 ownership gate on the subject path; see BUG_LOG for the accepted security tradeoff.
  - **Plus-address path is still gated.** `threading._sender_owns_ticket(ticket, parsed)` requires the
    envelope sender to be a real participant (ticket **requestor** or a **watcher**, matched by email)
    before a plus-address token threads; a stranger's plus-token → new ticket. The header map is also
    NOT gated — it requires a Message-ID we minted + recorded, a far higher bar than typed text.
- **Threading (outbound):** the notification outbox sends via `EmailMultiAlternatives` and, via the
  lazy hooks `itsm_core.services.hooks.email_thread_headers` (Message-ID/In-Reply-To/References +
  Reply-To = the **configured mailbox address** itself, e.g. `helpdesk@acme.com` — NOT a synthetic
  `support+token`, so a reply lands in the real inbox; the `[KEY-N]` subject token + Message-ID map
  do the threading) **and `email_outbound_transport`** (per-mailbox SMTP connection + From),
  threads + sends from the mailbox address. With no channel it sends a plain, **byte-identical** mail.
  The acknowledgement and agent-reply emails reuse the seeded `TicketCreated`→requestor and public
  `CommentAdded`→requestor notification rules — only the transport + From are swapped.
  - **HTML alternative (2026-06-25):** the outbox now also attaches a branded `text/html` part
    (`row.rendered_html`) via `attach_alternative` (see itsm-notifications). The transport swap +
    threading headers are unchanged — they wrap the same multipart message.
- **OAuth2 (per-org apps):** Google + Microsoft 365 via **XOAUTH2 over IMAP** (one-time consent +
  automatic token refresh). Each org registers its OWN app — `oauth_client_id` /
  `oauth_client_secret_enc` / `oauth_tenant_id` (MS) live on the `EmailChannel` (secret encrypted,
  write-only in the API; blank ⇒ fall back to the global `*_OAUTH_CLIENT_ID/SECRET` settings).
  `oauth.authorize_url`/`exchange_code`/`refresh` read creds via `_client(cfg, channel)` and the MS
  endpoint tenant via `_tenant(channel)`. Redirect URI is per-org (`_redirect_uri()` derives it from
  `connection.schema_name` + `PUBLIC_BASE_URL`). The granted access/refresh tokens are stored per
  channel (encrypted). UI: Connection tab shows Client ID / Client secret / (MS) Directory tenant ID
  + the exact redirect URI to register + a Connect/Reconnect button (`oauth/start` → consent → callback).
- **Credential encryption:** `crypto.py` `EncryptedField` (Fernet) encrypts secrets at rest; key from
  `ITSM_CREDENTIAL_KEY` or derived from `SECRET_KEY`. Secrets are **write-only** in the API, masked on read.
- **Sender→user:** `resolve_or_create_user` matches by email; with `create_users` it makes a **non-login
  external account with NO RoleAssignment** (RBAC denies all agent access — the security lever) +
  unusable password; else uses the channel `default_requestor`.

## Guards (JSM parity, applied in order)
Idempotency by `(channel, message_id)` unique · allow/block lists (`EmailRule`) · auto-reply/bulk
detection (`Auto-Submitted`, `Precedence: bulk`, OOO subjects, bounces, mailing lists, self-loop) ·
mail-loop threshold · age (>7d) + size (25 MB) caps · quote/signature stripping.

## Scheduler jobs
- **`email.poll_inbound`** (every `EMAIL_POLL_INTERVAL_SECONDS`) — polls each active mailbox; ingests new
  mail. `\Seen` is set **only after a durable write**. **Multi-tenant:** `_poll()` wraps
  `poller.poll_active_channels` in `apps.tenants.runtime.for_each_tenant`, so it runs once inside every
  active org schema (channels live per-org). Same for `_retry()`.
- **`email.retry_failed_inbound`** (every `EMAIL_RETRY_INBOUND_MINUTES`) — reprocesses `failed`
  `InboundEmail` rows up to `EMAIL_MAX_INBOUND_ATTEMPTS`.
- **Where they run:** ONLY in the dedicated `ticketpilot-scheduler` container (`manage.py run_scheduler`,
  `RUN_SCHEDULER=1`). The web workers never start them. See the Deployment note in Purpose.
- **Manual poll:** `python manage.py poll_email_once [--schema=<org>] [--retry]` — now fans out per-org
  (matching the job); without `--schema` it polls EVERY active org. It is in `SCHEDULER_BLOCKED_COMMANDS`
  so a one-off poll never boots the scheduler.

## Frontend path / pages
Under the per-helpdesk Settings hub: `app/(agent)/agent/w/[helpdeskKey]/settings/email/page.tsx`
(mailbox list + tabbed editor: Connection / Outbound / Field Mapping / Processing / Domains) and
`.../settings/email/logs/page.tsx` (inbound log + retry). Nav entries added to
`components/settings/settings-nav.tsx`; API in `lib/itsm/api.ts` (`emailChannelsApi`/`emailRulesApi`/
`inboundEmailsApi`); types in `lib/itsm/types.ts`. Components in `components/settings/email-*`. Zero
new frontend deps.

## API clients
Live endpoints under `/api/v1/itsm/`: `email-channels` (CRUD + `{id}/test-connection/`,
`{id}/test-smtp/`, `{id}/poll-now/`, `{id}/oauth/start/`), top-level `email/oauth/callback/`,
`email-rules` (CRUD), `inbound-emails` (read-only + `{id}/retry/`). `EmailChannelSerializer` exposes a
read-only `field_mappings` block (subject→summary, body→description, sender→requestor, cc→watchers,
attachments→attachments, priority→priority+map) so the UI shows every mapping; secrets (`password`,
`smtp_password`) are write-only.

## RBAC module codes
- **`itsm.email`** (parent) → **`itsm.email.channels`** (Supervisor-only config) +
  **`itsm.email.logs`** (Agent read-only). Added to `itsm_rbac/registry.py`; seeded by `seed_rbac()`.

## Seed
A non-login **`email-bot`** system user (audit actor / `created_by`) seeded via a new `seed_itsm` STEP.

## Key files
`models.py` (EmailChannel/InboundEmail/EmailThreadMessage/EmailRule + SMTP/priority_map/
max_attachment_bytes), `crypto.py` (`EncryptedField`), inbound `parser`/`detectors`/`threading`/
`identity`, `priority.py` (priority mapping), `transport.py` + `smtp_backend.py` (outbound SMTP, basic
+ XOAUTH2), `oauth.py` (Google/MS consent + refresh, IMAP+SMTP scopes/endpoints), `serializers.py`,
`views.py`, `urls.py`, `seed.py`, `scheduler.py` (`email.poll_inbound` + `email.retry_failed_inbound`),
`tests.py` (**53 tests**), `migrations/0001_initial.py`. Outbound integration:
`itsm_core/services/hooks.py` (`email_outbound_transport`) + `itsm_notifications/services/outbox.py`
(transport swap). No new runtime deps (`cryptography`/APScheduler already present; OAuth uses stdlib
`urllib`).
