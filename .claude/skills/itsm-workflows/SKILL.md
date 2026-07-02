# itsm-workflows

## Purpose
The ticket lifecycle engine. A `Workflow` is a graph of `Status` nodes and `Transition`
edges; the execution engine (`services/engine.py`) is the single choke-point for every
status change, running an ordered pipeline of conditions → validators → status apply →
post-functions → post-commit side-effects. The models also power the visual builder
(statuses = nodes with canvas x/y, transitions = edges) and an admin-time graph validator.

## Update (2026-07-02) — Incident Resolve screen (ITIL Resolution Details)
- The Incident **Resolve** transition is seeded with a **`TransitionScreen` "Resolution Details"**
  (fields `resolution_code`, `root_cause`, `workaround_provided`, `resolution_notes` — non-mandatory by
  default; admins can require any via the `transition-screen-fields` API / Configure dialog) **plus** a
  new **`set_resolution_details`** post-function that writes the captured transition `fields` to the
  matching `Ticket` columns.
- **Engine:** `set_resolution_details` added to `_apply_post_function` and `_PF_ORDER` (32, after
  `set_resolution`); the persist `update_fields` list gained `resolution_code`/`root_cause`/
  `resolution_notes`/`workaround_provided`; `clear_resolution` (Reopen) now also clears them. `_validate`
  (unchanged) still enforces mandatory screen fields → **422**.
- **Seed/migration:** `seed.py::ensure_resolution_screen` (called for `base_type=="incident"` workflows
  in `run()`) + data migration `0004_incident_resolution_screen` (per tenant). Request/Fulfil is
  unchanged (Incident-only).
- **API:** `GET tickets/{id}/available-transitions/` (tickets app) now returns per-transition
  **`screen_fields`** = each `TransitionScreenField` resolved to its FieldDefinition (name/type/options)
  so the client renders the resolve slide-over. See **itsm-tickets**.

## Update (2026-07-02) — per-status "Exclude from SLA calculation" flag (`Status.pauses_sla`)
- New `Status.pauses_sla` (BooleanField, default False; migration **`0005_status_pauses_sla`**) marks a
  status as **SLA-excluded**: a ticket entering it **pauses ALL of its running SLA clocks**
  (first_response + resolution + assignment) and resumes them on leaving. This is the UI-first
  provision for a **Hold**-type state — the property lives on the *status*, so it works for **any**
  transition into that status with **no** per-transition `pause_sla` post-function.
- Honored centrally in **`itsm_sla.services.sla_engine.on_status_change`** (read via `getattr` — the
  cross-engine hook swallows errors), unioned with the legacy per-metric `SLAMetric.pause_statuses`
  for the resolution clock. See itsm-sla SKILL/ARCHITECTURE.
- Exposed on `StatusSerializer` (writable) → flows through `/statuses/` and the workflow `graph`
  endpoint. **Config UI:** Workflow settings tab (`components/settings/workflow-editor.tsx`) — an
  "Exclude from SLA" checkbox on the add-status form + a per-status **Status settings** dialog
  (`StatusSettingsDialog`, module-top-level + keyed for focus stability) to toggle it on existing
  statuses; list rows show an amber **`SLA paused`** badge.
- **Not seeded:** no "Hold" status ships by default — admins create/mark one via the toggle. The
  existing seeded **Pending** state still pauses resolution via `SLAMetric.pause_statuses` (unchanged).
- Tests: `apps/itsm_sla/tests.py` (`SlaPauseFlagTests`), `apps/itsm_workflows/tests.py`
  (`StatusPausesSlaSerializerTests`).

## Update (2026-06-28) — approvals are configurable per-transition in the builder
- `request_approval` (post-function) and `approval_granted` (condition) — previously seed-only
  (`itsm_approvals/seed.py`) — are now editable from the per-transition **Configure** dialog
  (`TransitionNoteDialog` in `components/settings/workflow-editor.tsx`):
  - **Start approval** — a Select of `ApprovalWorkflow`s (scoped to the project). Writes/removes a
    `request_approval` post-function (`config={"workflow_id": <id>}`) by **merging** the
    `post_functions` JSON (other post-functions are preserved). Pure frontend — `post_functions` is
    already writable on `TransitionSerializer`.
  - **Require approval** — a checkbox. Writes/removes the `approval_granted` `TransitionCondition`
    via a new **write-only** `requires_approval` field on `TransitionSerializer` (custom
    `create()`/`update()` → `_sync_approval_gate`, idempotent get_or_create/delete). **No migration**
    (write-only serializer field; the model + JSON field already exist). The dialog derives the
    *displayed* checkbox state from the `conditions` array (read), so nothing is echoed back.
  - The two wires normally live on **different** transitions (start on the entry, require on the
    exit); the dialog shows a hint. The gate is inert unless an approval was started (it passes when
    none is pending).
  - List rows show **`starts approval`** (violet) / **`needs approval`** (amber) badges.
  - **Re-seed caveat:** `itsm_workflows/seed.py` uses `update_or_create(defaults={...post_functions...})`,
    so re-running `seed_itsm` overwrites a manually-added `request_approval` on a **seeded** transition
    (same as it already does for `note_*`). The gate condition is safe (approvals seed uses
    `get_or_create`). Admin-created transitions are untouched.
  - Tests: `apps/itsm_workflows/tests.py` (`RequiresApprovalToggleTests`, `ApprovalGateEngineTests`).

## Update (2026-06-25) — `Transition.portal_allowed` flag (end-user portal Reopen)
- New `Transition.portal_allowed` (BooleanField, default False; migration **`0003_transition_portal_allowed`**)
  marks a transition as **invokable from the end-user Service Portal** (e.g. Reopen). Added to
  `TransitionSerializer.Meta.fields` (so the workflow builder can toggle it) and the TS `Transition`/
  `WorkflowTransition` types.
- **Engine:** `available_transitions(ticket, user, portal_only=False)` — when `portal_only`, filters
  `portal_allowed=True` **before** conditions. Conditions still apply on top, so a portal-allowed
  transition with an agent-only condition (`is_assignee`/`role_in`/`group_member`) is correctly hidden
  from a requestor. `transition()` is unchanged — the portal reuses the single choke-point verbatim.
- **Config UI:** the per-transition **Configure** dialog (`TransitionNoteDialog` in
  `components/settings/workflow-editor.tsx`, now titled "Transition settings — …") gained an **Allowed from
  portal** checkbox (independent of the note config); rows show a green **`portal`** badge.
- **Seed:** both **Reopen** transitions are seeded `portal_allowed=True` (re-asserted each `seed_itsm`,
  same override semantics as `note_*`). The **Request** workflow had no reopen before — `("Reopen",
  "fulfilled" → "in_progress")` was added to mirror the Incident one. Both Reopen now carry `REOPEN_NOTE`
  (`note_prompt=True`, `note_required=False`, heading "Reason to reopen") so reopen optionally captures a
  reason (public comment) without forcing one.
- **Portal endpoints** (under `itsm.portal.tickets`, `apps/itsm_tickets/portal.py`): `available-transitions`
  (GET, `portal_only=True`) + `transition` (POST `{transition_id, comment?}`, rejects non-`portal_allowed`
  with 404, forces a public comment). See itsm-helpdesks for the full portal detail.
- **ReopenRule note:** the 14-day window/`requires_comment` `ReopenRule` is **not** enforced by the engine
  (it never was) — portal reopen is gated only by `portal_allowed` + `from_status` match + `note_required`.
  Make a reopen reason mandatory by setting the transition's `note_required` in the Configure dialog.

## Backend app path
`backend/apps/itsm_workflows/`

## Key concepts
- **`StatusCategory`** — the fixed three: To Do / In Progress / **Done**. Drives queue grouping,
  reopen detection, and "open vs closed" everywhere.
- **`Status`** — a node in one workflow; `is_initial`, `category`, `pauses_sla` (Exclude from SLA —
  pauses all running clocks while a ticket sits here), `canvas_x/y` for the builder.
  Unique `(workflow, key)`.
- **`Transition`** — an edge `from_status → to_status` (`from_status=null` = the "create"
  transition); `is_global` = available from any status; `post_functions` JSON `[{type, config}]`;
  optional `screen` (mandatory fields) and `auto_assign_rule`.
- **Transition note prompt** — four `Transition` fields (`note_prompt`, `note_required`,
  `note_heading`, `note_visibility` = public|private) make a transition open a slide-over asking
  for a note on movement (e.g. Resolve → "Resolution Note", Put on Hold → "Reason to hold"). The
  captured note is posted as a **comment** (public/internal per `note_visibility`) via the existing
  `tickets/{id}/transition/` `comment`/`comment_visibility` flow — it is **not** written to the
  `resolution` field. `_validate()` in the engine rejects a mandatory note left blank (422). Seeded
  ON by default on **Resolve** (Incident) / **Fulfil** (Request) → "Resolution Note" and **Put on
  Hold** → "Reason to hold"; edit/disable per-transition in the Workflow settings tab.
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
