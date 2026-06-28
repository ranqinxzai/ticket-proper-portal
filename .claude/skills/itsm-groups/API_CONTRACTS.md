# itsm-groups — API Contracts

Base: `/api/v1/itsm/`. All under module `itsm.groups` (Agent read-only, Supervisor full).

## Groups
### `GET groups`  filter `?helpdesk=&type=&is_active=`, search `name/key/description`
Shape: `{ id, helpdesk, helpdesk_name, name, key, description, type, lead, lead_name, is_active,
member_count, created_at }`. **List is helpdesk-scoped**: `GroupViewSet.get_queryset` returns the
caller-accessible helpdesks' groups **plus** shared/global (`helpdesk=null`) teams, honouring the advisory
`?helpdesk=` clamp (superuser unrestricted). So `?helpdesk=IT` lists IT's groups + shared teams, never
HR-only groups.
### `POST|PUT|PATCH|DELETE groups/{id}` (Supervisor) — DELETE soft-deletes.
`perform_create` rejects (**403**) creating a group in a helpdesk the caller can't access; creating a
shared/global (`helpdesk=null`) group is **superuser-only** (mirrors `ProjectViewSet.perform_create`).
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
Shape: `{ id, project, name, priority, match_spec, target_group, target_group_name,
target_assignee, target_assignee_name, is_active }`. Lower `priority` = evaluated first.
`match_spec` JSON, two shapes (read-tolerant of both):
- **condition list** `{ "match": "all"|"any", "conditions": [{ "field", "operator": "eq"|"neq",
  "value" }] }` — `field` is a built-in attr (`ticket_type`/`priority`/`impact`/`urgency`/`source`)
  or a **custom field key** (e.g. `"location"`, matched against the create payload's `custom_fields`).
- **legacy flat** `{ "ticket_type": "<uuid>", "priority": "high" }` (AND).
Resolver: `apps.itsm_groups.services.resolve_group_and_assignee(ticket, custom_fields=…)`, applied at
create only when no group/assignee was chosen. Empty spec matches every ticket.

## Error codes
- `400` — duplicate `name`/`key` (both unique), missing `user` in add/remove.
- `403` — Agent attempting any write; non-member creating a group in an inaccessible helpdesk; non-superuser
  creating a shared/global (null-helpdesk) group.
