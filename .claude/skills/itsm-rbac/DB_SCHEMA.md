# itsm-rbac — DB Schema

All extend `BaseModel` (UUID PK + timestamps + soft delete).

## `Module`
| Field | Type | Notes |
|---|---|---|
| `code` | CharField(100) | **unique**; dot-notation (`itsm.tickets.bulk`) |
| `name` | CharField(150) | |
| `description` | TextField | blank |
| `parent` | FK → self | SET_NULL, null, `related_name="children"` |
| `sort_order` | PositiveInt | |
| `is_active` | bool | default True |

Ordering `sort_order, code`. Index on `code`.

## `SystemRole`
| Field | Type | Notes |
|---|---|---|
| `code` | SlugField(50) | **unique** (`agent`, `supervisor`) |
| `name` | CharField(100) | |
| `description` | TextField | blank |
| `is_system` | bool | seeded roles can't be deleted (read-only in API) |
| `is_active` | bool | |
| `org` | UUIDField | null — reserved multi-tenancy hook |

## `RoleModulePermission`
| Field | Type | Notes |
|---|---|---|
| `role` | FK → SystemRole | CASCADE, `related_name="permissions"` |
| `module` | FK → Module | CASCADE, `related_name="role_permissions"` |
| `can_read / can_create / can_update / can_delete` | bool | default False |

Constraint: **`uniq_role_module (role, module)`**. Index `(role, module)`.

## `RoleAssignment`
| Field | Type | Notes |
|---|---|---|
| `user` | **OneToOne** → User | CASCADE, `related_name="itsm_role_assignment"` |
| `role` | FK → SystemRole | **PROTECT**, `related_name="assignments"` |

Index on `user`. One ITSM role per user (v1). Resolver: `user.itsm_role_assignment.role`.

## The module tree (from `registry.py` `MODULES`)
`itsm` (root) ▸ `itsm.dashboard`; `itsm.tickets` ▸ `.queue/.create/.bulk/.comments/
.comments_private/.watchers/.links/.templates` + `itsm.canned_notes`; `itsm.projects` ▸ `.config`;
`itsm.groups`; `itsm.workflows` ▸ `.transitions`; `itsm.fields` ▸ `.layouts`; `itsm.sla` ▸
`.policies/.calendars`; `itsm.notifications` ▸ `.schemes/.templates/.inbox`; `itsm.reports` ▸
`.sla/.agent`; `itsm.dashboards`; `itsm.admin` ▸ `.roles`.

## Default grants
- **Supervisor** — full CRUD on every module.
- **Agent** — RWU (no delete) on dashboard, all `itsm.tickets.*`, `canned_notes`, `reports.*`,
  `dashboards`; **read-only** on `itsm`, `projects`, `groups`, `workflows`, `fields`, `sla`;
  no access to admin, notification schemes/templates, sla policies/calendars, project config.
