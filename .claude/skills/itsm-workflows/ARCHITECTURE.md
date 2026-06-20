# itsm-workflows — Architecture

## Layout
```
itsm_workflows/
  models.py            # StatusCategory, Workflow, Status, Transition, TransitionCondition,
                       # TransitionScreen(+Field), AutoAssignmentRule, ReopenRule
  services/engine.py   # transition(), available_transitions(), guards/validators/post-functions
  validators.py        # validate_workflow_graph()
  views.py             # 7 ViewSets (+ graph/validate)
  urls.py
  seed.py              # default Incident + Request workflows
```

## The transition pipeline (`engine.transition`)
`@transaction.atomic`, then **re-fetch the ticket with `select_for_update`** (the concurrency
lock). Ordered stages:
1. **resolve & assert** — unless `is_global`, require `transition.from_status == ticket.status`;
   otherwise raise `TransitionError(409)` ("already moved; refresh and retry") — the stale-button
   guard.
2. **conditions** — `evaluate_conditions` runs every `TransitionCondition`; any failure → `403`.
   Guards are read-only: `role_in` (via `get_user_role`, superuser passes), `is_assignee`,
   `group_member` (active membership of the assigned group), `field_equals` (attribute compare),
   each honoring `negate`.
3. **validators** — `_validate` collects ALL missing mandatory transition-screen fields → `422`
   with a `{field_key: [msg]}` errors dict.
4. **apply status** — set `ticket.status = to_status`; detect **reopen** (from Done → not-Done) and
   bump `reopen_count`.
5. **post-functions in canonical order** — `_PF_ORDER` sorts them so authors can't foot-gun
   ordering: assignment (auto_assign/set/clear) → priority → resolution set/clear → timestamp
   stamps → SLA ops → emit_event. Mutating PFs run now; **SLA/emit PFs are deferred** to
   post-commit (collected in `sla_ops`).
6. **persist** — `save(update_fields=[...])` (only the columns the engine can touch).
7. **post-commit** (`transaction.on_commit`) — `log_event("status_changed")` (+ `closed`/
   `reopened`), `hooks.sla_on_status_change`, run the deferred SLA ops via hooks, and
   `hooks.emit_event("StatusChanged", ...)`.

## Design decisions
- **One choke-point.** Nothing changes `Ticket.status` except `engine.transition`. The ticket
  ViewSet's `transition` action and the (future) reopen action both route through it.
- **Lock-then-act.** The re-fetch under `select_for_update` means two concurrent transitions on the
  same ticket serialize; the stale-`from_status` check then rejects the loser with 409.
- **Side-effects after commit only.** SLA clock ops and notifications run in `on_commit`, so a
  rolled-back transition never pauses a clock or emails anyone.
- **Post-functions are JSON the builder writes.** `Transition.post_functions` is
  `[{type, config}]`; the visual builder persists them. Built-ins: `auto_assign`, `set_assignee`,
  `clear_assignee`, `set_priority`, `set_resolution`, `clear_resolution`, `stamp_timestamp`
  (whitelisted to `assigned_at/resolved_at/closed_at/first_responded_at`), `start/stop/pause/
  resume_sla`, `emit_event`.
- **Conditions/validators are data too.** `TransitionCondition` rows + `TransitionScreen.fields`
  are config, dispatched by `condition_type` / mandatory flag — no per-workflow code.
- **Builder round-trip.** Statuses carry `canvas_x/y`; `WorkflowViewSet.graph` returns the
  node/edge graph; `validate` runs `validate_workflow_graph`. Copy-on-publish versioning
  (`Workflow.version`) keeps live tickets off edited drafts (the Ticket snapshots its workflow).
- **Reopen = a normal transition** from a Done status back to an active one, with
  `clear_resolution` + a `stamp_timestamp` PF; the engine auto-detects it (Done→not-Done) and
  increments `reopen_count` + logs `reopened`.

## Graph validator (`validators.validate_workflow_graph`)
Errors (block publish): not exactly one initial status; no create transition (`from_status=null`);
no Done-category status. Warnings: unreachable statuses (BFS from initials + create targets,
treating globals as edges from every status); duplicate `(from, to, name)` edges. Returns
`{valid, errors, warnings}`.

## Seeded workflows
- **Incident:** New → Assigned → In Progress ⇄ Pending → Resolved → Closed (+ Reopen
  Resolved→In Progress). Pending pauses SLA; Resume resumes; Resolve stops SLA + stamps
  `resolved_at`; Assign auto-assigns round-robin + stamps `assigned_at`.
- **Request:** New → Approved → In Progress → Fulfilled → Closed. Start Fulfilment auto-assigns;
  Fulfil stamps `resolved_at` + stops SLA.
