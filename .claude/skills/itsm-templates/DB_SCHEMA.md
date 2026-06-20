# itsm-templates — DB Schema (BUILT)

**Status: implemented.** Models in `itsm_tickets/models.py`, extending `BaseModel`; created by
migration `0002`.

## `TemplateCategory`
| Field | Type | Notes |
|---|---|---|
| `name` | CharField(120) | |
| `sort_order` | PositiveInt | default 0 |

## `TicketTemplate`
| Field | Type | Notes |
|---|---|---|
| `name` | CharField(200) | |
| `description` | TextField | blank |
| `project` | FK → Project | CASCADE, null = global scope |
| `category` | FK → TemplateCategory | SET_NULL, null |
| `ticket_type` | FK → TicketType | SET_NULL, null |
| `default_priority` | CharField(10) | critical/high/medium/low |
| `default_group` | FK → Group | SET_NULL, null |
| `default_assignee` | FK → User | SET_NULL, null |
| `summary_template` | CharField(500) | blueprint summary |
| `description_html` | TextField | blank |
| `field_defaults` | JSONField | `{<field_key>: value}` default custom-field values |
| `is_active` | bool | retire without delete |
| `created_by` | FK → User | SET_NULL, null; set to creator |

## Notes
- Fields map to the prefill payload returned by `tickets/apply-template/`, so hydrating the create
  form is a straight field copy.
- `field_defaults` is surfaced as `custom_fields` in the prefill payload and flows into the create
  form as initial values.
- Soft-delete via `BaseModel`; `is_active=False` hides a template from the picker.
