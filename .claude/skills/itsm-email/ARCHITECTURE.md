# itsm-email — Architecture

## Current state
`backend/apps/itsm_email/` is **BUILT** and wired into `INSTALLED_APPS` + `core/urls.py`: all four
models, `crypto.py`, inbound services, priority mapping, per-mailbox outbound SMTP (basic + XOAUTH2),
OAuth2 (Google/MS) + token refresh, scheduler jobs, seed, serializers/views/urls, and
`migrations/0001_initial.py`. **53 tests pass.**

## Layout
```
itsm_email/
  models.py        # EmailChannel(+SMTP/priority_map/max_attachment_bytes), InboundEmail, EmailThreadMessage, EmailRule
  crypto.py        # EncryptedField (Fernet); key from ITSM_CREDENTIAL_KEY or derived from SECRET_KEY
  services/
    mailbox.py     # IMAP/POP connect, fetch UNSEEN, mark \Seen after durable write; test_connection / test_smtp
    poller.py      # poll_channel / poll_active_channels / retry_failed orchestration
    parser.py      # MIME → {from, subject, message_id, in_reply_to, references, text, html, attachments, headers}
    detectors.py   # auto-reply/bulk/OOO/bounce/mailing-list/self-loop + mail-loop threshold; strip_quotes
    threading.py   # resolve inbound → ticket (subject token → header map → plus-token); outbound headers
    identity.py    # resolve_or_create_user (external non-login account, no RoleAssignment)
    priority.py    # resolve_priority: X-Priority/Importance/… → priority_map → ticket priority
    attachments.py # save parts to Ticket/Comment; skip parts over max_attachment_bytes (returns skipped)
    transport.py   # get_outbound_config(ticket): pick the project's mailbox → SMTP connection + From
    smtp_backend.py# XOAuth2EmailBackend (OAuth SMTP send; stock backend has no XOAUTH2)
    oauth.py       # Google + Microsoft 365 XOAUTH2: consent URL, callback exchange, refresh; IMAP+SMTP endpoints
    system_user.py # email-bot audit actor
    inbound.py     # orchestration: guards → create_ticket / add_comment → InboundEmail row
  scheduler.py     # email.poll_inbound + email.retry_failed_inbound jobs
  serializers.py / views.py / urls.py / seed.py
  migrations/0001_initial.py
  apps.py          # ready() → should_run_scheduler() then start_scheduler()
  tests.py         # 35 tests (crypto/parser/detectors/threading/idempotency/identity/e2e + priority/attachment-cap/transport/outbox-swap/test-smtp)
```

## Design decisions
- **Reuse the choke-points, don't fork them.** Inbound new mail calls
  `ticket_service.create_ticket(source="email", …)` and a reply calls `ticket_service.add_comment()`
  (public). Numbering, routing, SLA start, audit `log_event`, and notification emit all happen for free —
  email never re-implements ticket logic.
- **Outbound is two one-way hooks, not a coupling.** `itsm_notifications.services.outbox.flush` builds
  `EmailMultiAlternatives` and calls (lazy, both return `None` when the email app/channel is absent):
  (1) `hooks.email_thread_headers(ticket)` → `Message-ID`/`In-Reply-To`/`References` + `Reply-To` set
  to the **configured mailbox address** (so a reply reaches the real inbox; threading rides the
  `[KEY-N]` subject token + Message-ID map, not a plus-address);
  (2) `hooks.email_outbound_transport(ticket)` → a per-mailbox SMTP `connection` + `From`.
  **With no channel the mail is byte-identical to before** — fully backward compatible. The
  acknowledgement (TicketCreated) and agent public-reply (CommentAdded) emails are produced by the
  **existing seeded notification rules**; only the transport + From are swapped, so no new send logic.
- **Outbound SMTP reuses Django's backend.** Basic channels use the stock
  `django.core.mail.backends.smtp.EmailBackend`; OAuth channels use `smtp_backend.XOAuth2EmailBackend`
  (subclass that authenticates with `AUTH XOAUTH2 <token>`). The durable outbox keeps its retry/backoff/
  dedupe; a send failure (or OAuth refresh failure → global-backend fallback) just retries.
- **Priority is mapped, not hard-coded.** `priority.resolve_priority` reads the retained priority
  headers and looks them up in the channel's editable `priority_map`, falling back to
  `default_priority`. **Large mail degrades gracefully:** whole message > `max_size_bytes` → ignored
  (`size_cap`); a single part > `max_attachment_bytes` → skipped + private note, ticket still created.
- **Three inbound threading signals, subject-first (2026-06-28, Jira parity):** (1) **subject token**
  `[INC-123]` — scanned first; on a match thread there and skip the headers (UNGATED — explicit ticket
  number is trusted); (2) **header map** — `In-Reply-To`/`References` matched against
  `EmailThreadMessage.message_id` (reached only when the subject had no usable token); (3) **plus-address
  token** in the To/Delivered-To (`support+INC-123@domain`, still ownership-gated). No match →
  **new ticket**. A subject miss falls through (never short-circuits to new), so a reply whose subject
  was edited away still threads via the header map.
- **Idempotency first.** `(channel, message_id)` is **unique**; a re-fetched message (POP3 has no stable
  UID, redeliveries, restarts) is recognized and skipped before any ticket write.
- **Durable log for everything.** Every message becomes an `InboundEmail` row even when ignored or failed
  (`status` + `ignore_reason` + `action_taken`), so the admin log/retry surface is complete.
- **Credentials encrypted at rest.** `crypto.EncryptedField` (Fernet) wraps password/OAuth tokens; the
  key is `ITSM_CREDENTIAL_KEY` or derived from `SECRET_KEY` (dev). Serializers are write-only on secrets
  and masked on read.
- **External requestor is locked down.** `create_users` creates a **non-login** account with an
  **unusable password and NO RoleAssignment**; RBAC denies all agent access by default, so a customer
  can never see the agent app. The `default_requestor` path is used when `create_users` is off.

## Inbound pipeline (ordered)
```
poll mailbox (IMAP UNSEEN / POP3 list)
  → parse MIME (parser)
  → idempotency: (channel, message_id) already present?  → ignore
  → EmailRule allow/block lists                          → ignore (blocked)
  → detectors: auto-reply / bulk / OOO / bounce / list / self-loop / mail-loop  → ignore
  → caps: age > max_age_days, whole-message size > max_size_bytes  → ignore (size_cap)
  → strip quotes/signature
  → resolve sender → user (identity)
  → thread resolution (subject token → header map → plus-token)
      match → ticket_service.add_comment(public)
      no match → resolve priority (priority_map) → ticket_service.create_ticket(source="email")
  → save attachments (skip parts > max_attachment_bytes → private note)
  → write InboundEmail (status=processed, action_taken, linked ticket/comment)
  → write/refresh EmailThreadMessage
  → mark \Seen (IMAP)   ← only now, after the durable write
```
Any exception → `InboundEmail.status=failed` (+ retry fields); `\Seen` is **not** set, so a transient
failure is retried by `email.retry_failed_inbound` (capped at `EMAIL_MAX_INBOUND_ATTEMPTS`).

## OAuth2 (Google / Microsoft 365)
- **XOAUTH2 over IMAP (read) and SMTP (send).** Google's `https://mail.google.com/` scope covers both;
  Microsoft requests `IMAP.AccessAsUser.All` + `SMTP.Send` + `offline_access`. Provider client id/secret
  live in settings (`GOOGLE_OAUTH_CLIENT_*`, `MICROSOFT_OAUTH_CLIENT_*` + `MICROSOFT_OAUTH_TENANT`);
  per-channel only the **granted tokens** are stored (encrypted).
- **One-time consent:** `POST email-channels/{id}/oauth/start/` returns the provider consent URL;
  the provider redirects to `EMAIL_OAUTH_REDIRECT_URI` → `email/oauth/callback/` exchanges the code for
  access + refresh tokens.
- **Automatic refresh:** the poller refreshes the access token from the stored refresh token on expiry;
  no human re-consent until the refresh token itself is revoked.

## Integration seam
- **Inbound:** `itsm_email` imports `itsm_tickets.services.ticket_service` (`create_ticket`,
  `add_comment`) — the only domain entry points it touches.
- **Outbound:** `itsm_core.services.hooks.email_thread_headers(ticket)` and
  `email_outbound_transport(ticket)` — lazy hooks the notification outbox calls; each returns `None` if
  email/channel is absent (the channel never breaks notification delivery). `transport.py` imports
  `oauth` + `smtp_backend`; the notifications app never imports `itsm_email` directly.

## Scheduler wiring
`AppConfig.ready()` calls `itsm_core.scheduler_boot.should_run_scheduler()` then `start_scheduler()`,
registering two interval jobs on the shared `DjangoJobStore`: `email.poll_inbound`
(every `EMAIL_POLL_INTERVAL_SECONDS`) and `email.retry_failed_inbound`
(every `EMAIL_RETRY_INBOUND_MINUTES`), both `replace_existing=True, max_instances=1, coalesce=True`,
gated by `RUN_SCHEDULER`.
