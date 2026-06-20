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

## One-way hook into itsm-notifications
- **`itsm_notifications.services.outbox.flush` now sends via `EmailMultiAlternatives`** and calls
  `itsm_core.services.hooks.email_thread_headers(ticket)` to stamp `Message-ID`/`In-Reply-To`/
  `References` + a plus-addressed `Reply-To`. This is the **only** coupling between the two, and it is
  **one-way**: notifications never import `itsm_email`. When no `EmailChannel` exists the hook returns
  `{}` and outbound mail is **byte-identical** to the pre-email behavior — so notifications work
  unchanged on installs without the email channel.
- The same outbound send writes an **outbound `EmailThreadMessage`** row, so a customer's reply can be
  resolved back to the originating ticket by the inbound header map.

## Depended on by
- **itsm-tickets** — email-sourced tickets (`source="email"`) and reply comments surface in the normal
  queue/detail; the inbound-emails admin log links back to the ticket/comment it produced.

## Hook contract (live in itsm_core)
`email_thread_headers(ticket) -> dict` — lazy; returns the threading headers + `Reply-To` for the
ticket's channel, or `{}` when email is absent. Consumed by the notification outbox; never raises into
the flusher.
