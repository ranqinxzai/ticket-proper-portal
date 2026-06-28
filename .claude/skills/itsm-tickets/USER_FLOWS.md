# itsm-tickets — User Flows

## Flow A — Create a ticket (the vertical slice)
1. Agent opens the create wizard: pick project + ticket type, fill summary/description/priority.
2. `POST tickets` → `create_ticket`: numbers it (`INC-1`), resolves initial status from the
   project's default workflow, applies routing (group/assignee) if no assignee given, stamps
   `assigned_at` if assigned, saves.
3. On commit: `log_event("ticket_created")`, `sla_start_for_ticket`, emit `TicketCreated`
   (+ `Assigned`).
4. 201 returns the detail payload; the ticket appears in the queue.
5. **Other agents' open queues pick it up live** (no hard refresh): each queue polls `GET tickets/pulse/`
   (~15s, paused when the tab is hidden) and, on a token change, silently refetches the page — applying it
   in place when the agent is idle at the top, else staging it behind a "N new tickets · Refresh" pill so
   rows never shift under an in-progress action. Same for the end-user **My Requests** list and the
   dashboard KPIs. See SKILL.md (2026-06-28) for the mechanism.

## Flow B — Work the ticket (assign → comment → resolve)
1. `POST tickets/{id}/assign/` `{ group, assignee }` → ownership set; `Assigned` emitted.
2. Agent adds a public reply via `POST tickets/{id}/comments/` `{ body_html, visibility:"public" }`
   → body sanitized, `first_responded_at` stamped, `CommentAdded` emitted.
3. Internal note: same endpoint with `visibility:"private"` → only `comments_private` readers see it.
4. `@mention` a colleague → `mention_user_ids` recorded; `Mentioned` emitted.
5. Resolve via `POST tickets/{id}/transition/` (workflow engine).

## Flow C — Watch / link / attach
- `POST tickets/{id}/watch/` to follow; `DELETE` to unfollow.
- `POST tickets/{id}/links/` `{ target_ticket, link_type:"relates_to" }` to relate tickets.
- `POST ticket-attachments` (multipart `file`, `ticket`) to attach a file.

## Flow D — Audit / history
`GET tickets/{id}/activity/` renders the History tab: created, assigned, status changes, comments,
links — every entry written by an explicit `log_event` at its service write site.
