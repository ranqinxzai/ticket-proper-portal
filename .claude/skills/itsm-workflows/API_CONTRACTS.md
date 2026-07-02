# itsm-workflows — API Contracts

Base: `/api/v1/itsm/`. Config resources here; the **ticket transition** lives on the tickets app.

## Workflows — `itsm.workflows`
### `GET|POST workflows` · `.../{id}`  filter `?base_type=&is_active=`, search `name`
Shape: `{ id, name, description, base_type, is_default, is_active, version }`.
### `GET workflows/{id}/graph`
→ the node/edge graph (statuses with `canvas_x/y` + transitions) for the React Flow builder.
### `POST workflows/{id}/validate`
→ `{ "valid": bool, "errors": [..], "warnings": [..] }` (single-initial, create transition,
reachability, ≥1 Done, duplicate edges).

## Status categories — `itsm.workflows`
### `GET status-categories` (unpaginated)
The fixed three: `{ id, key: todo|in_progress|done, name, color, sort_order }`.

## Statuses — `itsm.workflows.transitions`
### `GET|POST statuses` · `.../{id}`  filter `?workflow=`
Shape: `{ id, workflow, name, key, category, color, sort_order, is_initial, pauses_sla, canvas_x, canvas_y }`.
`pauses_sla` (writable bool, default False) = "Exclude from SLA": entering the status pauses all running SLA clocks (honored by `itsm_sla.sla_engine.on_status_change`).

## Transitions — `itsm.workflows.transitions`
### `GET|POST transitions` · `.../{id}`  filter `?workflow=&from_status=`
Shape: `{ id, workflow, name, from_status, to_status, is_global, sort_order, post_functions,
auto_assign_rule, screen, conditions:[...] }`. `post_functions` = `[{type, config}]`.

## Auto-assignment rules / Reopen rules / Transition screens — `itsm.workflows.transitions`
- `auto-assignment-rules` — `{ id, name, strategy, target_group, fixed_user, config }`.
- `reopen-rules` (filter `?workflow=`) — `{ id, workflow, reopen_to_status, window_days,
  requires_comment }`.
- `transition-screens` (filter `?workflow=`) — `{ id, workflow, name, fields:[{field_key,
  is_mandatory, sort_order}] }`.

## Executing a transition (tickets app)
### `GET tickets/{id}/available-transitions/`
→ transitions valid from the ticket's current status whose conditions pass (for the action buttons).
Each transition also carries **`screen_fields`**: `[{ field_key, is_mandatory, sort_order, name,
field_type, options:[{value,label}] }]` — the transition's `TransitionScreen` fields resolved to their
FieldDefinition metadata (empty when it has no screen), so the client renders the capture slide-over
(e.g. the Incident Resolve → Resolution Details screen).
### `POST tickets/{id}/transition/`
Body `{ "transition_id": "<uuid>", "fields": {..}, "comment": "<html?>",
"comment_visibility": "public|private" }`. `fields` carries the transition-screen values (e.g. Resolve →
`resolution_code`/`root_cause`/`workaround_provided`/`resolution_notes`), persisted by the transition's
post-functions (`set_resolution` / `set_resolution_details`).
- `200` → updated ticket.
- `409` → stale button (ticket already moved).
- `403` → a condition guard failed.
- `422` → `{ "detail": "Mandatory fields missing.", "errors": { "<field_key>": ["..."] } }`.
