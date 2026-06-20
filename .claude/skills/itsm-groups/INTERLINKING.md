# itsm-groups — Interlinking

## Depends on
- **itsm-core** — `BaseModel`.
- **itsm-projects** — `RoutingRule.project` (nullable scope).
- **itsm-tickets** — `least_loaded_pick` queries `Ticket` open-load counts (lazy import to avoid a
  cycle).

## Depended on by
- **itsm-tickets** — `Ticket.assigned_group` (FK Group); `create_ticket` calls
  `resolve_group_and_assignee`. Group is also the default fallback (`project.default_group`).
- **itsm-workflows** — the `auto_assign` post-function and `AutoAssignmentRule.target_group` call
  `resolve_assignee`; the `group_member` transition condition checks
  `ticket.assigned_group.memberships`.
- **itsm-projects** — `Project.default_group` (SET_NULL).
- **itsm-notifications** (planned) — `group_members` / `group_lead` recipient resolvers read
  memberships + `Group.lead`.
- **itsm-fields** — `group_picker` field type references groups.

## Cross-engine note
Auto-assignment is invoked from the **workflow engine** (a post-function), not from the group app
directly — keeping the group app a pure provider of teams + strategies.
