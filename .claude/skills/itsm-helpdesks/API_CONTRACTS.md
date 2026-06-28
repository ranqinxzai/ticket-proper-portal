# itsm-helpdesks — API Contracts

Base: `/api/v1/itsm/`. Both viewsets: module **`itsm.admin.helpdesks`** (Supervisor full;
Agent read-only). The `HelpdeskViewSet` list is scoped by role: a **manager** (superuser, or anyone
with `itsm.admin.helpdesks:update`) sees **all** helpdesks incl. `inactive`/`archived` (so they can be
re-enabled); a plain Agent sees only the **active** helpdesks they're a member of.

## Helpdesks — `helpdesks`
### `GET helpdesks`  (Agent: read OK, scoped to membership; manager: all statuses)
Filter: `?status=`. Search: `name`, `key`, `description`. Ordering: `?ordering=order|name`
(default `order, name`).
Read item (`HelpdeskSerializer`):
`{ id, name, key, description, icon, color, status, order, member_count, created_at }`.
### `POST helpdesks` · `PUT|PATCH helpdesks/{id}` (Supervisor)
Write body (`HelpdeskWriteSerializer`): `{ name, key, description?, icon?, color?, status?, order? }`.
`created_by` is set server-side; **`order` is auto-assigned to max+1 on create** (new helpdesks append).
Disable = `PATCH {status:'inactive'}` (reversible); re-enable = `{status:'active'}`.
### `POST helpdesks/reorder` (Supervisor) — set the global Home-card order
Body `{ order: [id, id, …] }` → each helpdesk's `order` becomes its index, in one atomic pass; `204`.
`build_helpdesk_membership` (the Home/auth-me source) then orders by `order, name`, so every agent's
cards follow it on their next `auth/me`.
### `DELETE helpdesks/{id}`
Soft-delete (`BaseModel`). **Prefer `PATCH status='archived'`** to retire — soft delete does not
cascade and archived is what `accessible_helpdesk_ids` excludes.

### Member actions
- `GET helpdesks/{id}/members` → active memberships, serialized as `HelpdeskMembershipSerializer[]`.
- `POST helpdesks/{id}/add_member` body `{ user, role_in_helpdesk? }` → idempotent
  `update_or_create` (re-adds a previously removed member by flipping `is_active` back on); `201`.
- `POST helpdesks/{id}/remove_member` body `{ user }` → sets `is_active=False`; `204` (soft remove).

## Helpdesk memberships — `helpdesk-memberships`
### `GET helpdesk-memberships`  filter `?helpdesk=&user=&is_active=`
Shape (`HelpdeskMembershipSerializer`):
`{ id, helpdesk, user, username, full_name, role_in_helpdesk, is_active }`.
### `POST|PUT|PATCH|DELETE helpdesk-memberships/{id}` (Supervisor)
Unique `(helpdesk, user)` enforced.

## The `?helpdesk=` scope param (convention)
Threaded through **ticket / report / dashboard / SLA** endpoints (not just this app). Value is a
helpdesk **id (UUID) or short key** (case-insensitive). It is **advisory**: the server resolves it
and intersects it with the user's accessible set via `resolve_helpdesk_scope` —
- resolves to an accessible helpdesk → scope narrows to just it;
- foreign / unknown / not-a-member → ignored, scope falls back to the full accessible set
  (no 403, no widening). A superuser may narrow to any helpdesk.

## auth/me payload
`GET auth/me` (and the login token serializer) include a `helpdesks` field from
`build_helpdesk_membership(user)` → `[{ id, key, name, icon, color }]` (superuser ⇒ all active).
This drives the Home selector + the HelpdeskSwitcher.

## Error codes
- `400` — invalid `key` (fails `^[A-Z][A-Z0-9]{1,4}$`), duplicate `key`/`name`, duplicate
  `(helpdesk, user)` membership.
- `403` — Agent attempting a write on `itsm.admin.helpdesks`; or a write guard on a ticket-facing
  endpoint rejecting an inaccessible project/target/template. (The `?helpdesk=` param itself never 403s.)
- `404` — a detail/transition/assign/comments call for a ticket id in a helpdesk the caller can't
  access (the row is simply not in their queryset).
