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
| `pauses_sla` | bool | default False. "Exclude from SLA" — entering pauses ALL running SLA clocks (migration `0005_status_pauses_sla`); honored by `itsm_sla.sla_engine.on_status_change` |
| `allows_send_for_approval` | bool | default False. Agents may "Send for approval" from here (migration `0010_status_send_for_approval`) |
| `approval_waiting_status` | FK → Status (self) | null, SET_NULL. Where the ticket waits while that approval is pending (null = stays); never Done / another workflow |
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

## Bug-fix batch additions (added 2026-10-18)
- **`itsm_workflows/0009_request_rejected_status`:**
  - `TransitionCondition.condition_type` choices add `approval_granted` and `approval_rejected` (choices only).
  - RunPython: each default `service_request` workflow gets status `rejected` (Rejected, `#dc2626`, done) and a **Reject** transition New → Rejected (stop resolution SLA, stamp `closed_at`, gated by `approval_rejected`).
  - Skipped when a `rejected` row exists (live or soft-deleted) or there's no live `new`. Mirrored in `seed.py` (`ensure_reject_gate`).
- **`itsm_approvals/0003_request_mode_stage_ids_live_level_unique`:** adds `ApprovalRequest.mode` + `stage_ids` (snapshot at start), and replaces the `(workflow, level)` unique with conditional `uniq_approval_workflow_live_level` (`is_deleted=False`).

## Approvals additions (`itsm_approvals/0004_on_fly_and_sent_requests`, 2026-10-24)
- `ApprovalStage`: `approver_type` += `on_the_fly`; `on_fly_pool` CharField(16) (`any_user` | `group` | `listed_users`, blank); `candidate_users` M2M → User (`related_name="+"`).
- `ApprovalRequest`: `source` CharField(8) (`policy` default | `sent`), `note` Text, `return_status` / `waiting_status` FK → Status (null, SET_NULL).
- **`ApprovalRequestApprover`** (BaseModel): `approval_request` FK (CASCADE, `related_name="picked_approvers"`), `stage` FK (CASCADE), `user` FK (CASCADE). Conditional unique `uniq_approval_request_stage_picked_user (approval_request, stage, user) WHERE is_deleted=False`.

