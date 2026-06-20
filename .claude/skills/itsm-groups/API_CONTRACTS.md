# itsm-groups — API Contracts

Base: `/api/v1/itsm/`. All under module `itsm.groups` (Agent read-only, Supervisor full).

## Groups
### `GET groups`  filter `?type=&is_active=`, search `name/key/description`
Shape: `{ id, name, key, description, type, lead, is_active, created_at, updated_at }`.
### `POST|PUT|PATCH|DELETE groups/{id}` (Supervisor) — DELETE soft-deletes.
### `GET groups/{id}/members`
→ active `GroupMembership`s with nested user.
### `POST groups/{id}/add_member`
Body `{ "user": "<uuid>", "role_in_group": "member|lead" }` → 201 membership (idempotent upsert,
reactivates if previously removed).
### `POST groups/{id}/remove_member`
Body `{ "user": "<uuid>" }` → 204 (soft: sets `is_active=False`).

## Group memberships
### `GET|POST group-memberships` · `.../{id}`  filter `?group=&user=&is_active=`
Shape: `{ id, group, user, role_in_group, is_active }`.

## Routing rules
### `GET|POST routing-rules` · `.../{id}`  filter `?project=&is_active=`
Shape: `{ id, project, name, priority, match_spec, target_group, target_assignee, is_active }`.
`match_spec` JSON, e.g. `{ "ticket_type": "<uuid>", "priority": "high" }`. Lower `priority` =
evaluated first.

## Error codes
- `400` — duplicate `name`/`key` (both unique), missing `user` in add/remove.
- `403` — Agent attempting any write.
