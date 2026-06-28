# itsm-email — User Flows

## Flow A — Supervisor connects a Gmail mailbox via OAuth
1. Open **Settings → Email Channel → Mailboxes → New mailbox**. **Connection** tab: name, project,
   address (`support@…`), protocol `imap`, host `imap.gmail.com`, `auth_method="oauth_google"`. Save.
2. Click **Connect mailbox** → `POST email-channels/{id}/oauth/start/` returns the Google consent URL;
   the supervisor grants mailbox access once (the `https://mail.google.com/` scope covers IMAP + SMTP).
3. Google redirects to `EMAIL_OAUTH_REDIRECT_URI` → `GET email/oauth/callback/` exchanges the code,
   stores the encrypted access + refresh tokens, and redirects back to the Mailboxes page.
4. **Connection** → **Test inbound connection** (XOAUTH2, no ingest) → ok. **Outbound** tab → leave SMTP
   host blank (provider default `smtp.gmail.com`) → **Test SMTP** → ok. **Field Mapping** tab: set the
   priority map + create-requestor toggle. Set `is_active=true`. The poller refreshes the access token
   automatically; no re-consent until revoked.

## Flow A2 — Basic IMAP/POP + SMTP mailbox
1. New mailbox, `auth_method="basic"`: host/port/SSL + username + password (**Connection**). Save.
2. **Outbound** tab: enable, set SMTP host/port/security (blank username/password ⇒ reuse inbound),
   from-name → **Test SMTP**. **Domains** tab (now that it's saved): add allow/block rules.

## Flow B — Inbound new email → ticket
1. `email.poll_inbound` fetches a new (UNSEEN) message from an active channel; `parser` extracts headers
   + body + attachments.
2. Guards run in order: idempotency `(channel, message_id)` → `EmailRule` allow/block → auto-reply/bulk/
   OOO/bounce/list/self-loop + mail-loop → age/size caps → quote/signature strip.
3. `identity.resolve_or_create_user` matches the sender by email; with `create_users` it makes a
   **non-login external account (no RoleAssignment)**; else uses `default_requestor`.
4. Priority is resolved via `priority.resolve_priority` (X-Priority/Importance/… → `priority_map`,
   else `default_priority`). No thread match → `ticket_service.create_ticket(source="email",
   requestor=…, summary=subject, priority=…, …)` → `INC-N` (numbering, routing, SLA, audit,
   `TicketCreated` notification all fire). Attachments are saved; any part over `max_attachment_bytes`
   is skipped and listed in a private agent note (the ticket is still created).
5. Write `InboundEmail(status=processed, action_taken=created_ticket, ticket=…)` + an
   `EmailThreadMessage`, then mark the IMAP message `\Seen` — **only now**, after the durable write.

## Flow C — Customer reply → comment
1. The customer replies to the notification mail (whose `Reply-To` is the **configured mailbox
   address**, e.g. `helpdesk@acme.com`, plus `In-Reply-To`/`References`). The reply therefore arrives
   in the very inbox the poller reads.
2. `email.poll_inbound` fetches it; threading resolves the ticket **subject-first**: (1) subject token
   — the ticket number bracketed `[INC-123]` **or bare `INC-123`** (if it resolves to a live ticket,
   thread there and skip the headers — UNGATED), else (2) header map `In-Reply-To`/`References` →
   `EmailThreadMessage`, else (3) plus-token `+INC-123` (still ownership-gated). A subject miss falls
   through to the header map (e.g. a reply with the ticket number deleted from the subject still threads).
3. `ticket_service.add_comment(ticket, body, visibility="public", author=requestor)` posts the reply as
   a public comment (stamps first-response, fires `CommentAdded`).
4. `InboundEmail(status=processed, action_taken=added_comment, ticket, comment)` is written; the message
   is marked `\Seen`.

## Flow D — Agent reviews a failed email log + retry
1. Admin → Email → Logs → `GET inbound-emails?status=failed` lists rows with `last_error` + `attempts`.
2. The agent inspects the parsed preview, fixes the cause (e.g. re-points the channel, adds an allow
   rule), then `POST inbound-emails/{id}/retry/`.
3. Retry re-runs ingestion; idempotency `(channel, message_id)` guarantees it never double-creates — it
   either now produces a ticket/comment (`processed`) or records the failure again with `attempts += 1`.
4. The background `email.retry_failed_inbound` job does the same automatically for `failed` rows up to
   `EMAIL_MAX_INBOUND_ATTEMPTS`.

## Flow E — Outbound acknowledgement + agent reply via the mailbox
1. When Flow B creates `INC-N`, the seeded `TicketCreated`→requestor notification queues a
   `NotificationOutbox` row. `outbox.flush()` asks `hooks.email_outbound_transport(ticket)`: the
   project's outbound-enabled channel returns an SMTP connection (basic) or XOAUTH2 connection (OAuth)
   + `From: "IT Support <support@…>"`, and `email_thread_headers` adds `Message-ID` + `Reply-To:`
   the configured mailbox address (e.g. `support@…`). The requestor receives the acknowledgement
   **from the mailbox address**, and a reply goes straight back to it.
2. An agent posts a **public** comment → `CommentAdded`→requestor notification → same transport → the
   reply emails out from `support@`, threaded.
3. The customer replies → Flow C threads it back as a public comment. Full loop, all on the mailbox.
4. If the mailbox has no SMTP / OAuth refresh fails, the outbox falls back to the global
   `DEFAULT_FROM_EMAIL` backend (mail still goes out; logged) — never blocks delivery.
