# itsm-email — Interlinking

## Depends on
- **itsm-tickets** — the only domain entry points it touches: `ticket_service.create_ticket(
  source="email", …)` for new mail and `ticket_service.add_comment()` (public) for replies. All
  numbering / comments / attachments / mentions logic is reused, not forked.
- **itsm-projects** — new email tickets are created under a project (project/ticket-type defaults +
  routing), exactly like agent-created tickets.
- **itsm-core** — `BaseModel` (all four models), `sanitize_html` for inbound bodies, and the lazy hook
  surface `itsm_core.services.hooks.email_thread_headers(ticket)` it provides for outbound threading.
- **itsm-rbac** — registers `itsm.email` / `itsm.email.channels` / `itsm.email.logs` in
  `itsm_rbac/registry.py` (seeded by `seed_rbac()`); the **security lever** is RBAC denying all access to
  the non-login external requestor accounts (no `RoleAssignment`).
- **itsm-groups / itsm-sla / itsm-workflows** — inherited transitively: because inbound goes through
  `create_ticket`, routing rules, SLA clocks, and the seeded workflow all apply automatically.

## One-way hooks into itsm-notifications
- **`itsm_notifications.services.outbox.flush` sends via `EmailMultiAlternatives`** and calls two lazy
  hooks in `itsm_core.services.hooks`: `email_thread_headers(ticket)` (stamps `Message-ID`/`In-Reply-To`/
  `References` + `Reply-To` = the configured mailbox address) and **`email_outbound_transport(ticket)`**
  (returns a per-mailbox SMTP `connection` + `From` so acks/agent-replies leave from the mailbox address). These
  are the **only** coupling and they are **one-way**: notifications never import `itsm_email`. When no
  `EmailChannel` exists both hooks return `None` and outbound mail is **byte-identical** to the
  pre-email behavior.
- No new notification rules were added — the seeded `TicketCreated`→requestor (acknowledgement) and
  public `CommentAdded`→requestor (agent reply) rules already produce the mail; the email app only
  swaps the transport + From + threading headers.
- The same outbound send writes an **outbound `EmailThreadMessage`** row, so a customer's reply can be
  resolved back to the originating ticket by the inbound header map.

## Depended on by
- **itsm-tickets** — email-sourced tickets (`source="email"`) and reply comments surface in the normal
  queue/detail; the inbound-emails admin log links back to the ticket/comment it produced.

## Hook contracts (live in itsm_core.services.hooks)
- `email_thread_headers(ticket, recipient_email, *, outbox_id, subject) -> {"headers", "reply_to"} | None`
  — threading headers + `Reply-To` (= the channel's configured mailbox address), or `None` when email is absent.
- `email_outbound_transport(ticket) -> {"connection", "from_email"} | None` — a built (not opened)
  Django SMTP connection + From for the ticket's outbound-enabled mailbox, or `None` (→ global backend).
Both are lazy, consumed by the notification outbox, and never raise into the flusher.
