# Workflow Engine — ITSM Platform

Grounded in `backend/apps/itsm_workflows/services/engine.py`, `validators.py`, `models.py`, and `seed.py`. The engine is the **single choke‑point** for ticket status changes; the visual builder writes the same records it executes.

---

## 1. Data Model (recap)

A workflow is a graph: **`Status` = nodes** (with `canvas_x/y` for the builder, a fixed `StatusCategory` ∈ todo/in_progress/done, `is_initial`, and `pauses_sla` — "Exclude from SLA": entering the status pauses **all** running SLA clocks, honored by `itsm_sla.sla_engine.on_status_change`; the UI‑first way to build a **Hold** state without a `pause_sla` post‑function), **`Transition` = edges** (`from_status` nullable = create transition, `to_status`, `is_global`). A transition carries:
- `conditions` → `TransitionCondition[]` (read‑only guards),
- `screen` → `TransitionScreen` → `TransitionScreenField[]` (mandatory fields),
- `post_functions` → JSON `[{type, config}]`,
- `auto_assign_rule` → `AutoAssignmentRule`.

`ReopenRule` (per workflow) governs reopen window + comment requirement. `Workflow.version` supports copy‑on‑publish.

## 2. The Transition Pipeline

`engine.transition(ticket, transition, user, fields=None, comment=None)` — decorated `@transaction.atomic`, the ticket row is re‑fetched with `select_for_update`. **Ordered stages:**

```
1) resolve & assert  → 2) conditions → 3) validators → 4) apply status →
5) post-functions (canonical order) → 6) persist → 7) post-commit side-effects
```

### 1) Resolve & assert (stale‑button guard)
```python
if not transition.is_global and transition.from_status_id not in (None, locked.status_id):
    raise TransitionError("Ticket has already moved; refresh and retry.", status_code=409)
```
A global transition (`is_global=True`) is valid from any status; otherwise `from_status` must match the ticket's current status → otherwise **409**.

### 2) Conditions (guards → 403)
`evaluate_conditions` ANDs every `TransitionCondition`. First failure raises **403**. Condition types (`_check_condition`):
| Type | Passes when |
|---|---|
| `role_in` | caller is superuser, or caller's role code ∈ `config.roles`. |
| `is_assignee` | `ticket.assignee_id == user.id`. |
| `group_member` | the ticket's `assigned_group` has an **active** membership for the user (group id from `config.group_id` or the ticket's group). |
| `field_equals` | `getattr(ticket, config.field) == config.value`. |
- `negate=True` inverts the result.

### 3) Validators (mandatory screen fields → 422)
If the transition has a `screen`, every `TransitionScreenField(is_mandatory=True)` must be present in `fields`; **all** missing fields are collected into `errors` and raised together as **422**:
```jsonc
{ "detail": "Mandatory fields missing.", "errors": { "resolution": ["This field is required for this transition."] } }
```

Screen fields (and the `is_mandatory` flag) are **admin-configurable per transition** in the
workflow editor (2026-07-02): the transition serializer's writable `screen_fields`
(`[{field_key, is_mandatory, sort_order}]`) syncs the `TransitionScreen`/`TransitionScreenField`
rows; each `field_key` is a `FieldDefinition.key` from the project catalog.

### 4) Apply status (+ reopen detection)
- `locked.status = transition.to_status`.
- **Reopen detected** when moving **out of a Done** category into a non‑Done status → `reopen_count += 1`.

### 5) Post‑functions (canonical order)
Post‑functions are sorted by a fixed priority map so authors can't foot‑gun the order:
| Order | Type(s) | Effect |
|---|---|---|
| 10–12 | `auto_assign`, `set_assignee`, `clear_assignee` | resolve/set/clear the assignee |
| 20 | `set_priority` | set priority |
| 30–31 | `set_resolution`, `clear_resolution` | set/clear resolution (from `fields.resolution` or config) |
| 40 | `stamp_timestamp` | stamp one of `assigned_at / resolved_at / closed_at / first_responded_at` |
| 50–53 | `start_sla / stop_sla / pause_sla / resume_sla` | **deferred to post‑commit** |
| 90 | `emit_event` | **deferred to post‑commit** |

Mutating post‑functions run in‑memory now; **SLA + emit ops are queued** and executed after commit (stage 7). `auto_assign` calls `routing_service.resolve_assignee(strategy, group, user_id)`.
`transition(..., preserve_assignee=True)` (automation rules, 2026-10-18) skips `auto_assign` when the ticket already has an assignee; manual clicks keep the default `False`.

After post‑functions, the engine **persists captured screen fields generically** (2026-07-02):
`_apply_screen_columns` writes column‑backed (`config.maps_to`) screen fields to their Ticket column
(added to the save `update_fields`), and `_persist_screen_values` writes value‑backed custom fields
via `field_service.set_values` (→ `FieldValue`). Only non‑empty provided values are written; it is
idempotent with `set_resolution_details`.

### 6) Persist
`locked.save(update_fields=[...])` writes only the fields the pipeline can touch (status, assignee, priority, resolution, resolution_code/root_cause/resolution_notes/workaround_provided, reopen_count, the timestamp fields, updated_at, **plus any `maps_to` columns from the transition's capture screen**).

### 7) Post‑commit side‑effects (`transaction.on_commit`)
- `log_event` `status_changed` (from → to, transition name); plus `closed` when entering a `closed` status, `reopened` on reopen.
- `hooks.sla_on_status_change(ticket, from, to)`.
- Run the deferred SLA ops (`pause_sla` → `sla_pause`, `resume_sla` → `sla_resume`, `stop_sla` → `sla_stop`, `start_sla` → `sla_start_for_ticket`).
- `hooks.emit_event(...)` for any `emit_event` post‑function, plus a baseline `StatusChanged` event.
- `hooks.automation_dispatch("status_changed", ticket, actor, from_status, to_status)` runs the project's automation rules last (`itsm_automation`). It's a no-op when the actor is the automation bot.

Because all of this is on‑commit, a **rolled‑back transition notifies no one and starts no clock**.

## 3. Available Transitions
`engine.available_transitions(ticket, user)` returns transitions where `from_status == current` **or** `is_global`, **and** whose conditions pass for the caller. This powers `GET /tickets/{id}/available-transitions` so the UI only shows legal buttons.

## 4. Registries

| Registry | Members | Notes |
|---|---|---|
| **Conditions** | `role_in`, `group_member`, `is_assignee`, `field_equals` | read‑only; `negate` supported. |
| **Validators** | mandatory `TransitionScreenField`s | extensible (plan adds `comment_required`, `resolution_set`). |
| **Post‑functions** | `auto_assign`, `set_assignee`, `clear_assignee`, `set_priority`, `set_resolution`, `clear_resolution`, `stamp_timestamp`, `start_sla`, `stop_sla`, `pause_sla`, `resume_sla`, `emit_event` | canonical order enforced by `_PF_ORDER`. |

All three are stored as JSON `{type, config}` records the **visual builder** writes, and the engine dispatches on `type`.

## 5. Auto‑Assignment Strategies

`AutoAssignmentRule.strategy` and `routing_service.resolve_assignee`:
| Strategy | Behavior |
|---|---|
| `round_robin` | next **active** member after the stored cursor; `GroupAssignmentState` locked with `select_for_update` so two creates never grab the same member. |
| `least_loaded` | active member with the fewest **open (non‑done)** assigned tickets (tie‑broken by id). |
| `group_lead` | the group's `lead`. |
| `fixed_user` | a configured user. |
| `keep_current` | no change. |

Create‑time **routing** (`resolve_group_and_assignee`) evaluates active `RoutingRule`s (project‑scoped or global) in ascending `priority`; first `match_spec` match (`ticket_type`, `priority`) sets the group + optional assignee.

## 6. Reopen
A reopen is just a transition out of a Done status; the engine bumps `reopen_count` and (per `ReopenRule`) clears resolution + stamps a reopened timestamp + restarts the SLA. The rule enforces a `window_days` and optional `requires_comment`. The seeded Incident workflow includes `Resolved → In Progress` ("Reopen") with `clear_resolution` + `stamp(reopened_at)`.

## 7. Graph Validation (admin‑time)

`validate_workflow_graph(workflow)` runs on save/publish and returns `{valid, errors[], warnings[]}`:
- **error:** must have **exactly one** initial status.
- **error:** must have a create transition (`from_status = null`).
- **error:** must have ≥1 Done‑category status (else tickets could never close).
- **warning:** **unreachable** statuses (BFS from initial + create targets; global transitions reach all).
- **warning:** duplicate transitions (same `from`, `to`, `name`).

Exposed via `POST /workflows/{id}/validate`.

## 8. Visual Builder Mapping
- **Nodes** = `Status` (drag updates `canvas_x/y`); category sets the swimlane.
- **Edges** = `Transition` (`from_status` → `to_status`); a create edge has `from_status = null`.
- The **Inspector** edits a transition's conditions / screen / post‑functions / auto‑assign rule as JSON records.
- **Round‑trip:** `GET /workflows/{id}/graph` reads nodes+edges; a `PUT` persists them atomically (M4); `validate` then `publish` finalize a **new version** (copy‑on‑publish), so live tickets keep their snapshot workflow and aren't stranded.

## 9. The Two Seeded Workflows

**Incident** (`base_type=incident`, default):
```
New → Assigned → In Progress → Pending → Resolved → Closed
                       ↑__________|  (Resume)
Resolved → In Progress  (Reopen: clear_resolution + stamp reopened_at)
```
- *Assign*: `auto_assign(round_robin)` + `stamp(assigned_at)`.
- *Put on Hold*: `pause_sla(resolution)`; *Resume*: `resume_sla(resolution)`.
- *Resolve*: `set_resolution` + `stamp(resolved_at)` + `stop_sla(resolution)`.
- *Close*: `stamp(closed_at)`.

Statuses → categories: New/Assigned = **todo**; In Progress/Pending = **in_progress**; Resolved/Closed = **done**.

**Request** (`base_type=service_request`, default):
```
New → Approved → In Progress → Fulfilled → Closed
```
- *Start Fulfilment*: `auto_assign(round_robin)` + `stamp(assigned_at)`.
- *Fulfil*: `stamp(resolved_at)` + `stop_sla(resolution)`.
- *Close*: `stamp(closed_at)`.

Both are seeded idempotently by `itsm_workflows/seed.py:run()` after the three `StatusCategory` rows.

## 10. Error Contract Summary
| Stage | Failure | HTTP |
|---|---|---|
| resolve & assert | stale `from_status` | **409** |
| conditions | guard failed | **403** |
| validators | mandatory fields missing | **422** (`errors` map) |
| (generic) | bad request | **400** |

## Update 2026-10-18 — bug-fix batch (B14, B17, U4, U6, C5, C7, approvals, Rejected)
- **The create transition runs.** `from_status=None` + `is_global=False` = the create transition; `is_global=True` = available from any status.
  - `create_transition_for` / `start_status_for`: a new ticket starts at the create target (else `is_initial`).
  - `apply_create_transition` runs the safe post-functions (fill-only `auto_assign` / `set_assignee`, `stamp_timestamp`). `begin_create_approvals` starts `request_approval` inside the create transaction; `run_create_deferred` emits post-commit.
- **New guards** (§10 error contract):
  - The create transition on an existing ticket → **400**.
  - A transition into a deleted status → **400**.
  - A non-global null-from transition is never offered (§3).
  - An approval that can't start → **400**, and the transition rolls back.
- **Approvals** (§5 post-functions, §7 side effects).
  - `request_approval` now calls `hooks.begin_approval` **inside** the transaction (step 6d). It's the one non-swallowing hook; `ApprovalStartError` is a 400 `TransitionError`.
  - Condition `approval_granted` passes only when the latest non-cancelled request is approved (or there is none).
  - New condition `approval_rejected` (latest request rejected).
- **Field conditions:** rules on fields the project doesn't have are skipped, and cascade rules need a leaf value. `blocked_reasons(ticket, transitions)` gives `available-transitions` a `blocked_reason` per row (the capture-screen fields are excluded).
- **Auto-assignment** (§5). `auto_assign` never overwrites an existing assignee (`itsm_groups.pick_assignee_if_unassigned`, all orgs).
- **Priority.** `set_priority` and a screen priority field log `priority_changed` and call `hooks.sla_priority_changed`.
- **Statuses.** Deleting an in-use or start status → 400. A delete soft-deletes the status's transitions.
- **Shared workflows.** `GET workflows/{id}/usage/` and `POST workflows/{id}/clone/` (`services/cloner.clone_workflow`; links the copy to a project and repoints its automation rules). Open tickets keep their snapshot.
- **Seeded Request workflow** (§9) gains **Rejected** (done, red) and **Reject** New → Rejected (stop resolution SLA, stamp `closed_at`, gated by `approval_rejected`).
  - Migration `itsm_workflows/0009` applies it to every default `service_request` workflow, skipping workflows that already have a `rejected` key.
  - A rejected approval auto-runs it as `automation-bot`. `rejected` is terminal like closed (the Closed event, the closed audit, no CSAT).

## Update 2026-10-24 — Send for approval (system status moves)
- **Status flag.** `Status.allows_send_for_approval` lets agents start an approval from that status. `Status.approval_waiting_status` is where the ticket waits (null = stays). Neither may be a Done status; the waiting status must be in the same workflow.
- **`engine.move_for_approval(ticket, to_status, user, *, label)`** is the second sanctioned status write, used only by `itsm_approvals`.
  - It's a system move: no Transition row, so no conditions, screens, field conditions or post-functions, and it ignores the pending-approval freeze.
  - It shares §7's post-commit side effects with `transition()` through `_status_change_effects`: audit (`transition` = the label, e.g. "Sent for approval" / "Approval approved"), `sla_on_status_change` (so a waiting status with `pauses_sla` pauses the clocks), the StatusChanged emit, and the automation `status_changed` trigger.
- **Return.** A decided or withdrawn *sent* request moves the ticket back to the status it was sent from, but only if it still sits in the waiting status. It never auto-runs the Rejected transition.
- **Validator:** source ↔ waiting count as edges (no "Unreachable" warning). **Delete:** a waiting target can't be deleted. **Clone:** the waiting FK is remapped.
- **Gates unchanged:** `approval_granted` / `approval_rejected` read the latest non-cancelled request, sent or policy.
