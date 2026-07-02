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
| `priority` | CharField(10) | critical/high/medium/low (default medium); auto-derived from impact×urgency on Incidents, overridable |
| `impact / urgency` | CharField(10) | blank; impact 4 opts / urgency 3 opts (ITIL matrix) |
| `resolution` | CharField(120) | blank (legacy free-text; still set by `set_resolution` PF) |
| `business_impact` | TextField | blank (ITIL Impact Assessment) |
| `users_affected` | PositiveInt | null |
| `service_downtime` | bool | null (Yes/No/unset) |
| `major_incident` | bool | default False; index `(project, major_incident)` |
| `resolution_code` | CharField(20) | blank; fixed/workaround/duplicate/user_error (`ResolutionCode`) |
| `root_cause` | TextField | blank |
| `workaround_provided` | bool | null |
| `resolution_notes` | TextField | blank (captured on the Resolve screen) |
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
`uniq_ticket_link (source_ticket, target_ticket, link_type)`. `BaseModel` (soft-deletable).
**Single-row** — only the source→target row is stored; the reverse view is computed from the
module-level `INVERSE_LINK_TYPE` map (`models.py`), not a second row. Because `uniq_ticket_link`
spans soft-deleted rows, `link_tickets` looks up via `all_objects.get_or_create` and resurrects a
soft-deleted pair rather than colliding on the constraint.
