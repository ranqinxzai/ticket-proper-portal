# itsm-rbac

## Purpose
Module-based RBAC for the whole ITSM product, plus JWT authentication. Defines the
permission tree (`Module`), the roles (`SystemRole`) and their CRUD grants
(`RoleModulePermission`), binds a user to one role (`RoleAssignment`), and enforces it
through `HasModulePermission` + the `check_permission` resolver. Also hosts the JWT
login/refresh/me endpoints. Single-org for v1; the reserved "org" hook is now realized as the
separate **itsm_helpdesks** app — a membership-based department/workspace layer (NOT a field on
`SystemRole`); helpdesk scope is orthogonal to the RBAC role.

## Backend app path
`backend/apps/itsm_rbac/`

## Key concepts
- **`Module`** — a dot-notation permission node (`itsm.tickets.bulk`) with an optional parent;
  permissions inherit DOWN the tree (closest ancestor with an explicit grant decides).
- **`SystemRole`** — Agent / Supervisor (seeded, `is_system`) or custom roles. Holds CRUD grants.
- **`RoleModulePermission`** — `(role, module)` → `can_read/create/update/delete` bits.
- **`RoleAssignment`** — OneToOne `User → SystemRole` (one ITSM role per user for v1). *(The plan
  called this a `system_role` FK; the code implements it as a separate `RoleAssignment` model
  reachable via `user.itsm_role_assignment`.)*
- **`HasModulePermission`** — DRF permission; maps HTTP method → CRUD action; reads the view's
  `module_code` (or a per-`@action` override). Superusers bypass.
- **`check_permission(user, module_code, action)`** — the resolver; walks the module's ancestor
  chain; cached 5 min per `(role, module, action)`.
- **`MODULES` registry + `seed_rbac()`** — single source of truth for the tree; idempotent seed
  of modules + Agent/Supervisor roles + default grants.

## Frontend path / pages (planned)
`app/login` (JWT), `ItsmAuthProvider`/`ItsmGuard` shell guard, `admin/.../roles` editor
(role list + module-grant matrix). The login response embeds a `permissions` map for UI gating.

## API clients
`/api/v1/itsm/auth/login`, `auth/refresh`, `auth/me`, and the
`modules`, `roles`, `role-permissions`, `role-assignments` resources.

## RBAC module codes
Self-governs under **`itsm.admin`** → `itsm.admin.roles` (the modules/roles/assignments APIs all
declare `module_code = "itsm.admin.roles"`). The full tree it defines is in DB_SCHEMA / registry.
The helpdesk-admin APIs (in itsm_helpdesks) declare **`itsm.admin.helpdesks`** (Supervisor full;
Agent read — it's in `AGENT_RO_MODULES`), also seeded by this registry.

## Key files
- `models.py` — `Module`, `SystemRole`, `RoleModulePermission`, `RoleAssignment`.
- `registry.py` — `MODULES` list, `AGENT_RW_MODULES`/`AGENT_RO_MODULES`, `seed_rbac()`.
- `permissions.py` — `HasModulePermission`, `_resolve_module_code`, `ItsmModelViewSet` (the base
  class every ITSM ViewSet extends).
- `services.py` — `check_permission`, `get_user_role`, `_module_chain`, `invalidate_permission_cache`.
- `serializers.py` — token serializer (`ItsmTokenObtainPairSerializer`), `ItsmUserSerializer`,
  `build_permission_map`, model serializers. `ItsmUserSerializer` now also returns a **`helpdesks[]`**
  field — `[{id,key,name,icon,color}]` via `itsm_helpdesks.services.build_helpdesk_membership(user)`
  (superuser ⇒ all active) — which flows into both `auth/me` and the login token payload (drives the
  Home selector + helpdesk switcher).
- `views.py` — `ItsmLoginView`, `MeView`, `ModuleViewSet`, `SystemRoleViewSet` (+ `permissions`
  action), `RoleModulePermissionViewSet`, `RoleAssignmentViewSet`.
- `urls.py` — router + auth paths.
