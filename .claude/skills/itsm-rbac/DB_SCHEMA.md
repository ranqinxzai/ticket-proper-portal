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

## Send for approval (added 2026-10-24)
`itsm.approvals` ▸ `.admin` + **`.send`** (migration `0015_seed_approvals_send_module`, data,
create-only): Admin/Supervisor full CRUD, Agent read/create/update, everyone else an explicit
no-access row. Delete = may withdraw approvals others sent.

## Bug-fix batch additions (added 2026-10-18)
Migration **`0014_backfill_enforced_module_grants`** (data):
- Writes explicit `RoleModulePermission` rows equal to each role's current effective access for `itsm.tickets.create` (create), `itsm.reports.sla` / `itsm.reports.agent` (read) and `itsm.portal.approvals` (read).
- Revives soft-deleted rows. Idempotent.
- The Agent seed now has `itsm.portal.approvals` read = True.

`itsm_core/0016` adds `itsm.admin.audit` with explicit grants (see itsm-core).
