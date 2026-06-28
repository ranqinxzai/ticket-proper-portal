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
- **`SystemRole`** — Admin / Supervisor / Agent / Requestor (seeded, `is_system`) or custom roles. Holds CRUD grants.
- **`RoleModulePermission`** — `(role, module)` → `can_read/create/update/delete` bits.
- **`RoleAssignment`** — OneToOne `User → SystemRole` (one ITSM role per user for v1). *(The plan
  called this a `system_role` FK; the code implements it as a separate `RoleAssignment` model
  reachable via `user.itsm_role_assignment`.)*
- **`HasModulePermission`** — DRF permission; maps HTTP method → CRUD action; reads the view's
  `module_code` (or a per-`@action` override). Superusers bypass.
- **`check_permission(user, module_code, action)`** — the resolver; walks the module's ancestor
  chain; cached 5 min per `(role, module, action)`.
- **`MODULES` registry + `seed_rbac()`** — single source of truth for the tree; idempotent seed
  of modules + the four system roles (Admin/Supervisor/Agent/Requestor) + default grants.

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

## Agent-app access requires a helpdesk (added 2026-06-28)
Holding a non-requestor role (`agent`/`supervisor`/`admin`) is no longer enough to use the agent app —
the user must also be an **active member of ≥1 helpdesk** (or be a superuser). The gate is frontend:
**`hasHelpdeskAccess(user)`** (`lib/itsm/nav.ts`, superuser OR `user.helpdesks.length > 0`) enforced in
**`AgentGuard`** (`lib/itsm/auth.tsx`), which renders a blocking "No helpdesk assigned — contact your
administrator" screen (sign-out only) instead of the menu/agent view. `isAgentUser` (the agent-vs-portal
router) is unchanged, so a roled zero-helpdesk user still lands in the agent app and sees the blocking
screen (not the portal); pure `requestor`s still go to the portal. Backend is already safe (every query is
clamped to `accessible_helpdesk_ids`, `[]` for a zero-helpdesk user — see itsm-helpdesks). Helpdesk
assignment at `MemberViewSet.create_user` stays **optional** (no hard requirement added); the access gate is
the enforcement. Consequence: a non-superuser `admin` with no helpdesk is locked out of `/agent/admin/*`
until a superuser/other admin assigns one.

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

## Built-in Admin role (added 2026-06-28)
A fourth seeded system role **`admin`** ("Admin") holds **full CRUD on every module** — the explicit
top-level "owner" role you assign to a human admin who isn't a Django superuser. It mirrors
**Supervisor**'s grants exactly (both get full CRUD in `seed_rbac()`); the distinction is intent —
Admin is the owner tier, Supervisor the team-lead/manager tier — and Admin always tracks the *full*
module tree if Supervisor is ever narrowed. The frontend already treated `admin` as supervisor-ish
(`SUPERVISOR_ROLES` in `lib/itsm/auth.tsx` ⇒ `isSupervisor`), so no FE change was needed.
- **Seed:** `registry.py` `seed_rbac()` now `update_or_create`s `admin` (`is_system=True`) and grants
  Admin+Supervisor full CRUD in one loop; returns `{"roles": 4}`. Fresh tenants get it at
  `provision_org` → `seed_itsm` time.
- **Backfill for existing tenants:** data migration **`itsm_rbac/0002_seed_admin_role`** (RunPython,
  idempotent, per-schema). On an already-seeded schema it writes the role + a full-CRUD
  `RoleModulePermission` for every existing `Module`; on a freshly-created schema (modules not seeded
  yet at migrate time) it just creates the role and `seed_rbac` grants it later. It `update_or_create`s
  the role so a stray *custom* role with code `admin` (hand-made via the roles UI) is normalised into
  the built-in role (`is_system` set). Reverse drops the role+grants only if no user is assigned (FK is
  PROTECT). Applied live to **onemed / acme / gridcrest** (all → `is_system=true`, full CRUD on 45/45
  modules); gridcrest's pre-existing custom `admin` was normalised via `seed_rbac` since its 0002 ran
  before the `update_or_create` change.

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
