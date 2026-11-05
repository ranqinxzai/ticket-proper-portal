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
### `POST workflows/create_starter` — body `{ name (required), base_type? }`
Creates a NEW, immediately-**valid** starter workflow: statuses To Do (initial) → In Progress → Done
+ a create transition (`from_status=null`). `is_default=false`, `version=1`. `base_type` coerced to
`custom` if unknown; blank `name` → **400**. Returns the new `WorkflowSerializer` shape (**201**).
List action (the empty-state has no source id), so POST ⇒ the `create` action → **`itsm.workflows`
create** permission. Only creates — the caller links it via `PATCH /projects/{id}/ {default_workflow}`.
Use this instead of a bare `POST /workflows/` (which yields an invalid, unusable flat record).

## Status categories — `itsm.workflows`
### `GET status-categories` (unpaginated)
The fixed three: `{ id, key: todo|in_progress|done, name, color, sort_order }`.

## Statuses — `itsm.workflows.transitions`
### `GET|POST statuses` · `.../{id}`  filter `?workflow=`
Shape: `{ id, workflow, name, key, category, color, sort_order, is_initial, pauses_sla,
allows_send_for_approval, approval_waiting_status, approval_waiting_status_name, canvas_x, canvas_y }`
(Send for approval fields: see the Approvals section at the end).
`pauses_sla` (writable bool, default False) = "Exclude from SLA": entering the status pauses all running SLA clocks (honored by `itsm_sla.sla_engine.on_status_change`).

## Transitions — `itsm.workflows.transitions`
### `GET|POST transitions` · `.../{id}`  filter `?workflow=&from_status=`
Shape: `{ id, workflow, name, from_status, to_status, is_global, sort_order, post_functions,
auto_assign_rule, screen, conditions:[...], screen_fields:[...] }`. `post_functions` = `[{type, config}]`.
- **`screen_fields`** (read + write) = `[{field_key, is_mandatory, sort_order}]` — the transition's
  **capture screen** fields (e.g. Resolve → `root_cause`/a custom `resolution_type`). On **read** it's
  injected from the transition's `TransitionScreen` (empty `[]` when none). On **write** it **replaces**
  the screen: `_sync_screen` `get_or_create`s a `TransitionScreen`, replaces its `TransitionScreenField`
  rows, and an **empty list detaches** (soft-deletes an unused screen). Each `field_key` must be a live
  `FieldDefinition.key` (global or project) else **400**. Managed here on the transition — there is **no
  `transition-screen-fields` endpoint**; `transition-screens` still exposes only `id/workflow/name`.
- Write-only companions on the same PATCH: **`requires_approval`** (bool, toggles the `approval_granted`
  gate) and the note prompt fields (`note_prompt`/`note_required`/`note_heading`/`note_visibility`).

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

## Bug-fix batch additions (added 2026-10-18)
### `GET workflows/{id}/usage/` · `itsm.workflows`
`{ project_count, projects: [{id, key, name, helpdesk_key}], hidden_count, is_default, base_type }`. Projects the caller can't access are only counted, in `hidden_count`.

### `POST workflows/{id}/clone/` · `itsm.workflows` create
- **Body:** `{ project?, name? }`. With `project`, the copy is also linked as that project's Default workflow; this needs `itsm.projects:update` (403), and the project must use the source workflow (400).
- **Returns:** 201 with the workflow plus `automation: { repointed, unmatched }`. A duplicate name → 400 `{ name: [...] }`.

### Transitions, statuses
- **`TransitionSerializer`:**
  - Adds read-only `to_status_name`, `to_status_category` and `from_status_name`. The graph adds `is_default`.
  - 400 for a second create transition (`from_status=null`, `is_global=false`) or a create into a Done status.
- **`GET tickets/{id}/available-transitions/`:** rows carry `blocked_reason` (a failing field condition) or null.
- **`DELETE statuses/{id}/`:** 400 when the status is in use or is the create target. Otherwise its transitions are soft-deleted too.
- **`POST tickets/{id}/transition/`:**
  - 400 for the create transition on an existing ticket, or a transition into a deleted status.
  - 400 `TransitionError` when a `request_approval` can't start (`hooks.begin_approval`); the status change is rolled back.

### Approvals (`itsm_approvals`, documented here; there is no approvals skill)
- **`approval-requests/` list/retrieve:**
  - Clamped to accessible helpdesks/projects + own tickets + requests you approve.
  - Adds `mode`, `stage_ids`, `pending_stages[]`, `can_decide`, `blocked_reason`, ticket keys, `approver_*_name` and `approver_problem`.
- **`POST approval-requests/start/`** `{ticket, workflow}`: needs `itsm.approvals` create. An inaccessible ticket → 404; an inactive workflow or unstartable stage → 400.
- **`approval-requests/my-pending/`, `{id}/approve/`, `{id}/reject/`:** `CanUseApprovalInbox` (`itsm.portal.approvals` read for roled users). `reject` requires `comment` (400 `{errors: {comment}}`).
- **`approval-stages/`:** validated (target set/active, `min_approvals`, live-level unique; `level` optional). `approval-workflows/` serializes `mode` and `is_active`.

## Approvals — Send for approval (2026-10-24) — `itsm.approvals.send`
### `GET approval-requests/send-options/?ticket=<id>`
→ `{ allowed, reason, status:{id,name}, waiting_status:{id,name}|null, workflows:[{ id, name,
description, mode, problem, stages:[{ id, name, level, approver_type, approver_label, rule,
min_approvals, problem, approver_names[], approver_count, on_fly_pool?, pool_label?,
candidates?:[{id,name,email}]|null }] }] }`. The project's active policies only. `candidates` is
null for an "any user" pool (search `GET /users/?search=`); capped at 500. Inaccessible ticket → 404.
### `POST approval-requests/send/` — body `{ ticket, workflow, approvers?:{stage_id:[user_id]}, note? }`
→ **201** the `ApprovalRequest` (`source:"sent"`). **400** status not flagged / another project's
policy / pick problems (`errors.approval[]` per stage) / note > 2000; **409** already pending;
**403** no `itsm.approvals.send` create; **404** no access to the ticket.
### `POST approval-requests/{id}/withdraw/` — body `{ reason? }`
→ 200 the cancelled request. **400** a policy (transition/catalog) request; **403** not the sender
and no `itsm.approvals.send` delete; **409** already decided.
### Request shape additions
`source` (policy|sent), `note`, `requested_by_name`, `return_status_name`, `waiting_status_name`,
`can_withdraw` (viewer).
### Stage shape additions (`approval-stages`, `itsm.approvals.admin`)
`approver_type` += `on_the_fly`; `on_fly_pool` (any_user|group|listed_users), `candidate_users`
(ids, write), `candidate_users_detail` ([{id,name,is_active}]). 400 when the policy is started by a
transition / catalog item.
### Status shape additions (`statuses`)
`allows_send_for_approval`, `approval_waiting_status` (id|null), `approval_waiting_status_name`.
### Transition
`post_functions` with a `request_approval` naming an On-fly policy → **400**.

