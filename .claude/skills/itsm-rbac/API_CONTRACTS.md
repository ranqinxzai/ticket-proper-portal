# itsm-rbac — API Contracts

Base: `/api/v1/itsm/`. All resource endpoints require module `itsm.admin.roles`
(superuser or Supervisor). Auth endpoints are public / authenticated as noted.

## Auth
### `POST auth/login`
Body: `{ "username": "...", "password": "..." }`
200 →
```json
{
  "access": "<jwt>",
  "refresh": "<jwt>",
  "user": {
    "id": "...", "username": "...", "full_name": "...", "email": "...",
    "is_superuser": false,
    "role": { "code": "agent", "name": "Agent" },
    "permissions": { "itsm.tickets": {"read":true,"create":true,"update":true,"delete":false}, "...": {} }
  }
}
```
401 → invalid credentials.

### `POST auth/refresh`
Body: `{ "refresh": "<jwt>" }` → `{ "access": "<jwt>" }`.

### `GET auth/me`  (IsAuthenticated)
→ same `user` shape as the login `user` block (id/username/full_name/email/is_superuser/role/permissions).

## Modules (read-only)
### `GET modules`
→ `[{ id, code, name, description, parent_code, sort_order, is_active }]` (unpaginated).

## Roles
### `GET|POST roles` · `GET|PUT|PATCH|DELETE roles/{id}`
Role shape: `{ id, code, name, description, is_system, is_active, permissions: [RoleModulePermission] }`.
`is_system` is read-only. DELETE soft-deletes.
### `PUT roles/{id}/permissions`
Bulk-set grants. Body: `[{ "module": "<uuid>", "can_read": true, "can_create": false, "can_update": true, "can_delete": false }, ...]`
→ the updated role. (Invalidates the permission cache.)

## Role permissions
### `GET|POST role-permissions` · `.../{id}`  — filter `?role=&module=`
Shape: `{ id, role, module, module_code, can_read, can_create, can_update, can_delete }`.

## Role assignments (bind a user to a role)
### `GET|POST role-assignments` · `.../{id}`  — filter `?role=&user=`
Shape: `{ id, user, username, role, role_code, role_name }`.

## Error codes
- `401` — unauthenticated (missing/expired JWT).
- `403` — authenticated but lacks the module/action grant (`HasModulePermission`).
- `400` — validation (e.g. duplicate role code).

## Bug-fix batch additions (added 2026-10-18)
### Self-service password reset (unauthenticated, per org; `apps/accounts/password_reset_views.py`)
- **`POST itsm/auth/password-reset/`** `{login}` (or `username` / `email`): always the same generic 200, whether or not it matched. Mail goes only to active users with a usable password who aren't SSO users or bots. The link lasts 60 min, works once and is bound to the org schema.
- **`POST itsm/auth/password-reset/validate/`** `{uid, token}` → `{valid}`.
- **`POST itsm/auth/password-reset/confirm/`** `{uid, token, new_password}` → 200, or 400 with the reason. Logged as `password_reset` / `password_reset_failed`.
- A path without an org → 404.

### Roles / users guards
- **`DELETE roles/{id}`:** 400 for a built-in role or a role in use. `code` and `is_active` of built-in roles are read-only. Roles expose `user_count`.
- **Member `set_active`:** refuses superusers and system bots (400).
- **Member `update_profile` (2026-10-24):** `POST members/{id}/update_profile/` with any of `{full_name, email, manager}`. An omitted key is unchanged; `manager: null` clears it. Returns the member row, which now carries `manager: {id, username, full_name} | null`. Errors:
  - 400 `{field: [msg]}` for: a blank name; a bad email; an email another account uses as its email or username (names that account); a manager who is inactive, a bot, unknown, the user themselves, or already reports to the user (a loop).
  - 400 for a system bot.
  - 403 when a non-superuser edits a superuser.
  - The username can't be changed. Audited as `update` (AdminAuditMixin `_ACTION_MAP`).
- **`role-permissions` create/destroy:** invalidates the permission cache.

### `/api/v1/[t/<org>/]users/` (legacy `apps.accounts`, S8)
- Read-only (`GET` list/retrieve), and only for users with `itsm.tickets` read. Returns `{id, username, full_name, email}` for active users, no bots.
- Writes → 405. The legacy session `auth/login|logout|me` routes are removed.
