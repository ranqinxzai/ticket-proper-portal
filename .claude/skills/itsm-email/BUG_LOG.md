# itsm-email — Bug Log / Gotchas

- **Built and live.** Inbound polling creates tickets/comments through `ticket_service`, and the
  notification outbox now threads outbound mail via the `email_thread_headers` hook. The channel is
  fully backward compatible: with no `EmailChannel`, outbound mail is byte-identical to before.
- **Idempotency is by `Message-ID`, enforced by a unique `(channel, message_id)` index.** Re-fetches,
  restarts mid-poll, and POP3 redeliveries all re-present the same message; the unique key recognizes it
  and skips before any ticket write. Never key idempotency on the server UID.
- **POP3 has no stable UID — rely on `Message-ID`.** IMAP has UIDs/`\Seen`; POP3 does not, so the
  durable `(channel, message_id)` row is the *only* dedupe signal for POP3 mailboxes. Don't assume UID
  semantics in shared code.
- **Set IMAP `\Seen` ONLY after the durable write.** Mark the message seen *after* the `InboundEmail`
  row (and ticket/comment) commit. If you flag seen first and then crash, the mail is lost — never
  re-fetched, never turned into a ticket. On failure leave it unseen so the retry job re-ingests it.
- **The external requestor must have NO RoleAssignment.** `create_users` makes a non-login account with
  an unusable password and **zero** RBAC role. This is the security lever: a customer who emails in must
  never gain agent-app access. Do not attach any `SystemRole`/`RoleAssignment` to these accounts, and
  don't fall back to a default agent role.
- **The outbox must stay byte-identical when no channel exists.** `email_thread_headers(ticket)` returns
  `{}` when the email app/channel is absent; `EmailMultiAlternatives` with no extra headers must produce
  the same wire bytes the old `send_mail` path did. Any header/Reply-To stamping is conditional on a
  resolvable channel — otherwise notification mail regresses for installs without email configured.
- **`django.utils.timezone` has no `timedelta`.** Age caps (>7d) and retry windows need
  `datetime.timedelta` — import it from `datetime`, not from `timezone`. (`timezone.now()` +
  `datetime.timedelta(...)`.) A `timezone.timedelta` attribute access fails at runtime.
- **Fernet key is derived from `SECRET_KEY` in dev.** When `ITSM_CREDENTIAL_KEY` is unset, `crypto.py`
  derives the Fernet key from `SECRET_KEY`. **Rotating `SECRET_KEY` in dev makes stored credentials
  undecryptable** — set an explicit `ITSM_CREDENTIAL_KEY` in any environment whose `SECRET_KEY` changes.
- **Auto-reply / loop detection must run before ingestion.** Honor `Auto-Submitted`, `Precedence: bulk`,
  OOO subjects, bounce (`mailer-daemon`/DSN), mailing-list headers, and self-loop (mail from the channel
  address itself); also a mail-loop threshold. Skipping these can create runaway ticket/auto-reply loops.
- **Strip quotes/signatures before creating the comment/ticket body.** Otherwise every reply re-includes
  the full prior thread, ballooning comment bodies and confusing search.
- **Caps protect the worker:** age > 7 days and size > 25 MB (`EMAIL_MAX_MESSAGE_BYTES`) are ignored with
  a recorded `ignore_reason`, not silently dropped — the `InboundEmail` row still exists for audit.
- **Threading resolution order matters:** header map → plus-address token → subject token. The subject
  token (`[INC-123]`) is the weakest signal (users edit subjects); try the header map first, and only
  fall through to a *new* ticket when all three miss.
- **Secrets are write-only in the API.** Serializers accept passwords/tokens on write and mask them on
  read; never echo a decrypted secret back in a GET.
