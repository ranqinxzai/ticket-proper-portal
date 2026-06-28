# itsm-email — Bug Log / Gotchas

- **Built and live (2026-06-22).** Restored from `archive/old-backend/apps/itsm_email/` into the live
  tree and extended with per-mailbox **SMTP outbound** (acknowledgement + agent replies from support@),
  configurable **priority mapping**, a per-attachment **size cap**, a visible **field-mappings** block,
  and a current-shell admin UI. Inbound polling creates tickets/comments through `ticket_service`; the
  notification outbox threads + sends outbound mail via the `email_thread_headers` +
  `email_outbound_transport` hooks. Fully backward compatible: with no `EmailChannel`, outbound mail is
  byte-identical to before. 53 tests pass; tickets + notifications suites still green.
- **Django's stock SMTP backend has no XOAUTH2.** OAuth mailboxes (Gmail/O365) can't `login()` with a
  password — they must `AUTH XOAUTH2 <base64(user…token)>`. `smtp_backend.XOAuth2EmailBackend` subclasses
  the stock backend and overrides `open()` for this. Basic channels keep the stock backend unchanged. The
  Microsoft OAuth scope must include `SMTP.Send` (added) or sends 535-auth-fail even when IMAP works.
- **Outbound transport must fail soft.** `transport.get_outbound_config` catches `OAuthError` (refresh
  failed) and any build error → returns `None` so the outbox falls back to the global backend; the email
  still goes out. Never let a mailbox SMTP problem dead-letter ticket notifications.
- **Priority signals are mapped, never hard-coded.** Keep `parser.keep` retaining `X-Priority`,
  `Importance`, `X-MSMail-Priority`, `Priority`; `priority.resolve_priority` looks them up in the
  channel's editable `priority_map` (else `default_priority`). Don't bake a fixed table into the resolver.
- **Large attachments are skipped, not fatal.** A single part over `max_attachment_bytes` is skipped and
  reported in a private agent note; the ticket/comment is still created. The whole-message
  `max_size_bytes` cap is the separate, harder guard (→ ignored `size_cap`).
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
- **Reply-To must be the REAL configured mailbox address — never a synthetic `support+token` (fixed
  2026-06-28).** `build_outbound_headers` used to mint `Reply-To = <EMAIL_REPLY_TO_LOCALPART>+<KEY-N>@<domain>`
  (a hardcoded `support` localpart). If the configured mailbox was e.g. `helpdesk@acme.com`, replies were
  addressed to `support+KEY-N@acme.com` — an address that doesn't exist on the server, so the reply bounced
  / was never polled and the loop silently broke. Now `reply_to = [channel.address]` (the mailbox itself),
  which is the most deliverable form (no dependency on `+` subaddressing, which many Exchange/on-prem
  servers reject). Reply→ticket threading is unaffected: it rides the `[KEY-N]` subject token (scanned
  first) + the recorded `Message-ID`/`In-Reply-To`/`References` map. Inbound still ACCEPTS a plus-address
  token from any client — we just stop *minting* one outbound. The dead `EMAIL_REPLY_TO_LOCALPART` setting
  was removed; `EMAIL_DOMAIN`/`channel.domain` now affect only the synthetic Message-ID host.
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
- **Threading resolution order — subject-first (changed 2026-06-28, Jira parity).** Order is now
  **subject token `[INC-123]` → header map → plus-address token → new**. The subject is scanned first;
  on a match we thread there and skip the headers. The previous order (header → plus → subject) was
  reversed at the user's request to mirror Jira's inbound flow (scan subject for an issue key first,
  only then the `In-Reply-To` header).
  - **A subject miss must FALL THROUGH, never short-circuit to `new`.** When the subject has no token,
    an unknown/deleted ticket number, the code MUST continue to the header map (and then plus-token).
    This is what keeps agent reply-by-email working: an agent isn't the requestor/watcher, but their
    reply carries `[INC-123]` (now matched directly) or at least our minted `In-Reply-To` (header map).
    Do not "optimize" the subject block to `return ('new', None)` on a miss — `test_subject_token_
    unknown_ticket_falls_through_to_header_map` guards this.
- **SECURITY tradeoff — the subject path is UNGATED (2026-06-28), reversing the 2026-06-25 gate.**
  The 2026-06-25 fix added `_sender_owns_ticket` to the subject token path because `[INC-123]` is
  trivially forgeable — without it, anyone who guessed a ticket number could inject a **public** comment
  and trigger a reopen. The user has accepted that tradeoff to get literal "if the subject has a valid
  ticket number, add the note to it" behavior, so the gate is **removed from the subject path**.
  Residual mitigations that still hold: the number must resolve to a *live ticket in the channel's
  project*; reopen still requires `reopen_policy == REOPEN` within the window; the comment is public +
  audited. **The plus-address path KEEPS its `_sender_owns_ticket` gate** (`test_plus_address_token_
  from_stranger_is_new`), and the header map remains ungated (it needs a Message-ID we minted). Do not
  re-add the subject gate without a product decision — `test_subject_token_from_stranger_now_threads`
  encodes the current contract.
- **Secrets are write-only in the API.** Serializers accept passwords/tokens on write and mask them on
  read; never echo a decrypted secret back in a GET.
