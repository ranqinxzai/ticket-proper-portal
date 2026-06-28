# itsm-rbac — User Flows

## Flow A — Login (agent)
1. Agent POSTs `auth/login` with username/password.
2. Response carries `access`/`refresh` JWTs + a `user` block including the `permissions` map.
3. Frontend stores tokens, hydrates `ItsmAuthProvider`, and gates nav/buttons by the map.
4. `homePathFor`/`isAgentUser` route the user: pure `requestor` → Service Portal; everyone else →
   agent app. **Inside the agent app, `AgentGuard` additionally requires helpdesk access**
   (`hasHelpdeskAccess` = superuser OR ≥1 active membership): a roled agent/lead/admin with **zero
   helpdesks** gets a blocking "No helpdesk assigned — contact your administrator" screen (no menu/agent
   view, sign-out only) instead of the app. (Added 2026-06-28 — see SKILL.)
5. Subsequent requests send `Authorization: Bearer <access>`; `auth/refresh` rotates the access
   token when it expires.

## Flow B — Request authorization (every API call)
1. Request hits a ViewSet; `HasModulePermission.has_permission` runs.
2. It resolves the effective `module_code` (per-action override beats view-level).
3. Maps the HTTP method to a CRUD action, calls `check_permission(user, module, action)`.
4. Resolver: superuser→allow; else look up the role, walk the module ancestor chain, return the
   closest explicit grant (cached 5 min). 403 if denied.

## Flow C — Supervisor edits a custom role
1. Supervisor opens the role editor (`GET roles`, `GET modules`).
2. Adjusts the grant matrix and `PUT roles/{id}/permissions` with the full `[{module, can_*}]` list.
3. Server upserts each `RoleModulePermission` and calls `invalidate_permission_cache()`.
4. Affected users' permissions take effect immediately (cache cleared).

## Flow D — Assigning a user a role
1. Supervisor `POST role-assignments` `{ user, role }` (or PATCH to change it).
2. Cache invalidated; the user's next request resolves the new role.
3. `GET auth/me` for that user now reports the new role + permission map.
