# itsm-tickets

## Purpose
The heart of the platform. `Ticket` carries the standard ITIL fields as first-class
(indexed) columns; comments (public/internal), watchers, links, and attachments hang off it;
`ticket_service` is the single write site for create/assign/comment, and `numbering`
generates `INC-1` style numbers under a row lock. Status changes go through the **workflow
engine**; custom fields live in the **field engine**. *(`CannedNote`/`TicketTemplate` are
planned — see the itsm-canned-notes / itsm-templates skills.)*

## Backend app path
`backend/apps/itsm_tickets/`

## Key concepts
- **`Ticket`** — first-class columns: `ticket_number` (unique), `project`/`ticket_type` (PROTECT),
  `summary`, `description_html/_text`, `requestor`, `assigned_group`, `assignee`, `status`/
  `workflow` (PROTECT, snapshot), `priority`/`impact`/`urgency`, `resolution`, lifecycle stamps
  (`due_date`, `first_responded_at`, `assigned_at`, `resolved_at`, `closed_at`), `reopen_count`,
  `source`, `created_by`. Hot-path indexes for queue/SLA/reporting.
- **`TicketSequence`** — per-project counter (OneToOne Project), locked with `select_for_update`.
- **`Comment`** — `visibility` public|private; `body_html` sanitized + `body_text` mirror;
  `MentionRecord`s; `CommentAttachment`s. First public reply stamps `first_responded_at`.
- **`Watcher`** / **`TicketLink`** (relates_to/blocks/duplicates/causes + inverses) /
  **`TicketAttachment`**.
- **`ticket_service`** — `create_ticket`, `assign`, `add_comment` (atomic; log_event + hooks on
  commit). **`numbering`** — `generate_ticket_number(project)`.
- **Helpdesk scoping (every read/write clamped).** All ticket access is intersected with the
  requester's accessible helpdesks (via `itsm_helpdesks.services`; superuser ⇒ unrestricted, advisory
  `?helpdesk=<id|key>` narrows further, never widens): `get_queryset` filters
  `project__helpdesk_id__in` (so detail/transition/assign/comments derived from it 404 cross-helpdesk
  ids); `_bulk` clamps both the ids branch and the saved-filter branch; `create`/`links`/`apply_template`
  reject (403) an inaccessible project/target/template; and a comment POST restricts `@mention` user
  ids to the ticket's helpdesk members. The shared `query_builder.build_q`/`filtered_tickets` take an
  `accessible_helpdesk_ids` kwarg that ANDs the same filter (closing saved-filter results, widget data,
  and bulk-by-filter).

## Frontend path / pages (planned)
`queues/[queueId]`, `tickets` (+ `new` wizard, `[key]` detail like `/tickets/INC-1042`). JSM
two-pane detail: comments/worklog/history/files + fields panel.

## API clients
`tickets` (+ actions: `available-transitions`, `transition`, `assign`, `watch`, `watchers`,
`comments`, `activity`, `links`), `comments`, `watchers`, `ticket-links`, `ticket-attachments`.

## RBAC module codes
- `TicketViewSet`, `TicketAttachmentViewSet` → **`itsm.tickets`**.
- `CommentViewSet` → **`itsm.tickets.comments`**; private comments gated by
  **`itsm.tickets.comments_private`** (checked in the `comments` list action).
- `WatcherViewSet` → **`itsm.tickets.watchers`**; `TicketLinkViewSet` → **`itsm.tickets.links`**.
  (Bulk ops → `itsm.tickets.bulk`, planned.)

## Key files
- `models.py` — `Ticket`, `TicketSequence`, `Watcher`, `TicketLink`, `TicketAttachment`,
  `Comment`, `CommentAttachment`, `MentionRecord`.
- `services/ticket_service.py` — `create_ticket`, `assign`, `add_comment`.
- `services/numbering.py` — `generate_ticket_number`.
- `views.py` — `TicketViewSet` (+ actions) and the four resource ViewSets.
- `serializers.py` — list/detail/create serializers, comment/watcher/link/attachment/audit.
- `urls.py` — `tickets`, `comments`, `watchers`, `ticket-links`, `ticket-attachments`.
