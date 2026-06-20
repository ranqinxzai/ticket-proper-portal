# itsm-notifications — Interlinking

## Will depend on
- **itsm-core** — `BaseModel`, `sanitize_html`; implements `bus.emit` for
  `itsm_core.hooks.emit_event`.
- **itsm-tickets** — events originate from `ticket_service` (`TicketCreated`, `Assigned`,
  `CommentAdded`/`CommentAddedPrivate`, `Mentioned`); `Watcher` + `MentionRecord` feed recipient
  resolution.
- **itsm-workflows** — `StatusChanged` (+ per-PF `emit_event`) events; `Resolved`/`Closed` derive
  from status transitions.
- **itsm-groups** — `group_members` / `group_lead` resolvers read memberships + `Group.lead`.
- **itsm-rbac** — `role` resolver targets users by `SystemRole`; inbox gated by
  `itsm.notifications.inbox`.
- **itsm-projects** — `NotificationScheme.project` scope.
- **itsm-sla** — `SLAWarning` / `SLABreach` events come from escalation actions.

## Depended on by
- **itsm-tickets** — the notification bell + inbox surface here.
- **itsm-sla** — escalation `notify` action calls the bus.
- **itsm-email** — a **one-way** hook: `outbox.flush` now sends via `EmailMultiAlternatives` and calls
  `itsm_core.services.hooks.email_thread_headers(ticket)` to stamp `Message-ID`/`In-Reply-To`/
  `References` + a plus-addressed `Reply-To` so customer replies thread back to the ticket. Notifications
  never import `itsm_email`; with no channel the hook returns `{}` and the mail stays **byte-identical**.

## Hook contract (live in itsm_core)
`emit_event(event_type, ticket, actor=None, context=None)` → `bus.emit`. The bus is now live, so the
hook delivers notifications for real without the emitting services needing any changes.
