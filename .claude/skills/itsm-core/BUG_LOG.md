# itsm-core — Bug Log / Gotchas

- **No Django signals — ever.** Audit rows exist only where someone called `log_event`. If a new
  write path forgets the call, that change is invisible in the History tab. Grep `log_event` to
  find every audit site.
- **Hooks swallow ALL errors.** A bug inside the SLA or notification engine surfaces only in the
  `itsm` logger ("ITSM hook failed"), never as a failed request. When SLA/notifications "do
  nothing", check logs — the ticket write will have succeeded regardless.
- **Hooks no-op silently when an engine is absent.** Before `itsm_sla` / `itsm_notifications` are
  built, `sla_start_for_ticket` / `emit_event` quietly return. Expected at early milestones; don't
  mistake it for a broken hook.
- **`AuditEvent` is not soft-deletable and has no `updated_at`.** It deliberately extends only
  `UUIDModel`. Don't try to `.soft_delete()` or "edit" an event — append a new one.
- **`AuditEvent.ticket` is CASCADE.** A *hard* ticket delete (e.g. `all_objects ... .delete()`)
  cascades and erases that ticket's audit trail. Tickets normally soft-delete, so the trail
  survives — but be aware if you ever hard-delete.
- **`sanitize_html` strips disallowed tags (`strip=True`), it doesn't reject.** Sending
  `<script>` won't error; it silently disappears. Don't rely on a validation error to catch bad
  markup.
- **Mention spans depend on the allow-list.** Only `data-type/data-id/data-label/class` survive on
  `<span>`. A Tiptap mention node using other attributes will lose them after sanitize.
- **`soft_delete(user=...)` ignores anonymous users.** It stores `deleted_by` only if the user has
  a `pk`; an unauthenticated caller records `None`.
