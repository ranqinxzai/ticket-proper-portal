# itsm-groups — DB Schema

All extend `BaseModel`.

## `Group`
| Field | Type | Notes |
|---|---|---|
| `helpdesk` | FK → itsm_helpdesks.Helpdesk | SET_NULL, null/blank (**null = shared/global**), `related_name="groups"` |
| `name` | CharField(150) | **unique** |
| `key` | SlugField(50) | **unique** |
| `description` | TextField | blank |
| `type` | CharField(20) | service_desk/network/infra/security/app_support/custom |
| `lead` | FK → User | SET_NULL, null, `related_name="led_groups"` |
| `is_active` | bool | default True |

## `GroupMembership`
| Field | Type | Notes |
|---|---|---|
| `group` | FK → Group | CASCADE, `related_name="memberships"` |
| `user` | FK → User | CASCADE, `related_name="itsm_group_memberships"` |
| `role_in_group` | CharField(10) | `member` / `lead` |
| `is_active` | bool | default True (soft removal) |

Constraint: **`uniq_group_user (group, user)`**. Index `(group, is_active)`.

## `GroupAssignmentState` (round-robin cursor)
| Field | Type | Notes |
|---|---|---|
| `group` | **OneToOne** → Group | CASCADE, `related_name="assignment_state"` |
| `last_assigned_user` | FK → User | SET_NULL, null |

One row per group; locked via `select_for_update` during a pick.

## `RoutingRule`
| Field | Type | Notes |
|---|---|---|
| `project` | FK → itsm_projects.Project | CASCADE, null/blank (**null = global**) |
| `name` | CharField(150) | |
| `priority` | PositiveInt | default 100; ascending, first match wins |
| `match_spec` | JSONField | `{ticket_type, priority, field conds}` |
| `target_group` | FK → Group | CASCADE |
| `target_assignee` | FK → User | SET_NULL, null |
| `is_active` | bool | default True |

Ordering `priority, id`. Index `(project, priority)`.

## Seeded groups
**Shared/global (helpdesk=null):** Network (`network`), Infrastructure (`infra`),
Security (`security`), Application Support (`app-support`).
**Per helpdesk:** one Service Desk group namespaced by helpdesk key (e.g. `it-service-desk` /
"IT Helpdesk Service Desk"), which is the default group on that helpdesk's Incident + Request projects.
