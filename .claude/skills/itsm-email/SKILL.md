# itsm-email

## Update (2026-10-31) — Emailed tables show their grid
- **Symptom:** GridCrest INC112 had a reply with an Outlook table (Sr No / Employee Name / New Designation). The text arrived, but the table had no borders.
- **Two causes:**
  - `sanitize_html` keeps `table/tr/td` but drops `border`, `cellpadding` and `style`, so the stored HTML is a bare `<table class="MsoNormalTable">`.
  - `.prose` is hand-written in `globals.css` (no typography plugin) and had **no table rules**.
- **Fix (CSS only; user decision):** every rich-content table gets a light grid. It covers the description, comments, the portal, print, KB and the RTE body. That fixes existing tickets too; there was nothing to backfill.
  - `table` is a block with `max-width:100%` and `overflow-x:auto`, so a wide table scrolls inside its card.
  - `th, td` get `border border-border px-2 py-1 align-top`, and `th` gets `bg-muted`.
  - `td > p` has no margin, because Outlook wraps every cell in `<p class="MsoNormal">`.
  - Print forces `#999` borders.
- Signature or layout tables get the grid too. The user accepted that; the sender's `border=0` can't be recovered from stored HTML. The sanitizer is unchanged.
- **Verified** on the `gcb-*` stack: 1px solid cells, zero `<p>` margins, a wide table scrolls with no page overflow at 1280px, and dark mode keeps the grid.

## Update (2026-10-29b) — Outlook-web CSS no longer leaks into descriptions
- GridCrest INC127 began with `P {margin-top:0;margin-bottom:0;}`. Outlook on the web puts that `<style>` in `<head>` without a comment wrapper, and bleach kept its contents as text.
- The fix is in the shared sanitizer: `itsm_core.services.html.strip_non_content`, which `sanitize_html` / `html_to_text` call first (see itsm-core). It covers descriptions, reply comments, routing (`html_to_text`) and every other rich body.
- `scrub._has_visible_content` strips it too, so a signature-only body with a `<head><style>` is kept whole instead of being cut to an empty description.
- **Existing tickets are not cleaned** (user decision). Note that replies use the HTML part only with `strip_signatures` on (or `strip_quotes` off); otherwise the text part.
- Tests: `OutlookWebStyleLeakTests` (2) and `ScrubSignatureTests.test_head_style_alone_is_not_visible_content`.
- Still open: inline `cid:` images are dropped.

## Update (2026-10-29) — Replies to a deleted ticket open a new ticket
- Threading already skipped deleted tickets (subject number, alias, header map, plus-address), so a reply to an old email of a deleted ticket becomes a **new** ticket with the normal acknowledgement (user decision 2026-10-29).
- The retry path now matches: in `inbound._run_pipeline`, a failed row still bound to a since-deleted ticket drops the binding and runs as `"new"`. Before, it could add a comment (and email) to the deleted ticket.
- Outbound mail about a deleted ticket is never sent (itsm-notifications 2026-10-29).

## Update (2026-10-18) — Bug-fix batch: default requestor in the UI, readable log labels, per-tenant bot, reset mail
- **B11.** The mailbox form has a default-requestor picker (serializer `default_requestor_detail`).
  - Validation: the user must be active and not a bot. A default requestor is **required** when `create_users` is off and the payload touches either field.
  - The list shows a "No requestor" badge.
  - Prod: mailboxes with create-requestor off and no default must pick one on their next save.
- **U16.** The email log uses `outcomeLabel` / `statusHelp`: sentence-case labels, with the raw code in the tooltip.
- **S2.** `services/system_user.get_email_bot()` caches per `connection.schema_name` (was process-wide).
- **U1.** Email routing rule and allow/block rule deletes confirm.
- **Platform mail.** Password-reset mail uses platform SMTP (`EMAIL_HOST`, `PLATFORM_NOTIFY_FROM`), not a mailbox (itsm-notifications).
- **Still open:**
  - Reply-to-closed "Create a new ticket" (comment-only).
  - The per-mailbox poll interval can't go below the global tick.
  - The OAuth callback completion isn't audit-logged.
- Supersedes the 2026-10-18 hover-help bullet "Turning off create-requestor leaves tickets with no requester".
- Batch context: `docs/BUG_LOG.md` "2026-10-18 — Bug-fix batch"; QA: `docs/QA_CHECKLIST.md` "Bug-fix batch (added 2026-10-18)".

## Update (2026-10-18) — Mailbox settings explained on hover
- `EMAIL_HELP`, `EMAIL_OUTCOME_HELP` and `EMAIL_STATUS_HELP` live in `lib/itsm/help/admin.ts`. They give an ⓘ on every mailbox option: protocol, folder, outbound, create requestor, CC watchers, auto-replies, reply-to-closed, reopen window, max age, size and loop limits, poll interval, priority map, and allowed/default project.
- The log's outcome codes are explained, and the Retry Hint says it replays text only (no formatting or attachments).
- **Copy states the real behaviour (open, BUG_LOG):**
  - Reply-to-closed "Create a new ticket" isn't implemented; it adds a comment instead, and the form shows a visible warning when it is selected.
  - Turning off create-requestor leaves tickets with no requester.
  - The per-mailbox poll interval can't go below the global tick.
  - One Allow rule blocks every other sender.
- **Corrected:** the channels-list "+N more" tooltip lists allowed projects; the old text said "by keyword".
- Primitives: `ui/hint.tsx` (`Hint`), `ui/icon-button.tsx` (`IconButton`), `ui/info-tip.tsx` (`InfoTip`); copy in `lib/itsm/help/*`. Rules + verification: `docs/QA_CHECKLIST.md` "Hover help / tooltips (2026-10-18)". Behaviour mismatches found (not fixed) are listed in `docs/BUG_LOG.md` 2026-10-18 — tooltips describe the REAL behaviour.

## Update (2026-10-14) — email-created tickets record Mode = Email
`inbound._create_ticket` now passes `custom_fields=_intake_custom_fields(project)` to
`ticket_service.create_ticket`. That's `{"mode": "email"}` when the project's **Mode** field (seeded
global value-backed dropdown `mode`, NOT column-backed) still has an active `email` option, else `{}`.
Before this, `source=email` was set but Mode stayed blank, and Source is hidden on the default layout.
The client (GridCrest) saw an empty Mode column in Reports → Ticket Data. Applies to every tenant, new
mail only; replies don't touch Mode. The value goes through `field_service.set_values` (audited as
`field_changed` by the email bot) and is passed to create-time routing, so a routing rule on Mode =
Email also matches. Existing tickets are back-filled per tenant on request (GridCrest script —
docs/BUG_LOG 2026-10-14). Tests: `InboundPipelineTests.test_new_email_ticket_records_mode_email`,
`test_mode_left_blank_when_email_option_inactive`.

## Update (2026-07-04) — one shared mailbox → multi-project keyword routing (with an ALLOWED-projects whitelist)
A mailbox is no longer 1:1 with a project. Two pieces:
- **Allowed-projects whitelist** (`EmailChannelProject` join, migration `0007`): the explicit set of
  projects a mailbox may ever create/serve tickets in. `EmailChannel.project` is the **default**
  (fallback) and must be one of the allowed. Email can **never** open a ticket in a project that isn't
  allowed — so an admin who allows only Incident + Request guarantees email never files into Change.
  All allowed projects are constrained to the channel's **helpdesk**. `services.routing.allowed_projects`
  / `served_projects` read it (empty links ⇒ `[channel.project]`, backward compatible).
- **Keyword rules** (`EmailRoutingRule`, migration `0004`): an ordered list; each rule tests the inbound
  subject/body for **whole-word/phrase, case-insensitive** keywords (`match_in` subject|body|subject_body,
  `match_type` any|all) and, on the **first** match by `order`, files the ticket into `target_project`
  (which MUST be an allowed project — `resolve_target` skips any rule whose target isn't allowed). No
  match ⇒ the default. Rules are **project-only** (assignment group + priority stay mailbox-level).

New service **`services/routing.py`** (`allowed_projects`, `resolve_target`, `served_projects`,
word-boundary matcher, HTML-body derivation); wired at `inbound._create_ticket`.
`InboundEmail.matched_rule` records which rule filed a ticket (shown on the email log). API:
**`email-routing-rules`** CRUD + `EmailChannelSerializer.allowed_projects` (read+write list of ids) +
nested `routing_rules`. UI: **Allowed projects** checkbox list + a **Default project** picker shown only
when >1 allowed + a **Routing** tab (`email-routing-rules-editor.tsx`, targets limited to the allowed
set). Backward compatible: a mailbox with one allowed project + zero rules behaves like the old
single-project mailbox. Migration `0007` backfills existing channels' whitelist = `{project} ∪ {active
rule targets}`.
- **Threading is now multi-served-project.** `resolve_thread` scans the subject for a ticket number of
  **any** served (= allowed) project, so a reply quoting a routed-project ticket (`ITREQ42`) threads even
  though the default is Incident. The header map (channel-keyed) already spanned projects; plus-address
  is scanned per served key.
- **Outbound mailbox is resolved originating-channel-first** (`transport`/`threading` `_channel_for_ticket`):
  the mailbox that actually ingested the ticket (its recorded `EmailThreadMessage`) → fallback-project
  match → active-rule-target match → None/global. A routed ticket therefore still sends its ack/reply
  FROM the right address and threads back, even if two mailboxes overlap a project.
- **Fixed a latent, pre-existing bug found here:** ticket numbers are `{KEY}{N}` **with no separator**
  (`ITINC1`, per `itsm_tickets.services.numbering` "client preference"), but the threading token matchers
  (`_token_re`, `_plusaddr_token`) still required a hyphen (`KEY-\d+`) — so **subject/plus-address
  reply-threading silently broke** once numbering dropped the hyphen (7 threading tests were red). The
  matcher now accepts an **optional** hyphen (`KEY-?N`), so both current no-separator numbers and any
  legacy `KEY-N` tickets thread. See BUG_LOG.

## Update (2026-07-03) — old ticket numbers thread after a project move
`resolve_thread` (`services/threading.py`) now consults **`itsm_tickets.TicketNumberAlias`** when a
subject/plus-address `[KEY-N]` token doesn't resolve to a live ticket in `channel.project`: an
inbound reply quoting the ticket's **pre-move** number threads onto the moved ticket (same-helpdesk
scope) instead of opening a new one. New module helper `_alias_ticket(number, channel)`; the subject
path stays ungated, the plus-address path stays participant-gated (unchanged trust model). Header-map
(Message-ID) threading already survived the move. See **itsm-tickets** (2026-07-03).

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
- **`EmailChannel`** — a configured mailbox. `project` FK (PROTECT) is the **default** project;
  **`EmailChannelProject`** rows are the **allowed-projects whitelist** (the ceiling of where email may
  file), and `EmailRoutingRule` rows route among them by keyword (see the 2026-07-04 update +
  `services/routing.py`). Inbound:
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
- **From precedence (2026-06-28).** The notification `From` is resolved at send time in
  `itsm_notifications/services/outbox.flush`: **mailbox `channel.from_header`** (transport, when the
  project has an outbound `EmailChannel`) → **helpdesk `notification_from_header`** (the per-helpdesk
  "Email Notification" setting, used ONLY when there's no mailbox) → global **`DEFAULT_FROM_EMAIL`**.
  The mailbox always wins when configured (SPF/DKIM alignment). The helpdesk From lives on the
  `Helpdesk` model (`notification_from_name`/`notification_from_email`, migration `0003`; the
  `notification_from_header` property formats `"Name <addr>"`, "" when blank) — see itsm-notifications
  + the **Settings → Project Configuration → Email Notification** page (`itsm.admin.helpdesks`).
  Reply-To is unchanged (always the mailbox address, set by `threading.build_outbound_headers`).
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
  — the ticket number in the subject, **bracketed `[INC-123]` OR bare `INC-123`** (users type the bare
  number; `_token_re` is `\b(KEY-\d+)\b`) — scanned FIRST; if it resolves to a live ticket, thread there
  and DO NOT scan headers,
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
