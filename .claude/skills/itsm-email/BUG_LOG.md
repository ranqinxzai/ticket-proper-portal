# itsm-email — Bug Log / Gotchas

- **Allowed-projects is an EXPLICIT whitelist, not derived from rules (2026-07-04).** A mailbox's
  reachable projects are the `EmailChannelProject` links, NOT `{project} ∪ rule targets`. This is what
  lets an admin allow only Incident + Request and be sure email never files into Change. Consequences to
  keep: (1) `routing.resolve_target` **skips any rule whose `target_project` isn't allowed** — a rule
  can never smuggle mail into a non-allowed project even if it survives a whitelist shrink; (2) a channel
  with **no** links falls back to `[channel.project]` (so legacy/un-backfilled mailboxes still work) —
  migration `0007` backfills existing channels' links = `{project} ∪ {active rule targets}` to preserve
  prior behaviour; (3) the serializer's `allowed_projects` write **soft-deletes** removed links and
  revives them via `all_objects.update_or_create` (the `(channel, project)` unique constraint spans
  soft-deleted rows, so a plain `.create()` on re-add would violate it); (4) removing a project from the
  whitelist while an **active** rule still targets it is **rejected** (retarget/remove the rule first) —
  don't silently drop rules.
- **Ticket numbers have NO separator — the threading matchers must not require a hyphen (fixed
  2026-07-04).** `itsm_tickets.services.numbering` produces `{project.key}{N}` **with no separator**
  (`ITINC1`, "client preference"), but `threading._token_re`/`_plusaddr_token` were still
  `\b(KEY-\d+)\b` — a **required** hyphen. So once numbering dropped the hyphen, **subject and
  plus-address reply-threading silently broke**: every reply opened a NEW ticket instead of threading
  (7 threading tests went red, unnoticed because the suite wasn't re-run after the numbering change).
  Fix: the matcher now accepts an **optional** hyphen (`KEY-?N`) so both current no-separator numbers
  and any legacy `KEY-N` tickets thread. Lesson: when you change the ticket-number FORMAT, grep for
  every regex that parses it (`itsm_email/services/threading.py`, plus-address, subject) and re-run
  the email suite — the header-map path masks the breakage for replies to mail WE sent, so manual
  testing can look fine.
- **Keyword routing matches WHOLE WORDS / phrases, not substrings (decided 2026-07-04).**
  `services/routing.py` compiles each keyword as `(?<!\w)<escaped, internal-space→\s+>(?!\w)` (case-
  insensitive). This mirrors the existing ticket-key matcher's word-boundary choice (and its
  `test_subject_token_substring_does_not_match` precedent): `access` matches the word "access" but not
  "accessory", while `password reset` still matches the phrase. Raw substring was rejected — it makes
  short keywords (`it`, `req`) match inside unrelated words and misroute.
- **HTML-only mail: derive body text for routing (fixed 2026-07-04).** `parser.parse` leaves
  `body_text` blank for an HTML-only (or empty-text-part) message. `routing._text_for` therefore uses
  `(body_text or "").strip() or html_to_text(body_html)` — **`.strip()` matters**: an empty MIME text
  part parses to whitespace (`"\n"`), which is truthy, so a bare `body_text or …` would scan the
  whitespace and never fall through to the HTML → body/subject_body rules silently miss on Outlook/
  mobile HTML mail. Regression guard: `RoutingResolveTests.test_html_only_body_matches`.
- **Routing target soft-delete bypasses `PROTECT` (2026-07-04).** `EmailRoutingRule.target_project` is
  `PROTECT`, but the app **soft-deletes** (and can `status=archived`) projects, which `PROTECT` does
  not block. So `routing.resolve_target`/`served_projects` filter `target_project.is_deleted` at read
  time (and the serializer rejects a deleted target on write) — never rely on the FK constraint for a
  live-project invariant here.
- **Outbound mailbox is resolved originating-channel-first, NOT by `project=ticket.project` (2026-07-04).**
  With shared mailboxes a ticket's `project` can be a routing TARGET (not the channel's fallback
  `project`), so the old `filter(project=ticket.project)` in `transport`/`threading` `_channel_for_ticket`
  missed the serving mailbox (→ ack/reply from the wrong From, or a broken `References` chain when two
  mailboxes overlap a project). Now: `ticket.email_messages` (the recorded originating `EmailThreadMessage`)
  → fallback-project match → active-rule-target match → None(transport)/global(threading). Keep the
  transport helper returning **None** (no global fallback) so the no-channel outbox stays byte-identical.
- **The ungated-subject trust now spans ALL served projects (2026-07-04).** `resolve_thread` scans the
  subject for a ticket number of any served project (fallback + active rule targets). The accepted
  "forgeable `[KEY-N]` threads without an owner gate" tradeoff (see the 2026-06-28 SECURITY note below)
  therefore now covers every served project of the helpdesk, not just one — same class (helpdesk-scoped,
  live ticket, reopen-window-gated, audited), wider surface. Don't re-gate without a product decision.
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
  **subject token `KEY-N` → header map → plus-address token → new**. The subject is scanned first;
  on a match we thread there and skip the headers. The previous order (header → plus → subject) was
  reversed at the user's request to mirror Jira's inbound flow (scan subject for an issue key first,
  only then the `In-Reply-To` header).
  - **Subject token matches BRACKETED `[KEY-N]` OR BARE `KEY-N` (fixed 2026-06-28).** The original
    `_token_re` was `\[\s*(KEY-\d+)\s*\]` — brackets REQUIRED. Real users type the bare number
    ("ITINC-626 printer still down"), so those replies silently created NEW tickets (e.g. ITINC-629
    "ITINC-626 New" instead of a note on ITINC-626). Now `_token_re` is `\b(KEY-\d+)\b`, which matches
    both forms; `\b` stops a substring match inside a longer word ("XITINC-626" → no match). Tradeoff:
    a subject that merely *mentions* a ticket number ("similar to ITINC-100") now threads onto it —
    inherent to the ungated "any ticket number in the subject" contract.
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
