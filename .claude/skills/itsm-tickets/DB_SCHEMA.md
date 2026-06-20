# itsm-tickets — DB Schema

`Ticket` and all relations extend `BaseModel`. `TicketSequence` is a plain `models.Model`.

## `Ticket`
| Field | Type | Notes |
|---|---|---|
| `ticket_number` | CharField(24) | **unique** (`INC-1`) |
| `project` | FK → Project | **PROTECT**, `related_name="tickets"` |
| `ticket_type` | FK → TicketType | **PROTECT** |
| `summary` | CharField(500) | |
| `description_html / description_text` | TextField | sanitized + plain mirror |
| `requestor` | FK → User | SET_NULL, null |
| `assigned_group` | FK → Group | SET_NULL, null, `related_name="tickets"` |
| `assignee` | FK → User | SET_NULL, null, `related_name="assigned_tickets"` |
| `status` | FK → workflows.Status | **PROTECT** |
| `workflow` | FK → workflows.Workflow | **PROTECT** (snapshot) |
| `priority` | CharField(10) | critical/high/medium/low (default medium) |
| `impact / urgency` | CharField(10) | blank (ITIL matrix) |
| `resolution` | CharField(120) | blank |
| `due_date / first_responded_at / assigned_at / resolved_at / closed_at` | DateTime | null |
| `reopen_count` | PositiveInt | |
| `source` | CharField(10) | agent/portal/email/phone/api |
| `created_by` | FK → User | SET_NULL, null |

**Indexes:** `(project,status)`, `(assignee,status)`, `(assigned_group,status)`,
`(project,status,priority)`, `priority`, `due_date`, `resolved_at`, `ticket_number`.
Ordering `-created_at`.

## `TicketSequence` (not BaseModel)
`project` (OneToOne Project, CASCADE, `related_name="ticket_sequence"`), `last_number`
(PositiveInt). Locked with `select_for_update` during numbering.

## `Comment`
`ticket` (FK), `author` (FK User, SET_NULL), `visibility` (public/private),
`body_html`/`body_text`, `edited_at`. Ordering `created_at, id`. Indexes `(ticket, created_at)`,
`(ticket, visibility)`.

## `CommentAttachment` / `TicketAttachment`
`file` (FileField), `original_name`, `size_bytes`, `content_type`, `uploaded_by`. Upload paths
`itsm_attachments/comment/{id}/...` and `itsm_attachments/ticket/{id}/...`.

## `MentionRecord`
`comment` (FK), `mentioned_user` (FK). Constraint `uniq_comment_mention (comment, mentioned_user)`.

## `Watcher`
`ticket` (FK), `user` (FK). Constraint `uniq_ticket_watcher (ticket, user)`. Index `user`.

## `TicketLink`
`source_ticket` (FK, `links_out`), `target_ticket` (FK, `links_in`), `link_type`
(relates_to/blocks/blocked_by/duplicates/duplicated_by/causes/caused_by). Constraint
`uniq_ticket_link (source_ticket, target_ticket, link_type)`.
