# itsm-notifications — User Flows

## Flow A — Supervisor configures notifications
1. Open the Notification Scheme Editor for a project.
2. Add rules: e.g. `Assigned → [assignee] via in_app+email`, `CommentAdded → [requestor, watchers]`,
   `SLABreach → [group_lead, role:supervisor]`.
3. Edit the matching `EmailTemplate`s in the Tiptap editor (subject + body, deep-links).

## Flow B — Event fires
1. An agent assigns a ticket → `ticket_service.assign` emits `Assigned` post-commit.
2. `bus.emit` resolves the scheme → the `Assigned` rule → recipients (the assignee), dedupes,
   suppresses the actor, renders the template.
3. Writes an `InAppNotification` (bell badge updates) + enqueues an email row in the outbox.

## Flow C — Delivery
1. The ~30s flusher claims queued rows (`skip_locked`), sends email via the Django backend
   (console in dev), marks `sent`; failures back off and eventually go `dead`.
2. `dedupe_key` ensures the same notification isn't sent twice.

## Flow D — Agent reads the inbox
1. Bell shows `GET notifications/unread-count`.
2. Open the popover → `GET notifications`; click one → `POST notifications/{id}/read` and deep-link
   to the ticket; "Mark all read" → `POST notifications/mark-all-read`.
