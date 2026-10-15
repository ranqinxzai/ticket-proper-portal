# itsm-workflows

## Update (2026-10-14) — Request **Fulfil** captures the shared `resolution_notes`
Capture fields on the Request workflow's **Fulfil** (or any request close) transition should reference
the global column-backed **`resolution_notes`**, which now applies to `service_request` projects
(itsm-fields 2026-10-14, `itsm_core/0012`). Don't use a per-project custom note field. The engine
writes it via `_apply_screen_columns` → `Ticket.resolution_notes`, the same column Incident **Resolve**
uses, so the Ticket Data report has one notes column. GridCrest's Default Request Workflow Fulfil
screen was repointed `resolution_note` → `resolution_notes` (mandatory kept) by a one-off script.
Workflows are shared, so that one screen-field row serves REQ, HRREQ and FACREQ. A screen key whose
def doesn't exist in a project still renders (raw key as label, text input), which is how the old
REQ-only key "worked" on HRREQ/FACREQ.

## Update (2026-07-24) — Default **Problem** Workflow (ITIL problem/error control)
- **`Workflow.base_type` gained `"problem"`** (migration `0008_workflow_base_type_problem`;
  `starter._VALID_BASE_TYPES` too, so a Problem project's "+ New" starter keeps its base_type).
- **Third seeded graph** (`WORKFLOWS` += `("Default Problem Workflow", "problem",
  PROBLEM_STATUSES, PROBLEM_TRANSITIONS)`) — JSM's default problem skeleton minus "Under Review",
  plus an explicit **Known Error** status (JSM models known-error as a resolution; SN as a flag):
  `new` (todo, initial) → `under_investigation` ↔ `pending` → `known_error` (in_progress, violet) →
  `resolved` → `closed`. Transitions: Create · Start Investigation (auto_assign round_robin + stamp
  assigned_at) · Put on Hold/Resume (pause/resume_sla + HOLD_NOTE) · **Record Known Error** ·
  **Re-analyze** (known_error → under_investigation, SN parity) · Resolve / **Implement Fix** (both →
  resolved with the incident-style resolve post-functions + RESOLUTION_NOTE) · Close · Reopen
  (→ under_investigation; `clear_resolution` now takes a **`config.preserve`** list — the Problem
  Reopen preserves `root_cause` + `workaround_provided` (captured at Record Known Error, not at
  resolve time) while clearing resolution_code/notes; `workaround_notes` is untouched by
  clear_resolution — the whole KEDB payload survives a reopen). No Canceled status by design (resolution codes Won't Fix / Risk
  Accepted cover it — options added to the shared `resolution_code` def, see itsm-fields).
- **Capture screens** (`ensure_problem_screens`): **"Root Cause & Workaround"** on Record Known Error —
  `root_cause` **mandatory** (a problem can't become a Known Error without a documented root cause),
  `workaround_notes` + `workaround_provided` optional; the shared **"Resolution Details"** screen is
  attached to BOTH Resolve and Implement Fix (`ensure_resolution_screen` is now generic — calling it
  per-transition attaches the same per-workflow screen). Values persist via the engine's generic
  `_apply_screen_columns` (`maps_to` → Ticket columns) — **no engine change**.
- **`portal_allowed` is now spec-driven**: the seed loop sets it for Reopen only when the workflow's
  base_type is in `PORTAL_REOPEN_BASE_TYPES = {"incident","service_request"}` — the Problem Reopen is
  **not** portal-invokable (problems are agent-only; they never surface on the portal anyway).
- **`run()` refactored** into `_ensure_categories()` + `_seed_workflow(cats, …)`; new
  **`ensure_problem_workflow()`** = idempotent problem-graph seeder, called by `run()` and **lazily by
  the standard-project import service** (`itsm_projects.standard_projects._default_workflow_for`) — a
  tenant provisioned before Problem Management self-heals on first import, so **no data migration**.
- Tests: `ProblemWorkflowSeedTests` (graph validity, screens, portal gating, 422 on missing root
  cause, column persistence, reopen semantics, self-heal, starter base_type).

## Update (2026-07-13) — create a NEW workflow from scratch (Workflow tab / Overview "+ New")
- **Problem:** workflow is linked per-**project** (`Project.default_workflow`; a `TicketType` has no
  workflow). The config UI could only *pick* a pre-seeded global workflow — there was **no way to
  create one**, so a project with no matching seed dead-ended ("No workflow assigned. Set a Default
  workflow in the Overview tab"). `workflowsApi.create` existed but was never called by any UI; and a
  bare `POST /workflows/` is useless anyway — it makes a flat record with **no statuses and no create
  transition**, so `validate_workflow_graph` fails and `ticket_service.create_ticket` raises
  `ValueError` (no `is_initial` status).
- **Backend:** new service `services/starter.py::create_starter_workflow(name, base_type="custom")`
  (`@transaction.atomic`, the single write choke-point — rule 4). Builds a minimal but **valid** graph:
  statuses **To Do** (`key=to_do`, initial) → **In Progress** → **Done** (reusing the seeded three
  `StatusCategory` rows, never creating categories) + transitions **Create** (`from_status=None`→To Do),
  **Start Progress**, **Done**. Runs `validate_workflow_graph` as a safety net (raises `ValueError` if
  invalid). `is_default=False`/`version=1`, so it stays project-specific (seed's `base_type+is_default`
  lookup won't hand it to other projects). Exposed via a **list** action
  `WorkflowViewSet.create_starter` (`POST /workflows/create_starter/ {name, base_type?}`) — POST ⇒ the
  `create` CRUD action, gated by the existing `itsm.workflows` create permission; returns the new
  workflow (201). **No new model, no migration.** The action only *creates*; **linking is a separate
  write** (`projectsApi.update({default_workflow})`) so it stays behind `itsm.projects` update.
- **Frontend:** shared `components/settings/create-workflow-dialog.tsx` (`CreateWorkflowDialog`, module
  scope — no focus-loss) calls `workflowsApi.createStarter` then `onCreated(wf)`.
  - **Workflow tab** (`workflow-editor.tsx`) empty state replaced with a card + **"Create workflow"**
    button → on create, `projectsApi.update(project.id, {default_workflow: wf.id})` + `useWorkspace().refresh()`
    so the editor re-renders into the new graph. Button shown only when the user has **both**
    `itsm.workflows:update` (existing `canEdit`) **and** `itsm.projects:update` (new `canLinkProject`
    prop from the settings page); lower-privilege users still see guidance text.
  - **Overview tab** (`project-overview-tab.tsx`) — a **"+ New"** button beside the Default-workflow
    `<Select>` opens the same dialog; on create it appends the workflow to the dropdown and selects it
    (the user then clicks **Save changes** to persist the link, matching the tab's form model).
- **Decision:** the starter is a **minimal blank** graph (not a clone of a seeded template) — the admin
  builds it up in the Workflow tab.
- Tests: `apps/itsm_workflows/tests.py` (`CreateStarterWorkflowTests` — valid graph, blank-name 400,
  base_type coercion, ticket-create usability, RBAC 403).

## Update (2026-07-03) — status/workflow re-point + approval handling on a project move
`ticket_service.move_ticket` (see **itsm-tickets**) re-points `workflow` → the target project's
`default_workflow` and sets `status` **directly** (not via `engine.transition`). A normal move lands
on the target status in the **same `StatusCategory`** as the current one (agent-overridable,
auto-suggested by `move-options`); it must **not** bump `reopen_count`, and it clears/keeps
`resolved_at`/`closed_at` to stay consistent with the landing category (so a resolved ticket doesn't
silently reopen). A ticket with a **pending approval** is **not** frozen out of a move: the move
allows it, cancels the pending `ApprovalRequest` (new `itsm_approvals.services.engine.cancel_pending`,
using the existing `ApprovalRequest.Status.CANCELLED`), and lands the ticket on the target workflow's
**initial** status — otherwise `engine.has_pending_approval` would freeze it in the new project.

## Purpose
The ticket lifecycle engine. A `Workflow` is a graph of `Status` nodes and `Transition`
edges; the execution engine (`services/engine.py`) is the single choke-point for every
status change, running an ordered pipeline of conditions → validators → status apply →
post-functions → post-commit side-effects. The models also power the visual builder
(statuses = nodes with canvas x/y, transitions = edges) and an admin-time graph validator.

## Update (2026-07-02) — admin-configurable transition capture fields (any transition)
- Any transition can now carry a **capture screen** configured **in the workflow editor** (not just
  the seeded Incident Resolve). The **Transition settings** dialog (`TransitionNoteDialog` in
  `components/settings/workflow-editor.tsx`) gained a **"Capture fields on this transition"** section:
  pick fields from the **project field catalog** (`fieldsApi.list(project.id)`), mark each
  **Mandatory / Optional**, reorder, remove. Supported types today: **text, multiline, number, date,
  dropdown, radio, checkbox** (`SCREEN_FIELD_TYPES`); cascade / multiselect / user·group_picker /
  richtext / attachment are hidden from the picker (deferred). List rows show an **`N fields`** badge.
- **Write path = the existing `PATCH /transitions/{id}/`** (no new endpoint, no new model, **no
  migration**). `TransitionSerializer` gained a writable **`screen_fields`** =
  `[{field_key, is_mandatory, sort_order}]`, mirroring the `requires_approval` precedent: `create`/
  `update` call **`_sync_screen`**, which `get_or_create`s a `TransitionScreen` for the transition
  (`name = "<transition> fields"`), **replaces** its `TransitionScreenField` rows, and an **empty list
  detaches** (soft-deletes a screen no other transition uses). Read is injected in
  `to_representation` (raw `[{field_key,is_mandatory,sort_order}]`, ordered) — the config UI joins it
  to the catalog for names/types; `validate_screen_fields` rejects a `field_key` that isn't a live
  `FieldDefinition` (400). `TransitionViewSet` prefetches `screen__fields`.
- **Generic persistence in the engine** so an arbitrary captured field is actually saved (previously
  only the fixed ITIL resolution columns persisted). After post-functions, `transition()`:
  **`_apply_screen_columns`** writes column-backed (`config.maps_to`) screen fields to their **Ticket
  column** (added to the save `update_fields`), and **`_persist_screen_values`** writes value-backed
  custom fields via **`field_service.set_values`** (→ a `FieldValue` row + `field_changed` audit;
  `set_values` skips `maps_to`/attachment itself). Only non-empty provided values are written (a
  partial screen never blanks a field), and it is **idempotent with `set_resolution_details`** (both
  write identical values from the same `fields`) so the seeded Incident Resolve is unchanged.
  `_validate` (unchanged) already enforced mandatory screen fields generically → **422**.
- **Runtime unchanged** except a **`date`** case added to `ScreenFieldControl` (ticket-detail.tsx);
  the resolve slide-over already rendered `screen_fields` (from `available-transitions`) and blocks
  submit on an empty mandatory field.
- **Correction to earlier docs:** prior notes implied a `transition-screen-fields` API / Configure
  dialog already existed — it did **not**; this is the build that adds screen-field config (via the
  transition serializer, not a separate endpoint). `TransitionScreenSerializer` still exposes only
  `id/workflow/name` (screens are managed through the transition).
- Tests: `apps/itsm_workflows/tests.py` (`TransitionScreenConfigTests` — serializer sync + engine
  value/column persistence + mandatory 422). Reuse: [[itsm-fields]] catalog (`FieldDefinition`/
  `FieldOption`/`FieldValue`, `field_service`).

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
