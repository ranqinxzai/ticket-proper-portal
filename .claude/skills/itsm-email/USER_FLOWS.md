# itsm-email — User Flows

## Flow A — Supervisor connects a Gmail mailbox via OAuth
1. Open Admin → Email → create an `EmailChannel`: name, address (`support@…`), protocol `imap`, host
   `imap.gmail.com`, `auth_type="google"`, pick a `default_requestor` (or enable `create_users`).
2. Click **Connect** → `POST email-channels/{id}/oauth/start/` returns the Google consent URL; the
   supervisor grants mailbox access once.
3. Google redirects to `EMAIL_OAUTH_REDIRECT_URI` → `GET email/oauth/callback/` exchanges the code and
   stores the encrypted access + refresh tokens on the channel.
4. Click **Test connection** → `POST email-channels/{id}/test-connection/` (XOAUTH2 connect+auth, no
   ingest) → `{ ok:true }`. Set `is_active=true`. The poller now refreshes the access token
   automatically from the refresh token; no re-consent until it's revoked.

## Flow B — Inbound new email → ticket
1. `email.poll_inbound` fetches a new (UNSEEN) message from an active channel; `parser` extracts headers
   + body + attachments.
2. Guards run in order: idempotency `(channel, message_id)` → `EmailRule` allow/block → auto-reply/bulk/
   OOO/bounce/list/self-loop + mail-loop → age/size caps → quote/signature strip.
3. `identity.resolve_or_create_user` matches the sender by email; with `create_users` it makes a
   **non-login external account (no RoleAssignment)**; else uses `default_requestor`.
4. No thread match → `ticket_service.create_ticket(source="email", requestor=…, summary=subject, …)` →
   `INC-N` (numbering, routing, SLA, audit, `TicketCreated` notification all fire).
5. Write `InboundEmail(status=processed, action_taken=created_ticket, ticket=…)` + an
   `EmailThreadMessage`, then mark the IMAP message `\Seen` — **only now**, after the durable write.

## Flow C — Customer reply → comment
1. The customer replies to the notification mail (which carried `Reply-To: support+INC-123@domain` and
   `In-Reply-To`/`References`).
2. `email.poll_inbound` fetches it; threading resolves the ticket: (A) `In-Reply-To`/`References` →
   `EmailThreadMessage`, else (B) plus-token `+INC-123`, else (C) subject `[INC-123]`.
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
