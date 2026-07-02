# itsm-tickets — API Contracts

Base: `/api/v1/itsm/`.

## Tickets — `itsm.tickets`
### `GET tickets`  (list serializer)
Filters: `?project=&ticket_type=&status=&status__category=&priority=&assignee=&assignee__isnull=
&assigned_group=&created_at__gte=&created_at__lte=`. Search: `ticket_number/summary/
description_text`. Ordering: `created_at/updated_at/priority/due_date/ticket_number`.
List item: `{ id, ticket_number, project, project_key, ticket_type, ticket_type_name, summary,
status, status_name, status_category, status_color, priority, assignee, assigned_group,
assigned_group_name, due_date, created_at, updated_at, resolved_at }`.
Every embedded user (`assignee`/`requestor`/`created_by`/`updated_by`/comment `author`/watcher
`user`/audit `actor`) is the shared **UserBrief** `{ id, username, full_name, email }` (the
`UserBriefField` serializer; `email` added 2026-06-24 so the UI can show it beside the name).
### `GET tickets/{id}` (detail)
List fields + `{ description_html, description_text, requestor, created_by, workflow,
workflow_name, impact, urgency, resolution, source, first_responded_at, assigned_at, closed_at,
reopen_count }`.
### `POST tickets`  (create serializer)
Body `{ project, ticket_type, summary, description_html?, priority?, impact?, urgency?, requestor?,
assigned_group?, assignee?, source? }` → 201 with the detail shape. Auto-numbers, applies routing,
starts SLA, emits `TicketCreated`. `400` if the project has no default workflow.
### Actions
- `GET tickets/{id}/available-transitions/` → valid transitions (workflow engine).
- `POST tickets/{id}/transition/` → `{ transition_id, fields?, comment?, comment_visibility? }`;
  `200`/`409`/`403`/`422` (see itsm-workflows).
- `POST tickets/{id}/assign/` → `{ assignee?, group? }` → updated ticket (logs assigned/group_changed,
  emits `Assigned`).
- `POST|DELETE tickets/{id}/watch/` → add/remove the current user as a watcher (`201`/`204`).
- `GET tickets/{id}/watchers/` → watcher list.
- `GET|POST tickets/{id}/comments/` → list (public-only unless caller has comments_private read) /
  add `{ body_html, visibility:"public|private", mention_user_ids?[], attachment_ids?[] }` (`201`).
  `visibility` defaults to `"public"`; posting `"private"` without `comments_private` read → **403**
  (composer hides the Internal Note toggle for those users). `attachment_ids` associates pre-uploaded
  `comment-attachments` (clamped to the same ticket + unattached). Comment shape includes
  `attachments[]` ({id, kind, file (absolute URL), original_name, size_bytes, content_type, …}).
- `GET tickets/{id}/activity/` → last 200 audit events.
- `GET tickets/{id}/links/` → **merged inbound+outbound** links, each normalized to this
  ticket: `{ id, direction:"out|in", link_type, link_type_display, other_id, other_number,
  other_summary, other_status_{name,category,color}, other_project_key, other_helpdesk_key }`.
  Inbound rows are flipped to the inverse `link_type` (A "blocks" B ⇒ on B "is blocked by").
- `POST tickets/{id}/links/` `{ target_ticket (uuid), link_type }` → adds this→target, returns the
  new outbound row (201). Guards: self-link / bad link_type → **400**; target in an inaccessible
  helpdesk → **403** (Guard 4). Idempotent (re-link returns the existing row; re-link after removal
  resurrects the soft-deleted one).
- `POST tickets/{id}/links/unlink/` `{ link_id }` → soft-deletes a link touching this ticket (204;
  **POST not DELETE** — agents lack the delete bit on `itsm.tickets.links`). Both writes go through
  `ticket_service.link_tickets`/`unlink_tickets` and `log_event` (`link_added`/`link_removed`).
- `GET tickets/pulse/` *(list-scope, detail=False)* → `{ version, count }` — a cheap change-token for the
  **same filter scope** as `GET tickets` (accepts the same `?project=&q=&search=…&helpdesk=` params, minus
  `page`). `version = "<max(updated_at) epoch>:<count(distinct id)>"` over `filter_queryset(get_queryset())`,
  so it moves whenever a matching ticket is created/updated/soft-deleted and is tenant/helpdesk-isolated for
  free. Polled every ~15s by the live queue (`useLivePoll`) to decide whether to silently refresh; returns
  `{"version":"0:0","count":0}` for an empty scope. Cost = one indexed aggregate.

## Comments — `itsm.tickets.comments`
### `GET|POST|PUT|PATCH|DELETE comments`  filter `?ticket=&visibility=`
Shape: `{ id, ticket, author, visibility, body_html, body_text, edited_at, created_at }`.

## Watchers — `itsm.tickets.watchers` · `?ticket=&user=`
## Ticket links — `itsm.tickets.links` · `?source_ticket=&target_ticket=`
Agent UI mutates links through the **ticket-scoped** action (`tickets/{id}/links/` +
`.../links/unlink/`, documented above), which stays clamped to the agent's accessible tickets and
audits every change. The raw `GET ticket-links` list/detail is now **helpdesk-scoped**
(`get_queryset` → links whose source *or* target is in an accessible helpdesk). Links are
**single-row**; the inverse (`blocks`↔`blocked_by`, `duplicates`↔`duplicated_by`,
`causes`↔`caused_by`, `relates_to` self-inverse) is computed for display, never stored as a second row.
## Ticket attachments — `itsm.tickets` · `?ticket=`
Multipart `file` upload; server fills `original_name/size_bytes/content_type/uploaded_by`.
⚠️ `ticket` here is the **UUID pk** (the FK), *not* the readable `ticket_number` ('ITINC-606').
The frontend must pass `ticket.id`, never the page's `ticketId` route token — the latter would
hit the UUID column and 400 (filter) / 500 (create). See BUG_LOG 2026-06-24.

## Comment attachments — `itsm.tickets.comments` · `?ticket=&comment=&kind=`
`POST comment-attachments` multipart `{ ticket, kind:"file|image", file }` (`201`) — used by the RTE
comment composer to upload an inline image (embedded by URL) or a file (listed under the reply) **before**
the comment exists (`comment` null until `add_comment` associates it via `attachment_ids`). `ticket` is the
**UUID pk** (FK), not the readable number — a non-UUID value is rejected **400** `{ticket:[…]}` (never 500).
Guards: 10 MB cap, `kind=image` requires `image/*`, ticket must be in an accessible helpdesk (else **403**). Returns
`{ id, ticket, comment, kind, file (absolute URL), original_name, size_bytes, content_type, created_at }`.

## Error codes
- `400` — create without a default workflow; bad input.
- `403` — missing module grant; viewing private comments without `comments_private`.
- `409` / `422` — transition stale-button / mandatory-field errors (from the engine).
