# itsm-groups

## Purpose
Operational teams that own and work tickets, plus the auto-assignment and create-time
routing logic. A `Group` has members (`GroupMembership`), a round-robin cursor
(`GroupAssignmentState`), and `RoutingRule`s decide which group/assignee a new ticket lands
on. Auto-assignment strategies (round-robin, least-loaded, group-lead, fixed-user) are the
service layer the workflow engine calls during a transition.

## Backend app path
`backend/apps/itsm_groups/`

## Key concepts
- **`Group`** — `helpdesk` (FK Helpdesk, **SET_NULL**, nullable — `null` = shared/global team),
  `name`/`key` (both unique), `type` (service_desk/network/infra/security/app_support/custom),
  `lead`, `is_active`. Seeded: 4 shared global teams (Network, Infrastructure, Security, Application
  Support) **plus one namespaced Service Desk group per helpdesk** (e.g. `it-service-desk` / "IT
  Helpdesk Service Desk"), which is the default landing group for that helpdesk's projects.
- **`GroupMembership`** — `(group, user)` unique; `role_in_group` member/lead; `is_active`.
- **`GroupAssignmentState`** — one row per group, the round-robin cursor (`last_assigned_user`),
  locked with `select_for_update` during a pick so two tickets never grab the same member.
- **`RoutingRule`** — create-time ownership: ascending `priority`, first match wins; `match_spec`
  JSON (ticket_type / priority / field conditions) → `target_group` (+ optional `target_assignee`).
  A `project=null` rule is global.
- **Services (`services.py`)** — `round_robin_pick`, `least_loaded_pick`, `resolve_assignee(strategy,
  group, fixed_user_id)`, `resolve_group_and_assignee(ticket)`, `active_member_ids`.

## Frontend path / pages (planned)
Groups management screen (list, members, lead) under the project config hub /
`admin/.../groups`; routing-rule editor.

## API clients
`/api/v1/itsm/groups` (+ `members`/`add_member`/`remove_member` actions),
`/api/v1/itsm/group-memberships`, `/api/v1/itsm/routing-rules`.

## RBAC module codes
All three ViewSets → **`itsm.groups`** (Agent: read-only; Supervisor: full CRUD + membership
actions).

## Key files
- `models.py` — `Group`, `GroupMembership`, `GroupAssignmentState`, `RoutingRule`, `GroupType`.
- `services.py` — auto-assign strategies + routing resolver.
- `views.py` — `GroupViewSet` (member actions), `GroupMembershipViewSet`, `RoutingRuleViewSet`.
- `urls.py` — `groups`, `group-memberships`, `routing-rules`.
- `seed.py` — seeds the 4 shared global teams + one Service Desk group per active helpdesk.
