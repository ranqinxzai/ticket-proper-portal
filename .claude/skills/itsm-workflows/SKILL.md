# itsm-workflows

## Purpose
The ticket lifecycle engine. A `Workflow` is a graph of `Status` nodes and `Transition`
edges; the execution engine (`services/engine.py`) is the single choke-point for every
status change, running an ordered pipeline of conditions → validators → status apply →
post-functions → post-commit side-effects. The models also power the visual builder
(statuses = nodes with canvas x/y, transitions = edges) and an admin-time graph validator.

## Backend app path
`backend/apps/itsm_workflows/`

## Key concepts
- **`StatusCategory`** — the fixed three: To Do / In Progress / **Done**. Drives queue grouping,
  reopen detection, and "open vs closed" everywhere.
- **`Status`** — a node in one workflow; `is_initial`, `category`, `canvas_x/y` for the builder.
  Unique `(workflow, key)`.
- **`Transition`** — an edge `from_status → to_status` (`from_status=null` = the "create"
  transition); `is_global` = available from any status; `post_functions` JSON `[{type, config}]`;
  optional `screen` (mandatory fields) and `auto_assign_rule`.
- **`TransitionCondition`** — read-only guards: `role_in`, `group_member`, `is_assignee`,
  `field_equals` (with `negate`). First failing condition blocks the transition (403).
- **`TransitionScreen`(+`Field`)** — fields required when a transition runs (e.g. Resolve →
  resolution). Missing mandatory fields → 422 with per-field errors.
- **`AutoAssignmentRule`** — strategy + target group/user for the `auto_assign` post-function.
- **`ReopenRule`** — reopen-to-status + window + comment requirement.
- **Engine** — `transition()`, `available_transitions()`; canonical post-function ordering;
  `select_for_update` lock; reopen detection; SLA/notification hooks on commit.
- **Graph validator** — admin-time checks (single initial, a create transition, reachability,
  ≥1 Done status, no duplicate edges).

## Frontend path / pages (planned)
React Flow visual builder (`admin/.../workflows/[id]`): StatusNode / TransitionEdge / Inspector;
transition screens; `available-transitions` drives the ticket-detail action buttons.

## API clients
`workflows` (+ `graph`, `validate` actions), `statuses`, `status-categories`, `transitions`,
`auto-assignment-rules`, `reopen-rules`, `transition-screens`. Ticket transitions go through the
**tickets** app (`POST tickets/{id}/transition/`).

## RBAC module codes
- `WorkflowViewSet`, `StatusCategoryViewSet` → **`itsm.workflows`**.
- `StatusViewSet`, `TransitionViewSet`, `AutoAssignmentRuleViewSet`, `ReopenRuleViewSet`,
  `TransitionScreenViewSet` → **`itsm.workflows.transitions`**.
Agent: read-only on `itsm.workflows`; Supervisor: full.

## Key files
- `models.py` — all workflow models.
- `services/engine.py` — `transition`, `available_transitions`, conditions/validators/post-functions.
- `validators.py` — `validate_workflow_graph`.
- `views.py` — the seven ViewSets (+ `graph`/`validate` actions).
- `seed.py` — the Incident + Request default workflows.
