# itsm-helpdesks

## Purpose
The department/workspace layer above Projects. A `Helpdesk` (IT, HR, Facilities, …) is a
workspace that owns its own default Incident + Request projects, its own Service Desk group,
and an explicit member roster. **Membership is the row-level scope every ticket-facing query is
clamped to** — an IT agent never sees an HR ticket. Two helpdesks are seeded: **IT** and **HR**.
This app is the rename of "ITSM" → **One Helpdesk**: multiple departments share one platform.

## Backend app path
`backend/apps/itsm_helpdesks/`

## Key concepts
- **`Helpdesk`** — unique `name`, unique `key` (2–5 uppercase, `KEY_VALIDATOR ^[A-Z][A-Z0-9]{1,4}$`),
  `description`, `icon`, `color`, `status` (active/inactive/archived), `created_by`. The `key` is the
  **per-helpdesk ticket-number prefix**: helpdesk `IT` → projects `ITINC`/`ITREQ` → tickets `ITINC-1`.
  Kept ≤ 5 chars so `<key>INC` still fits `Project.KEY_VALIDATOR` (≤ 10). **Retire via
  `status='archived'`, never soft delete** (`BaseModel.soft_delete()` doesn't cascade).
- **`HelpdeskMembership`** — `(helpdesk, user)` with `role_in_helpdesk` (member/lead) + `is_active`.
  Unique `(helpdesk, user)`; mirrors `itsm_groups.GroupMembership`. Active membership of an active
  helpdesk = access.
- **`services.py` = the scoping primitives.** Every ticket-facing query across the product reuses
  `accessible_helpdesk_ids(user)` (`None` = unrestricted/superuser; `[]` = nothing) and
  `resolve_helpdesk_scope` (clamps the advisory `?helpdesk=` to the accessible set — never widens,
  never 403s). These live in shared services, NOT only in `TicketViewSet.get_queryset`.

## Frontend path / pages
- `/home` — the new portal: helpdesk cards + a right-side attention panel (assigned-to-me,
  SLA-at-risk approximated via `due_date`, unread notifications). Root `/` redirects here.
- `/admin/helpdesks` — supervisor management (create helpdesk + add/remove members).
- `lib/itsm/helpdesk.tsx` — `HelpdeskProvider` / `useSelectedHelpdesk` (localStorage, advisory only),
  mounted inside `ItsmGuard`; drives the `ItsmShell` HelpdeskSwitcher dropdown.

## API clients
`/api/v1/itsm/helpdesks` (+ `members` / `add_member` / `remove_member` actions),
`/api/v1/itsm/helpdesk-memberships`. The `?helpdesk=<id|key>` param is advisory and threads
through ticket/report/dashboard/SLA endpoints.

## RBAC module codes
- `HelpdeskViewSet` + `HelpdeskMembershipViewSet` → **`itsm.admin.helpdesks`** (parent `itsm.admin`):
  Supervisor full; **Agent read-only** (added to `AGENT_RO_MODULES`).

## Key files
- `models.py` — `Helpdesk`, `HelpdeskMembership`, `HelpdeskStatus`, `KEY_VALIDATOR`.
- `services.py` — `accessible_helpdesk_ids`, `resolve_helpdesk_scope`, `scope_ticket_queryset`,
  `is_project_accessible`, `helpdesk_member_ids`, `build_helpdesk_membership`.
- `views.py` — `HelpdeskViewSet` (read/write serializer split, member actions), `HelpdeskMembershipViewSet`.
- `serializers.py` — `HelpdeskSerializer` / `HelpdeskWriteSerializer` / `HelpdeskMembershipSerializer`.
- `urls.py` — registers `helpdesks`, `helpdesk-memberships`.
- `seed.py` — `run()` seeds IT + HR; `seed_memberships()` enrolls role-assigned non-superusers.
