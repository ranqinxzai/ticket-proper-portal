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
