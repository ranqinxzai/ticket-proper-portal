# itsm-helpdesks — DB Schema

Both extend `BaseModel` (UUID PK + `created_at`/`updated_at` + soft delete `is_deleted`/`deleted_at`/
`deleted_by`). Migrations: `0001_initial`, `0002_helpdesk_order`.

## `Helpdesk`
| Field | Type | Notes |
|---|---|---|
| `name` | CharField(150) | **unique** |
| `key` | CharField(5) | **unique**; `KEY_VALIDATOR` `^[A-Z][A-Z0-9]{1,4}$` (2–5 chars). Per-helpdesk ticket-number prefix; kept ≤ 5 so `<key>INC` fits `Project.KEY_VALIDATOR` (≤ 10) |
| `description` | TextField | blank |
| `icon` | CharField(32) | blank |
| `color` | CharField(16) | default `#6366f1` |
| `status` | CharField(12) | `active` / `inactive` / `archived` (default active). Only `active` is "accessible" |
| `order` | IntegerField | default 0, `db_index`. Global admin-set Home-card order (migration `0002`; backfilled by name). New helpdesks append (max+1); admin reorders via the `reorder` action |
| `created_by` | FK → User | SET_NULL, null, `related_name="created_itsm_helpdesks"` |

Ordering `["order", "name"]`. Indexes: `key`, `status`, `order`.
Retire with `status='archived'` (NOT soft delete — `BaseModel.soft_delete()` doesn't cascade).
Disable (reversible) = `status='inactive'`.

## `HelpdeskMembership`
| Field | Type | Notes |
|---|---|---|
| `helpdesk` | FK → Helpdesk | **CASCADE**, `related_name="memberships"` |
| `user` | FK → User | **CASCADE**, `related_name="itsm_helpdesk_memberships"` |
| `role_in_helpdesk` | CharField(10) | `member` / `lead` (default member) |
| `is_active` | bool | default True. Removal is soft (`is_active=False`), not a row delete |

Constraint: **`uniq_helpdesk_user (helpdesk, user)`**. Index: `(helpdesk, is_active)`.
Mirrors `itsm_groups.GroupMembership`. **Access = `is_active=True` row on an `active` helpdesk.**

## Related FKs added to other apps (documented here for scope completeness)
- **`itsm_projects.Project.helpdesk`** — non-null FK, CASCADE, `related_name="projects"`. Plus a
  partial `UniqueConstraint(helpdesk, project_type)` WHERE `project_type IN (incident,
  service_request)` AND `is_deleted=False` (one default Incident + one Request per helpdesk; CUSTOM
  is unconstrained) and `Index(helpdesk, status)`.
- **`itsm_groups.Group.helpdesk`** — nullable FK, SET_NULL (null = shared/global team). The seed
  creates one namespaced Service Desk group per helpdesk plus the 4 shared global teams.

## Seeded data
- **IT** (`IT Helpdesk`, icon `monitor`, `#3b82f6`) — owns projects `ITINC` / `ITREQ`.
- **HR** (`HR Helpdesk`, icon `users`, `#a855f7`) — owns projects `HRINC` / `HRREQ`.
- `seed_memberships()` enrolls every active, non-superuser user with an active ITSM `RoleAssignment`
  into all active helpdesks (role `member`).
