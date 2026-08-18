# itsm-workflows — Bug Log / Gotchas

- **A bare `POST /workflows/` yields an INVALID, UNUSABLE workflow.** The flat serializer creates
  only name/base_type/flags — **no statuses, no create transition** — so `validate_workflow_graph`
  fails and `ticket_service.create_ticket` raises `ValueError` ("no initial status"). To create a
  workflow from the UI/API, use **`POST /workflows/create_starter/`** (2026-07-13), which builds a
  minimal valid To Do → In Progress → Done graph. Then link it via `PATCH /projects/{id}/`.
- **Creating a workflow ≠ linking it.** `create_starter` only creates (gated by `itsm.workflows`
  create). Linking to a project is a separate `projectsApi.update({default_workflow})` write gated by
  `itsm.projects` update — the "Create workflow" button requires BOTH perms. If create succeeds but
  link fails, an unlinked workflow lingers (selectable later via Overview → Default workflow).

- **`engine.transition` is the ONLY sanctioned status writer.** Don't set `ticket.status`
  anywhere else — you'd skip the lock, conditions, validators, reopen detection, audit log and
  SLA/notification side-effects.
- **Stale-button 409 is by design.** If `transition.from_status` no longer equals the (locked)
  ticket status, the engine raises 409. The frontend must refetch `available-transitions` and
  retry; don't treat 409 as a hard failure.
- **SLA + emit post-functions are deferred to `on_commit`.** `start/stop/pause/resume_sla` and
  `emit_event` listed in `post_functions` do NOT run inline — they're collected into `sla_ops` and
  fired via hooks after commit. Mutating PFs (assignee/priority/resolution/stamp) run inline.
- **Post-function order is forced by `_PF_ORDER`, not list order.** Authoring `set_resolution`
  before `auto_assign` in the JSON doesn't matter; the engine sorts. Unknown PF types sort last
  (order 99) and, if not a known mutator, are silently ignored.
- **`stamp_timestamp` is whitelisted.** Only `assigned_at/resolved_at/closed_at/
  first_responded_at` can be stamped. The seed's Reopen PF stamps `reopened_at`, which is **not**
  in `_STAMP_FIELDS` and is silently skipped (reopen is still detected and counted by the engine's
  Done→not-Done logic, so this is cosmetic — there is no `reopened_at` column on Ticket).
- **`field_equals` condition compares a Ticket attribute, not a custom FieldValue.**
  `getattr(ticket, cfg["field"])` — it works for first-class columns (e.g. `priority`), not for
  dynamic custom fields.
- **`available_transitions` filters by `workflow_id` + (from_status OR global) then runs
  conditions in Python.** Conditions are evaluated per-user, so the list is user-specific.
- **`save(update_fields=...)` is guarded by `hasattr`.** The engine only writes columns that exist
  on Ticket; a PF targeting a non-existent attribute won't persist.
- **Graph validator returns warnings, not just errors.** Unreachable statuses and duplicate edges
  are warnings (`valid` stays True). Only missing-initial / missing-create / no-Done are errors.
- **`role_in` lets superusers pass** regardless of configured roles (explicit
  `user.is_superuser` short-circuit).
