# itsm-fields — DB Schema

All models in `backend/apps/itsm_core/models/fields.py`, extending `BaseModel`. **(Tables BUILT.)**

## `FieldDefinition`
| Field | Type | Notes |
|---|---|---|
| `project` | FK → Project | CASCADE, null/blank (**null = global field**) |
| `key` | SlugField(80) | |
| `name` | CharField(120) | |
| `description` | TextField | blank |
| `field_type` | CharField(20) | text/multiline/number/date/datetime/dropdown/multiselect/checkbox/radio/user_picker/group_picker |
| `is_system` | bool | |
| `is_multi` | bool | |
| `config` | JSONField | decimals/regex/min/max/show_time… |
| `default_json` | JSONField | null |

Constraint **`uniq_project_field_key (project, key)`**. Index `(project, field_type)`.
Constants: `MULTI_VALUE_TYPES = {multiselect}`, `OPTION_TYPES = {dropdown, multiselect, radio}`.

## `FieldOption`
`field` (FK, CASCADE, `related_name="options"`), `value` (CharField100), `label`, `color`,
`sort_order`, `is_active`. Constraint **`uniq_field_option_value (field, value)`**.

## `FieldValue` (the CellValue)
| Field | Type | Notes |
|---|---|---|
| `ticket` | FK → Ticket | CASCADE, `related_name="field_values"` |
| `field` | FK → FieldDefinition | CASCADE, `related_name="values"` |
| `value_text` | TextField | |
| `value_number` | Decimal(24,6) | null |
| `value_date` | DateTime | null |
| `value_bool` | bool | null |
| `value_user` | FK → User | SET_NULL, null |
| `value_json` | JSONField | null (multi-value) |

Constraint **`uniq_ticket_field (ticket, field)`**. Indexes `field`, `ticket`.

## `FieldLayout`
`project` (FK, CASCADE), `ticket_type` (FK TicketType, CASCADE, null = **project default**),
`name` (default "Default Layout"). Constraint **`uniq_project_type_layout (project, ticket_type)`**.

## `FieldLayoutItem`
`layout` (FK, CASCADE, `related_name="items"`), `field` (FK), `sort_order`, `is_hidden`,
`is_mandatory`, `section` (default "Details"), `visibility_rule` JSON (`{field, equals}`).
Constraint **`uniq_layout_field (layout, field)`**. Ordering `sort_order, id`.
