# itsm-workflows — Interlinking

## Depends on
- **itsm-core** — `BaseModel`, `log_event`, and `hooks` (SLA clock ops + `emit_event`).
- **itsm-rbac** — `get_user_role` for the `role_in` condition; `ItsmModelViewSet` base.
- **itsm-groups** — `resolve_assignee` for the `auto_assign` post-function;
  `AutoAssignmentRule.target_group`; `group_member` condition reads group memberships.
- **itsm-tickets** — the engine re-fetches and mutates `Ticket` (lazy import to avoid a cycle).

## Depended on by
- **itsm-tickets** — `Ticket.status`/`Ticket.workflow` (both PROTECT); the ticket ViewSet's
  `transition` + `available-transitions` actions call the engine. `create_ticket` reads the
  workflow's initial status.
- **itsm-projects** — `Project.default_workflow` (PROTECT); the project snapshots onto each ticket.
- **itsm-sla** (planned) — `on_status_change` drives clock start/stop/pause/resume; pause statuses
  come from the workflow.
- **itsm-notifications** (planned) — `StatusChanged` (and per-PF `emit_event`) events originate
  here.
- **itsm-fields** — `TransitionScreenField.field_key` references field definitions; transition
  screens validate against them.

## Cross-engine contract
The engine talks to SLA/notifications **only through `itsm_core.hooks`**, never by importing those
apps — so it runs identically before and after those engines exist.
