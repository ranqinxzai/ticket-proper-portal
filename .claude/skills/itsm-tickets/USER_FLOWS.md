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

### C1 — Watch
- `POST tickets/{id}/watch/` to follow; `DELETE` to unfollow.

### C2 — Link (add / view inbound+outbound / remove)
1. In the ticket detail, the **Linked issues** rail card lists related tickets grouped by
   relationship (`relates to` / `blocks` / `is blocked by` / `duplicates` / … ), each linking
   through to its detail. Incidents and requests link freely — a target is just any ticket the
   agent can access.
2. **Link issue** → pick a `link_type` + search the target (`TicketSearchCombobox`) →
   `POST tickets/{id}/links/` `{ target_ticket, link_type }`. The far ticket shows the **inverse**
   relationship off the same single row.
3. Remove with the row's ✕ → `POST tickets/{id}/links/unlink/` `{ link_id }` (POST, not DELETE).
4. Both add and remove write a `log_event` (`link_added`/`link_removed`) → the Activity tab updates.

### C3 — Attach
- `POST ticket-attachments` (multipart `file`, `ticket`) to attach a file.

## Flow D — Audit / history
`GET tickets/{id}/activity/` renders the History tab: created, assigned, status changes, comments,
links — every entry written by an explicit `log_event` at its service write site.
