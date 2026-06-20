# itsm-email

## Purpose
Bidirectional Email Channel: inbound IMAP/POP polling turns email into tickets and replies into
comments through the existing ticket choke-points; outbound notification mail is now threaded
(Message-ID/In-Reply-To/References + plus-addressed Reply-To) so customer replies land back on the
right ticket.
**Status: BUILT** — `backend/apps/itsm_email/` is fully implemented and validated: `models.py`,
`crypto.py` (Fernet `EncryptedField`), the inbound parser/detectors/threading services, OAuth2
(Google + Microsoft 365 XOAUTH2), APScheduler poll jobs, seed, serializers/views/urls, and
`migrations/0001_initial.py`. 23 tests pass. This skill documents the design.

## Backend app path
`backend/apps/itsm_email/` (built — the channel is live).

## Key concepts
- **`EmailChannel`** — one configured mailbox (host/port/protocol IMAP|POP3, auth basic|google|microsoft,
  encrypted credentials, `default_requestor`, `create_users`, `is_active`). Polled by the scheduler.
- **Inbound = ticket/comment via the existing choke-points.** A new email →
  `ticket_service.create_ticket(source="email")`; a reply → `ticket_service.add_comment()` (public).
  Numbering, routing, SLA, audit, notifications are all **reused**, never re-implemented.
- **`InboundEmail`** — the durable log row for **every** message (status received/processed/ignored/
  failed, `ignore_reason`, `action_taken`, linked `ticket`/`comment`, retry fields). The "email logs /
  failed requests" surface.
- **`EmailThreadMessage`** — the header map row (`message_id`, `in_reply_to`, `references`, ticket) used
  to resolve inbound replies back to their ticket.
- **`EmailRule`** — allow/block lists (per channel) applied before ingestion.
- **Threading (inbound resolution):** (A) header map (In-Reply-To/References → `EmailThreadMessage`),
  (B) plus-address token (`support+INC-123@…`), (C) subject token `[INC-123]`. No match → new ticket.
- **Threading (outbound):** the notification outbox sends via `EmailMultiAlternatives` and, via the new
  lazy hook `itsm_core.services.hooks.email_thread_headers`, sets `Message-ID`/`In-Reply-To`/
  `References` + a plus-addressed `Reply-To`. With no channel it sends a plain, **byte-identical** mail.
- **OAuth2:** Google + Microsoft 365 via **XOAUTH2 over IMAP** (one-time consent + automatic token
  refresh). Provider client id/secret in settings; per-channel only the granted tokens are stored.
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
  mail. `\Seen` is set **only after a durable write**.
- **`email.retry_failed_inbound`** (every `EMAIL_RETRY_INBOUND_MINUTES`) — reprocesses `failed`
  `InboundEmail` rows up to `EMAIL_MAX_INBOUND_ATTEMPTS`.

## Frontend path / pages
`app/(itsm)/admin/email/page.tsx` (channels + rules config) and
`app/(itsm)/admin/email/logs/page.tsx` (inbound log + retry). Zero new frontend deps.

## API clients
Live endpoints under `/api/v1/itsm/`: `email-channels` (CRUD + `{id}/test-connection/`,
`{id}/poll-now/`, `{id}/oauth/start/`), top-level `email/oauth/callback/`, `email-rules` (CRUD),
`inbound-emails` (read-only + `{id}/retry/`).

## RBAC module codes
- **`itsm.email`** (parent) → **`itsm.email.channels`** (Supervisor-only config) +
  **`itsm.email.logs`** (Agent read-only). Added to `itsm_rbac/registry.py`; seeded by `seed_rbac()`.

## Seed
A non-login **`email-bot`** system user (audit actor / `created_by`) seeded via a new `seed_itsm` STEP.

## Key files
`models.py` (EmailChannel/InboundEmail/EmailThreadMessage/EmailRule), `crypto.py` (`EncryptedField`),
the inbound parser/detectors/threading/identity services, the OAuth2 (Google/MS) client + token refresh,
`serializers.py`, `views.py`, `urls.py`, `seed.py`, `scheduler.py` (`email.poll_inbound` +
`email.retry_failed_inbound`), `tests.py` (23 tests), `migrations/0001_initial.py`. New dep:
`cryptography`.
