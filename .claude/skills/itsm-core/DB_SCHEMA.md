# itsm-core — DB Schema

## Abstract mixins (no tables of their own)
- **`UUIDModel`**: `id UUID PK default=uuid4`.
- **`TimeStampedModel`**: `created_at` (auto_now_add, db_index), `updated_at` (auto_now).
- **`SoftDeleteModel`**: `is_deleted bool default=False db_index`, `deleted_at datetime null`,
  `deleted_by FK(User) SET_NULL null`. Managers: `objects` (alive only), `all_objects` (raw).
- **`BaseModel`** = all three combined. Almost every ITSM model extends this.

## `AuditEvent` (concrete; `UUIDModel` only — NOT BaseModel)
Append-only ledger. No `updated_at`, no soft delete.
| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `ticket` | FK → `itsm_tickets.Ticket` | CASCADE, `related_name="activity"` |
| `actor` | FK → User | SET_NULL, null |
| `action` | CharField(32) | choices: `ticket_created, field_changed, status_changed, assigned, group_changed, priority_changed, comment_added, comment_edited, comment_deleted, attachment_added, attachment_removed, watcher_added, watcher_removed, link_added, link_removed, sla_started, sla_paused, sla_resumed, sla_breached, reopened, closed, template_applied` |
| `field_key` | CharField(80) | blank; which field changed |
| `payload` | JSONField | default `{}`; carries old/new values, previews |
| `created_at` | DateTimeField | auto_now_add, db_index |

- **Ordering:** `-created_at, -id`.
- **Index:** `(ticket, -created_at)`.

## Dynamic-field engine tables
Defined here but documented in the **itsm-fields** skill: `FieldDefinition`, `FieldOption`,
`FieldValue`, `FieldLayout`, `FieldLayoutItem`. All extend `BaseModel`. Key constraints:
`uniq_project_field_key (project,key)`, `uniq_field_option_value (field,value)`,
`uniq_ticket_field (ticket,field)`, `uniq_project_type_layout (project,ticket_type)`,
`uniq_layout_field (layout,field)`.

## Notes
- `AuditEvent.ticket` is CASCADE — deleting a ticket row (rare; tickets soft-delete) would drop
  its audit. Because tickets soft-delete, the ledger survives in practice.
