# itsm-core — User Flows

itsm-core has no UI; these are the developer/runtime flows it powers.

## Flow A — Recording an activity (every ticket write)
1. A service mutates a ticket (e.g. `ticket_service.assign`).
2. Inside `transaction.on_commit`, it calls `log_event(ticket, actor, "assigned", payload={...})`.
3. `log_event` inserts one `AuditEvent` row.
4. The frontend History tab reads them via `GET /tickets/{id}/activity/`.

## Flow B — Saving rich text safely
1. User submits HTML (Tiptap) for a description or comment.
2. The service calls `sanitize_html(raw)` → stored in `*_html`; `html_to_text(raw)` → `*_text`.
3. Disallowed tags/scripts are stripped; the frontend renders the stored `*_html` safely.

## Flow C — Nudging an engine without coupling
1. After a status change, `engine.transition` calls `hooks.sla_on_status_change(...)` and
   `hooks.emit_event("StatusChanged", ...)` in `on_commit`.
2. If the engine exists, its service runs; if not, the hook no-ops. Either way the ticket write
   has already committed.

## Flow D — Seeding a fresh environment
1. `python manage.py migrate`.
2. `python manage.py seed_itsm` → runs RBAC → workflows → (SLA) → (notifications) → groups →
   ticket-types → projects, skipping unbuilt steps, printing `✓ seeded` / `• skip` per step.
3. Re-running is safe (every step is `get_or_create`/`update_or_create`).
