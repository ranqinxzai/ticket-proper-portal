# itsm-projects — API Contracts

Base: `/api/v1/itsm/`.

## Projects — `itsm.projects`
### `GET projects`  (Agent: read OK)
Filters: `?project_type=&status=`. Search: `name`, `key`, `description`.
Item shape (read): `{ id, name, key, description, project_type, status, color, icon,
default_group, default_workflow, lead, created_by, ticket_types: [...], created_at, updated_at }`.
### `POST projects` · `PUT|PATCH projects/{id}` (Supervisor)
Write body (`ProjectWriteSerializer`): `{ name, key, description?, project_type?, status?, color?,
icon?, default_group?, default_workflow?, lead? }`. `created_by` is set server-side.
### `DELETE projects/{id}`
Soft-delete.

## Ticket types — `itsm.projects.config`
### `GET ticket-types`  filter `?project=&base_category=&is_active=`
Shape: `{ id, project, name, key, icon, base_category, parent, is_active, is_default, sort_order }`.
### `POST|PUT|PATCH|DELETE ticket-types/{id}` (Supervisor)
Unique `(project, key)` enforced.

## Error codes
- `400` — invalid `key` (fails `^[A-Z][A-Z0-9]{1,9}$`), duplicate `key`, duplicate `(project,key)`
  ticket-type.
- `403` — Agent attempting a write (read-only on `itsm.projects`; no access to `.config`).
- `409`-ish — deleting a workflow referenced as a project default is blocked by PROTECT (surfaces
  as a DB ProtectedError → 400/500 depending on handler).
