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

## Requestors hold no membership (added 2026-06-24)
A **requestor** is a portal-only end-user and must never hold helpdesk/project membership. New helper
**`services.is_requestor(user)`** = "the user's ITSM role is exactly `requestor`" (a user with **no** role
is *not* a requestor, so an unassigned user can still be enrolled; a superuser returns False). Enforced:
- **`MemberViewSet.create_user`** rejects (400) `role_code="requestor"` with any `helpdesks` (or Phase-4
  `projects`).
- **`MemberViewSet.set_role`** — assigning the `requestor` role **deactivates** the user's
  `HelpdeskMembership` + `ProjectMembership` rows in the same transaction (demotion strips agent access
  immediately), then `invalidate_permission_cache()`.
- **`HelpdeskViewSet.add_member`** (itsm_helpdesks) rejects a requestor target (400) and an inactive
  helpdesk (400). The frontend mirrors all three (Add-user dialog + Helpdesks sheet hide assignment for a
  requestor; the role dropdown confirms demotion and refetches the roster).

## Agents can be granted Service Portal access (added 2026-06-24)
An **agent** (or any role) can act as a **requestor** in the Service Portal — the portal is a separate
surface where everyone is a requestor (intake forces `requestor=self`/`source="portal"`, not
membership-scoped). This is gated by the normal RBAC grant: granting a role `itsm.portal.tickets`
(read+create) — plus `itsm.portal`/`itsm.portal.approvals` read if desired — lets its users raise &
track requests in any active helpdesk. The Agent home page shows a permission-gated **Service Portal**
card (`(agent)/agent/page.tsx`, right rail) only when `hasPerm("itsm.portal.tickets", "create")` is
true; if the grant is missing the card is hidden. (Granting these to the Agent role in `registry.py`
seed lists would make it default; otherwise add via the roles-admin matrix.)

## Login is case-insensitive (added 2026-06-24)
`ItsmTokenObtainPairSerializer` delegates to simplejwt → Django `authenticate()`, which historically
used the default **case-sensitive** `ModelBackend` username lookup (logins are email-shaped, so
`Shekhar@ticket.com` failed against a stored `shekhar@ticket.com`). Fixed globally with
**`apps.accounts.backends.CaseInsensitiveModelBackend`** (registered first in
`settings.AUTHENTICATION_BACKENDS`, default backend kept as fallback): it resolves the login by
exact username → `username__iexact` → `email__iexact` (deterministic on a rare case-only duplicate),
running the hasher once on a miss to avoid timing leaks. One backend fixes all three entry points —
the ITSM JWT login, the platform-admin JWT login, and the legacy session `LoginView`. No data
migration (lookup-time fix); multi-tenant safe (query runs in the active schema).

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
  action), `RoleModulePermissionViewSet`, `RoleAssignmentViewSet`, `MemberViewSet` (roster +
  `create_user`/`set_role`/`set_active`/`reset_password`). `MemberSerializer` now also embeds
  `projects[]` (per-user project grants); `create_user` accepts `projects: [{id}]` — see **itsm-projects**.
- `urls.py` — router + auth paths.
