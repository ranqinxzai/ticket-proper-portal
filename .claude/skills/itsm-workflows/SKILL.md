# itsm-workflows

## Update (2026-11-05c) — Capture fields obey the layout rule; approval "Pause SLA while waiting"
- **Capture-screen rules:** a `TransitionScreenField` follows its field's `FieldLayoutItem.visibility_rule` on the TICKET's
  layout (`field_service.get_layout(project, ticket_type)`; workflows are shared, the rule is per project).
  `engine.screen_layout_rules` reads it (layout `is_hidden` ignored — being on the screen is explicit);
  `_screen_rule_states(transition, ticket, fields)` evaluates it once with `visibility_state` against the submitted value
  (even empty) else the ticket's current one (`_fc_effective_value`), `status` = target status. `_validate(..., rule_states)`
  skips hidden / readonly mandatory fields; `transition()` drops their submitted values (stored values kept).
  `available-transitions` returns `visibility_rule` per screen field. GridCrest: Put on Hold → Reason only when Pending
  Reason = other. Tests `ScreenFieldLayoutRuleTests`.
- **Approval policy `pause_sla`** (`itsm_approvals 0005`): `ApprovalWorkflow.pause_sla` (switch on the Approval tab card) is
  copied onto `ApprovalRequest.pause_sla` at `start_approval` (rule 10). Post-commit `hooks.sla_sync_pauses(ticket)` runs after
  start (when set), after `decide` (once not pending, after `move_to_rejected`), in `cancel_pending` and `send.withdraw`.
  Applies to every start path (transition, create transition, catalog, admin start, Send for approval). See itsm-sla.

## Update (2026-10-29) — Approvals on deleted tickets
- Deleting a ticket cancels its pending requests (`ticket_service.delete_ticket` → `approval_engine.cancel_pending`). The `ApprovalCancelled` mail is suppressed (deleted tickets are silent).
- `engine.pending_for` (inbox + badge) and `ApprovalRequestViewSet.queryset` filter `ticket__is_deleted=False`, so approve/reject/withdraw on a deleted ticket's request → 404.
- `itsm_tickets/0013` cancels requests still pending on tickets deleted before the fix (no mail).

## Update (2026-10-24) — Send for approval + On-fly approvers (approvals)
User request: agents ask for sign-off mid-ticket (e.g. water damage → the requestor's manager approves a replacement). Decisions:
- the ticket waits in a configured status and comes back when decided;
- SLA follows the status;
- the drawer offers every active policy of the project;
- v1 has a message to the approver and Withdraw.
- **Status flag** (`itsm_workflows/0010`):
  - `Status.allows_send_for_approval` + `Status.approval_waiting_status` (FK self, null = stay put).
  - `StatusSerializer.validate`: not on a Done status. The waiting status must be another live, non-Done status of the same workflow. Flag off clears it.
  - `StatusViewSet.perform_destroy` refuses deleting a waiting target.
  - `validators` count source↔waiting as edges (no "Unreachable" warning).
  - `cloner` copies the flag and remaps the FK in a second pass.
- **`engine.move_for_approval(ticket, to_status, user, *, label)`** is the ONLY status write besides `transition()`, and only `itsm_approvals` calls it.
  - It's a system move: no conditions, screens, field conditions or post-functions, and it ignores the pending freeze.
  - It refuses a deleted status, another workflow's status, or a Done target.
  - Its post-commit effects are `_status_change_effects`, extracted verbatim from `transition()` step 7: audit `status_changed` (payload `transition` = the label), `hooks.sla_on_status_change` (so `pauses_sla` on the waiting status pauses the clocks), survey, StatusChanged/Resolved/Closed emit, `automation_dispatch`.
- **On fly** (`itsm_approvals/0004`):
  - `ApprovalStage.approver_type="on_the_fly"` + `on_fly_pool` (`any_user` | `group` → `approver_group` | `listed_users` → M2M `candidate_users`).
  - The agent's picks are stored per request in **`ApprovalRequestApprover`** (`approval_request`, `stage`, `user`; live-unique).
  - `resolve_approver_ids(stage, ticket, req=None)` / `stage_problem(stage, ticket=None, req=None)` resolve On fly from `req`. Without it: nobody, plus a pool check only.
  - Every in-engine caller passes `req` (`_stage_satisfied`, `eligible_stages`, `_waiting_ids`, `blocked_reason`, `decide`). `pending_for` ORs `picked_approvers__user`, so the inbox, portal "View request" access and `pending_approver_users` (the ApprovalRequested recipients) just work.
  - `pool_user_ids(stage)` returns None for any user. It excludes inactive users and system bots.
- **Starting an On-fly policy needs picks.** `ensure_startable(ticket, wf, picks=None)` → `_picks_problem`.
  - `picks=None` (transition / catalog / admin `start`) → 400 "…can only be started with Send for approval". The whole transition rolls back (rule 17).
  - With picks, each pick must exist, be active, not be a bot, be in the pool, and number ≥ `min_approvals` (rule any).
  - `normalise_picks` → `{str: [int]}`, 400 on junk.
  - Editor-side refusals:
    - `ApprovalStageSerializer` (`_validate_on_fly`, plus `engine.policy_start_sites`: transitions whose `request_approval` names it, catalog items);
    - `TransitionSerializer.validate_post_functions`;
    - `CatalogItemSerializer.validate`.
- **Sent requests** (`ApprovalRequest.source="sent"` vs `"policy"`; plus `note`, `return_status`, `waiting_status`):
  - `services/send.py` is the single write site.
  - `send_options(ticket, user)` → `{allowed, reason, status, waiting_status, workflows[{id,name,mode,problem,stages[{…, approver_names|candidates, on_fly_pool, pool_label}]}]}` (project's active policies only; candidates capped at 500, null = any user).
  - `send_for_approval` locks the ticket (`of=("self",)`), then refuses:
    - flag off → 400;
    - already pending → 409;
    - another project's policy → 400;
    - note > 2000 → 400.

    It then calls `start_approval(..., source="sent", note, return_status)` and `move_for_approval` into the waiting status, all in one transaction. On-commit order: approval audit + ApprovalRequested, then status change.
  - `decide`: a final approve or reject on a sent request calls `return_from_waiting` (registered after `_after`), but only when the ticket still sits in `waiting_status` and `return_status` is live. A rejected sent request never runs `move_to_rejected`.
  - `withdraw(req, user, reason)`:
    - pending + sent only (policy → 400, a gate bypass otherwise);
    - `can_withdraw` = the sender, `itsm.approvals.send` delete, or a superuser;
    - Cancelled + `approval_cancelled` audit `{workflow, withdrawn: true, reason}` + `ApprovalCancelled` + return.
  - **Gates unchanged:** `approval_granted` / `approval_rejected` still read the latest non-cancelled request of either source.
- **API** (`ApprovalRequestViewSet`; module `itsm.approvals.send` per action; 404 on an inaccessible ticket):
  - `GET approval-requests/send-options/?ticket=`
  - `POST approval-requests/send/` `{ticket, workflow, approvers:{stage_id:[user_id]}, note}` → 201
  - `POST approval-requests/{id}/withdraw/` `{reason?}`

  The request serializer adds `source`, `note`, `requested_by_name`, `return_status_name`, `waiting_status_name` and viewer-specific `can_withdraw`. RBAC module: see itsm-rbac.
- **UI:**
  - **Settings:**
    - `approval-editor.tsx`: On-fly type, Pick-from select, listed-users chips, "Send for approval only" badge.
    - `workflow-editor.tsx`: `StatusSettingsDialog` checkbox + "While waiting, move to", "send for approval → X" badge, `ApprovalWorkflowItem` disables On-fly policies in both Start-approval selects.
  - **Ticket:** `components/approvals/send-for-approval-sheet.tsx` and `withdraw-approval-dialog.tsx`; `approval-panel.tsx` (sender, message, waiting→return line, Withdraw); `approval-inbox.tsx` (sender + message).
  - **Copy:** `WORKFLOW_HELP.sendForApproval/waitingStatus/sendBadge/onFlyNotHere`, `APPROVAL_HELP.onFly*`/`sendSetup`, `APPROVER_TYPE_HELP.on_the_fly`, `TICKET_HELP.send*`/`withdraw`.
- Tests: `itsm_approvals/tests.py` (`OnFlyStageConfigTests`, `SendForApprovalTests`, `SentDecisionTests`, `WithdrawTests`), `itsm_workflows/tests.py` (`SendForApprovalStatusTests`). QA: `docs/QA_CHECKLIST.md` "Send for approval + On-fly approvers (added 2026-10-24)".
- **Open:** withdraw doesn't notify the picked approvers (the seeded `ApprovalCancelled` rule is off and targets requestor + assignee). Their inbox row disappears at once. No In-place stage edit yet: to change a pool, delete and re-add the stage.

## Update (2026-10-19) — Approvals inbox "View request" (N17); status option aliases (N18)
- `approval-inbox.tsx`: every row gets an explicit ghost button beside Approve/Reject, linking to the same `ticketHref` as the ticket number:
  - "View request" (portal surface) opens the read-only portal request page approvers may open;
  - "Open ticket" (agent surface) opens the agent detail page.
  - Hover help comes from `VIEW_HELP`. The mono number link stays.
- `filter_fields.status_options_for_project`: each deduped-by-key status option now also returns `aliases` (other same-key ids across the project's workflows, e.g. after "Make a copy"). The client uses them to label and tick old saved filters. The WS3 lineage test asserts it.

## Update (2026-10-18) — Bug-fix batch: create transition, field conditions, `blocked_reason`, usage/clone, Rejected status, approvals
- **The create transition runs (B14).**
  - Semantics: `from_status=None` + `is_global=False` is the create transition; `is_global=True` means "from any status" (`from_status` ignored).
  - `engine.create_transition_for(workflow)` and `start_status_for(workflow)` return the create target, else `is_initial` / lowest sort. `create_ticket` and the move helper both start there.
  - `apply_create_transition` runs only the SAFE post-functions on the unsaved ticket: fill-only assign and stamps.
  - `begin_create_approvals` starts its `request_approval` inside the create transaction (a refusal → 400). `run_create_deferred` emits post-commit.
- **Engine guards (B14):**
  - Running the create transition on an existing ticket → 400.
  - A transition into a deleted status → 400.
  - A non-global null-from transition is never offered.
  - The validator returns errors + warnings. The serializer 400s a second create transition or a create into Done.
  - Editor: From is required; "Any status (global)"; "never runs" badge.
- **Field conditions (B17a/b).** A rule on a field the project doesn't have is skipped (`_applicable_field_defs`, `applicable_only`). A cascade rule needs a **leaf** value (fail-open on unknown values).
- **`auto_assign` never overwrites an assignee (B17c, all orgs).** It goes through `itsm_groups.services.pick_assignee_if_unassigned`, and the round-robin cursor moves only when it actually picks. `transition(preserve_assignee=)` is now redundant for this.
- **`blocked_reason` (U4).**
  - `engine.blocked_reasons(ticket, transitions)` → `{transition.id: message}` for field conditions failing on current values. It skips the transition's own capture-screen fields.
  - `available-transitions` rows carry `blocked_reason`; the button renders disabled with a `Hint`.
  - `TransitionSerializer` adds `to_status_name`, `to_status_category` and `from_status_name`. The graph adds `is_default`.
- **Usage / clone (U6).**
  - `GET workflows/{id}/usage/` → `{project_count, projects[], hidden_count, is_default, base_type}`.
  - `POST workflows/{id}/clone/` `{project?, name?}` → 201 workflow + `automation: {repointed, unmatched}` (`services/cloner.clone_workflow`).
  - Linking needs `itsm.projects:update`. Open tickets keep their snapshot (rule 10).
  - Editor: "Shared by N projects" banner, "Make a copy for this project", auto-assign badge.
- **Status delete (C5/U1).** `StatusViewSet` refuses deleting an in-use or start status (400). A delete soft-deletes the status's transitions. Status and transition deletes now confirm.
- **Priority (C7).** The `set_priority` post-function and a screen priority field log `priority_changed` and call `hooks.sla_priority_changed`.
- **Rejected status** (migration `0009_request_rejected_status` + `seed.ensure_reject_gate`):
  - Every default `service_request` workflow gets status `rejected` ("Rejected", `#dc2626`, done).
  - It also gets a **Reject** transition New → Rejected (stop resolution SLA + stamp `closed_at`), gated by the new condition **`approval_rejected`**: the latest non-cancelled approval request is rejected.
  - Skipped when any `rejected` key already exists or there is no live `new`.
  - `rejected` is terminal like `closed`: the engine emits **Closed** + the closed audit. Notifications remap it to `StatusChanged` (itsm-notifications). No CSAT.
- **Status filter:** `filter_fields.status_options_for_project` (union over the workflows in use) + `query_builder` `status_lineage_ids` (a copy's statuses match their originals).

### Approvals (`itsm_approvals`; there is no separate approvals skill)
- **Start inside the write (B1).**
  - `hooks.begin_approval(ticket, workflow, user=)` is the **one non-swallowing hook**. `engine.transition` (step 6d) and create call it inside their transaction.
  - `approval engine.ensure_startable` / `stage_problem(stage, ticket=None)` raise `ApprovalStartError`, a 400 `TransitionError`. The whole status change rolls back.
  - A missing, deleted or **inactive** policy starts nothing.
- **Stage validation (B1).** `ApprovalStageSerializer.validate`: target set and active; `min_approvals` satisfiable; live-level unique (`level` optional → max+1). "Requestor's manager" can carry a fallback `approver_user`.
- **Gate (B2).** `approval_granted` passes only when the LATEST non-cancelled request is approved, or there is none. A rejection keeps it blocked.
- **Parallel (B3).**
  - `ApprovalRequest.mode` + `stage_ids` are snapshotted at start (migration `itsm_approvals/0003`). In parallel mode all stages are pending at once, and one click counts for every stage the user is eligible for.
  - Conditional unique `uniq_approval_workflow_live_level` (`is_deleted=False`).
  - A superuser's approval completes the stage; superusers see the buttons only when nobody else can decide.
- **Viewer state (U2/U7).**
  - `engine.request_state(req, user)` → `pending_stages[]` (approver label, names, count), `can_decide` and `blocked_reason`. The serializer also returns `mode`, ticket keys, `approver_*_name` and `approver_problem`.
  - A stage that breaks after start: approve is refused atomically; reject still works.
- **Reject (U3).** A reason is required (`comment`, API 400). On commit, `engine.move_to_rejected` runs the workflow's transition into `rejected` as `automation-bot`, with the reason as the comment. Refusals are logged, never raised.
- **Access.**
  - A1: `start` needs `itsm.approvals` create + project access.
  - A2: list/retrieve are clamped to accessible helpdesks/projects + own tickets + requests you approve.
  - `my-pending` / approve / reject use `CanUseApprovalInbox` (`itsm.portal.approvals` read; role-less users exempt).
- **Events (G4).** `ApprovalRequested` per newly pending stage (context `approval_request` + `stage`), plus `ApprovalGranted` / `Rejected` / `Cancelled`. `pending_approver_users(ticket, stage=None)` resolves the recipients. Audit actions `approval_requested` / `approved` / `rejected` go via `log_event`.
- **Catalog (B4).** `CatalogItemSerializer.validate`. `raise_from_catalog` refuses a missing or inactive workflow before creating, then starts the approval in the same transaction.
- **UI.**
  - `components/approvals/approval-text.ts`, `reject-approval-dialog.tsx`, inbox number links.
  - Editor: Mode select + Active switch + "No approver" badge.
  - Confirms on workflow and stage delete.
- **Open:** no in-place stage edit; an actor who is also the next approver isn't notified.
- Supersedes:
  - the 2026-10-18 hover-help bullets "(create) never runs", "Require approval passes after a rejection" and "`transition()` accepts a `from_status=None` transition from any status"
  - the 2026-06-28 note "the gate is inert … passes when none is pending" (it now also blocks after a rejection)
  - the 2026-07-03 "lands on the target workflow's **initial** status" (now `start_status_for`)
- Batch context: `docs/BUG_LOG.md` "2026-10-18 — Bug-fix batch"; QA: `docs/QA_CHECKLIST.md` "Bug-fix batch (added 2026-10-18)".

## Update (2026-10-18b) — `transition(preserve_assignee=)` + `status_changed` automation trigger
- **`engine.transition(ticket, tr, user, fields=None, comment=None, *, preserve_assignee=False)`**: when True and the ticket already has an assignee, the `auto_assign` post-function is **skipped**.
  - Automation's transition action passes its `keep_assignee` flag (default on), so running the seeded **Assign** (round-robin) keeps the agent who was just picked.
  - Manual clicks keep the default, so behaviour is unchanged.
- **`_after_commit`** now ends with `hooks.automation_dispatch("status_changed", locked, actor=user, from_status=, to_status=)`.
- Automation runs transitions as `automation-bot` through this same choke-point, so **every guard applies**: approval freeze, `TransitionCondition`s, field conditions, mandatory screen fields.
  - Role / group / assignee conditions evaluate against the bot, which has no role or group, so a `role_in`/`group_member`-guarded transition will fail from automation.
  - A failed transition is a failed `AutomationRun` with the engine's message.
- The "(create)" transition (`from_status=null`, not global) is rejected as an automation action.
- See **itsm-automation**.

## Update (2026-10-18) — Workflow editor hover help (and what it revealed)
- **`WORKFLOW_HELP`** (`lib/itsm/help/settings.ts`) covers:
  - every badge: initial, global, portal, note */required, N fields, N rules, starts/needs approval, SLA paused, (create)
  - the Validate checks
  - Category effects
  - Exclude from SLA
  - Note type
  - the warning "Workflows are shared — edits apply to every project using it"
- **Deletes and removes:** status and transition deletes are `IconButton`s saying "Deletes immediately". Capture-field and condition removes say "Takes effect when you click Save".
- **Behaviour the copy now states truthfully (open, BUG_LOG 2026-10-18):**
  - The "(create)" transition never runs.
  - "Require approval" passes after a rejection, so it adds nothing beyond the pending-approval freeze.
  - `transition()` accepts a `from_status=None` transition from any status.
  - `ReopenRule.window_days` is unenforced.
- Primitives: `ui/hint.tsx` (`Hint`), `ui/icon-button.tsx` (`IconButton`), `ui/info-tip.tsx` (`InfoTip`); copy in `lib/itsm/help/*`. Rules + verification: `docs/QA_CHECKLIST.md` "Hover help / tooltips (2026-10-18)". Behaviour mismatches found (not fixed) are listed in `docs/BUG_LOG.md` 2026-10-18 — tooltips describe the REAL behaviour.

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
