# itsm-automation: DB Schema

App label `itsm_automation`, migration `0001_initial`. It also adds the `AuditEvent.Action` choice `automation_applied` (`itsm_core/0013_alter_auditevent_action`, which only changes the choices).

## `AutomationRule` (`BaseModel`: UUID PK, timestamps, soft delete)
| Field | Type | Notes |
|---|---|---|
| `project` | FK → itsm_projects.Project | CASCADE, `related_name="automation_rules"` |
| `name` | CharField(150) | |
| `description` | TextField | blank |
| `is_active` | bool | default True |
| `order` | PositiveInt | default 100; run order (asc) |
| `triggers` | JSON list | `[{type, config}]`, see SKILL |
| `conditions` | JSON dict | queue FilterSpec; `{}` = always |
| `actions` | JSON list | `[{type, config}]`, max 5 |
| `stop_processing` | bool | default False |
| `last_run_at` | datetime | null; written by the dispatcher |
| `run_count` / `failure_count` | PositiveInt | `F()` increments in `_record` |
| `created_by` | FK → User | SET_NULL, null |

Ordering is `["order", "created_at"]`. There is an index on `(project, is_active, order)`, the dispatcher's lookup.

## `AutomationRun` (`UUIDModel`, append-only, no soft delete)
| Field | Type | Notes |
|---|---|---|
| `rule` | FK → AutomationRule | CASCADE, `related_name="runs"` |
| `ticket` | FK → itsm_tickets.Ticket | CASCADE, `related_name="automation_runs"` |
| `event` | CharField(32) | trigger type that fired |
| `status` | CharField(10) | `success` \| `failed` \| `skipped` |
| `message` | TextField | ≤2000 chars, joined action details or error |
| `actions_result` | JSON list | `[{type, status, detail}]` |
| `created_at` | datetime | auto, indexed |

Ordering is `["-created_at"]`, with an index on `(rule, -created_at)`. Nothing prunes this table yet (a v2 item).

## System user
Each tenant gets an `accounts.User` row `username="automation-bot"`, `full_name="Automation"`, with an unusable password and empty `app_access`. It is created lazily on the first run.
