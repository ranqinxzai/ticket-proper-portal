# itsm-projects — API Contracts

Base: `/api/v1/itsm/`.

## Projects — `itsm.projects`
### `GET projects`  (Agent: read OK)
Filters: `?project_type=&status=`. Search: `name`, `key`, `description`.
Item shape (read): `{ id, name, key, description, project_type, status, color, icon,
default_group, default_workflow, calendar, lead, created_by, queue_columns, default_view_key,
disabled_view_keys, allowed_group_ids, priority_matrix, ticket_types: [...], created_at, updated_at }`.
`priority_matrix` is the ITIL `matrix[impact][urgency] -> priority` (Incident auto-calc).
### `POST projects` · `PUT|PATCH projects/{id}` (Supervisor)
Write body (`ProjectWriteSerializer`): `{ name, key, description?, project_type?, status?, color?,
icon?, default_group?, default_workflow?, calendar?, lead?, queue_columns?, default_view_key?,
disabled_view_keys?, allowed_group_ids?, priority_matrix? }`. `created_by` is set server-side.
`validate_priority_matrix` drops unknown impact/urgency/priority codes and merges over the ITIL default. **Filters tab fields:** `default_view_key`
(system view key / `saved:<uuid>` / blank — validated: a `saved:` ref must be a **shared** filter on
this project or a global shared one, else blanked) and `disabled_view_keys` (system keys hidden from the
queue dropdown — `"all"` + unknown keys + dups stripped server-side).
### `DELETE projects/{id}`
Soft-delete.

## Ticket types — `itsm.projects.config`
### `GET ticket-types`  filter `?project=&base_category=&is_active=`
Shape: `{ id, project, name, key, icon, base_category, parent, is_active, is_default, sort_order }`.
### `POST|PUT|PATCH|DELETE ticket-types/{id}` (Supervisor)
Unique `(project, key)` enforced.

## Per-user project assignment — `itsm.admin.helpdesks`
Membership admin (assigned from User Management), gated by `itsm.admin.helpdesks` (NOT project config).
The strict-whitelist access scope — see `services.accessible_project_ids`.
### `POST projects/{id}/add_member/` → `{ user }`
Idempotent upsert of a `ProjectMembership` (`is_active=True`). **400** if the user is a requestor or
unknown. Returns `ProjectMembership` `{ id, project, project_key, project_name, helpdesk, user, username,
full_name, is_active }`. `201`.
### `POST projects/{id}/remove_member/` → `{ user }`
Soft-removes (sets `is_active=False`). `204`.
### `GET project-memberships/?user=&project=&is_active=`
Lists `ProjectMembership` rows (seeds the User-Management project checkboxes via `?user=`).
### Embedded in user management
`MemberSerializer.projects[]` = `[{id, key, name, helpdesk, helpdesk_key}]`; `members/create_user`
accepts `projects: [{id}]` (each project's helpdesk must be among the requested `helpdesks`, else **400**).

## Error codes
- `400` — invalid `key` (fails `^[A-Z][A-Z0-9]{1,9}$`), duplicate `key`, duplicate `(project,key)`
  ticket-type.
- `403` — Agent attempting a write (read-only on `itsm.projects`; no access to `.config`).
- `409`-ish — deleting a workflow referenced as a project default is blocked by PROTECT (surfaces
  as a DB ProtectedError → 400/500 depending on handler).
