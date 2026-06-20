# itsm-email — Architecture

## Current state
`backend/apps/itsm_email/` is **BUILT** and validated: `models.py` with all four models, `crypto.py`,
the inbound services, OAuth2 (Google/MS) + token refresh, scheduler jobs, seed, serializers/views/urls,
and `migrations/0001_initial.py`. Tables exist; 23 tests pass.

## Layout
```
itsm_email/
  models.py        # EmailChannel, InboundEmail, EmailThreadMessage, EmailRule
  crypto.py        # EncryptedField (Fernet); key from ITSM_CREDENTIAL_KEY or derived from SECRET_KEY
  services/
    poller.py      # IMAP/POP connect, fetch UNSEEN, mark \Seen only after durable write
    parser.py      # MIME → {from, subject, message_id, in_reply_to, references, text, html, attachments}
    detectors.py   # auto-reply/bulk/OOO/bounce/mailing-list/self-loop + mail-loop threshold
    threading.py   # resolve inbound → ticket (header map → plus-token → subject token); thread headers
    identity.py    # resolve_or_create_user (external non-login account, no RoleAssignment)
    oauth.py       # Google + Microsoft 365 XOAUTH2: consent URL, callback exchange, refresh
    ingest.py      # orchestration: guards → create_ticket / add_comment → InboundEmail row
  scheduler.py     # email.poll_inbound + email.retry_failed_inbound jobs
  serializers.py / views.py / urls.py / seed.py
  migrations/0001_initial.py
  apps.py          # ready() → should_run_scheduler() then start_scheduler()
  tests.py         # 23 tests (crypto, parser, detectors, threading, idempotency, identity, e2e, headers)
```

## Design decisions
- **Reuse the choke-points, don't fork them.** Inbound new mail calls
  `ticket_service.create_ticket(source="email", …)` and a reply calls `ticket_service.add_comment()`
  (public). Numbering, routing, SLA start, audit `log_event`, and notification emit all happen for free —
  email never re-implements ticket logic.
- **Outbound threading is a one-way hook, not a coupling.** `itsm_notifications.services.outbox.flush`
  now builds `EmailMultiAlternatives` and calls `itsm_core.services.hooks.email_thread_headers(ticket)`
  (lazy import; returns `{}` when the email app/channel is absent). It stamps
  `Message-ID`/`In-Reply-To`/`References` + a plus-addressed `Reply-To`. **With no channel the mail is
  byte-identical to before** — fully backward compatible.
- **Three inbound threading signals, tried in order:** (A) header map — `In-Reply-To`/`References`
  matched against `EmailThreadMessage.message_id`; (B) plus-address token in the To/Delivered-To
  (`support+INC-123@domain`); (C) subject token `[INC-123]`. No match → **new ticket**.
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
  → caps: age > 7d, size > 25 MB                          → ignore
  → strip quotes/signature
  → resolve sender → user (identity)
  → thread resolution (header → plus-token → subject token)
      match → ticket_service.add_comment(public)
      no match → ticket_service.create_ticket(source="email")
  → write InboundEmail (status=processed, action_taken, linked ticket/comment)
  → write/refresh EmailThreadMessage
  → mark \Seen (IMAP)   ← only now, after the durable write
```
Any exception → `InboundEmail.status=failed` (+ retry fields); `\Seen` is **not** set, so a transient
failure is retried by `email.retry_failed_inbound` (capped at `EMAIL_MAX_INBOUND_ATTEMPTS`).

## OAuth2 (Google / Microsoft 365)
- **XOAUTH2 over IMAP.** Provider client id/secret live in settings
  (`GOOGLE_OAUTH_CLIENT_*`, `MICROSOFT_OAUTH_CLIENT_*` + `MICROSOFT_OAUTH_TENANT`); per-channel only the
  **granted tokens** are stored (encrypted).
- **One-time consent:** `POST email-channels/{id}/oauth/start/` returns the provider consent URL;
  the provider redirects to `EMAIL_OAUTH_REDIRECT_URI` → `email/oauth/callback/` exchanges the code for
  access + refresh tokens.
- **Automatic refresh:** the poller refreshes the access token from the stored refresh token on expiry;
  no human re-consent until the refresh token itself is revoked.

## Integration seam
- **Inbound:** `itsm_email` imports `itsm_tickets.services.ticket_service` (`create_ticket`,
  `add_comment`) — the only domain entry points it touches.
- **Outbound:** `itsm_core.services.hooks.email_thread_headers(ticket)` — a lazy hook the notification
  outbox calls; returns `{}` if email is absent (the channel never breaks notification delivery).

## Scheduler wiring
`AppConfig.ready()` calls `itsm_core.scheduler_boot.should_run_scheduler()` then `start_scheduler()`,
registering two interval jobs on the shared `DjangoJobStore`: `email.poll_inbound`
(every `EMAIL_POLL_INTERVAL_SECONDS`) and `email.retry_failed_inbound`
(every `EMAIL_RETRY_INBOUND_MINUTES`), both `replace_existing=True, max_instances=1, coalesce=True`,
gated by `RUN_SCHEDULER`.
