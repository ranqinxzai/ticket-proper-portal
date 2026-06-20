# itsm-workflows — DB Schema

All extend `BaseModel` unless noted.

## `StatusCategory`
`key` (todo/in_progress/**done**, **unique**), `name`, `color`, `sort_order`. The fixed three.

## `Workflow`
`name`, `description`, `base_type` (incident/service_request/custom), `is_default`, `is_active`,
`version` (PositiveInt, copy-on-publish). Index on `is_active`.

## `Status`
| Field | Type | Notes |
|---|---|---|
| `workflow` | FK → Workflow | CASCADE, `related_name="statuses"` |
| `name` | CharField(80) | |
| `key` | SlugField(50) | |
| `category` | FK → StatusCategory | **PROTECT** |
| `color`, `sort_order` | | |
| `is_initial` | bool | exactly one per workflow (validator) |
| `canvas_x`, `canvas_y` | Int | builder node position |

Constraint: **`uniq_workflow_status_key (workflow, key)`**. Index `(workflow, sort_order)`.

## `Transition`
| Field | Type | Notes |
|---|---|---|
| `workflow` | FK → Workflow | CASCADE, `related_name="transitions"` |
| `name` | CharField(120) | |
| `from_status` | FK → Status | CASCADE, **null = create transition** |
| `to_status` | FK → Status | CASCADE |
| `is_global` | bool | available from any status |
| `sort_order` | PositiveInt | |
| `post_functions` | JSONField | `[{type, config}]` (default list) |
| `auto_assign_rule` | FK → AutoAssignmentRule | SET_NULL, null |
| `screen` | FK → TransitionScreen | SET_NULL, null |

Index `(workflow, from_status)`.

## `TransitionCondition`
`transition` (FK, CASCADE, `related_name="conditions"`), `condition_type`
(role_in/group_member/is_assignee/field_equals), `config` JSON, `negate` bool.

## `TransitionScreen` / `TransitionScreenField`
- Screen: `workflow` (FK), `name`.
- Field: `screen` (FK, `related_name="fields"`), `field_key` (CharField(80), references a
  `FieldDefinition.key` or a core field), `is_mandatory`, `sort_order`.

## `AutoAssignmentRule`
`name`, `strategy` (round_robin/least_loaded/group_lead/fixed_user/keep_current), `target_group`
(FK Group, SET_NULL), `fixed_user` (FK User, SET_NULL), `config` JSON.

## `ReopenRule`
`workflow` (FK), `reopen_to_status` (FK Status), `window_days` (default 14), `requires_comment`
(default True).

## Notes
- `Status.category` is PROTECT — can't delete a category in use.
- `from_status`/`to_status` CASCADE from their statuses — deleting a status drops its edges.
