# itsm-automation

## Update (2026-10-31) — "Set field" covers every ticket-detail field
GridCrest (screenshots of INC Automation → Set field) couldn't pick "Users Affected".
- **Cause:** `catalog.SETTABLE_COLUMNS` was `{impact, urgency}`, so the other column-backed ITIL fields were watchable but never settable. `SETTABLE_CF_TYPES` also left out multiselect, cascade and group_picker.
- **User decision:** every ticket-detail field except Summary, Description and Requestor.

**Backend:**
- **`catalog.py`:**
  - `SETTABLE_COLUMNS = WATCHABLE_COLUMNS`: impact, urgency, users_affected, business_impact, root_cause, resolution_code, resolution_notes, workaround_notes, investigation_reason, service_downtime, workaround_provided, major_incident.
  - Column entries now carry `field_type`.
  - `SETTABLE_CF_TYPES` adds MULTISELECT, CASCADE and GROUP_PICKER.
  - Cascade entries carry `cascade: {levels, options:[{id, value, label, parent}]}`, this project's active nodes for the path picker.
- **`actions.py`:**
  - `SETTABLE_BUILTINS` maps each ITIL column to the `update_ticket` kwarg of the same name.
  - New **`clean_column_value(field, value)`** normalises like `TicketViewSet.update`:
    - text columns → str;
    - resolution_code / investigation_reason → blank or a valid choice;
    - users_affected → int ≥ 0 or None;
    - service_downtime / workaround_provided → nullable bool;
    - major_incident → bool.
  - The runner calls it again at run time. Impact/urgency still re-derive priority inside `update_ticket`.
- **`serializers._clean_set_field`** validates at save:
  - ITIL columns through `clean_column_value`;
  - multiselect: a non-empty list of this project's active option values (de-duplicated);
  - cascade: a non-empty parent→child path from the catalog tree;
  - group_picker: one live Group, stored as a str (`set_values` wraps it to `[id]`).
  - Option checks now use **this project's** field definition. Several projects share a key like `category`; the old dropdown check matched `field__key` across projects.

**Frontend** (`automation-editor.tsx` `SetFieldActionFields`):
- An ⓘ uses `AUTOMATION_HELP.setField`.
- **Controls by field type:**
  - multiline → textarea;
  - cascade → the shared **`components/tickets/cascade-select.tsx` `CascadeSelect`** (extracted from ticket-detail's `CascadeEdit`, which is now a thin wrapper);
  - group_picker → a single select over `optionsForField` (`options_source: "groups"`);
  - everything else uses `ConditionValue` / the checkbox, as before.
- Picking a boolean field starts the value at `false`, so "set to No" is complete without a click.
- `isEmptyValue` treats `[]` as missing.
- `describeValue`:
  - Yes/No for booleans;
  - "A › B" for a cascade;
  - joined labels for lists;
  - long text trimmed to 60 characters.
- Impact/Urgency show `AUTOMATION_HELP.setImpactUrgency`.
- **Help Center:** `admin-automation` lists what Set field can change.

**Verified:**
- 6 new tests, 28 in total:
  - `SetAnyFieldTests`: ITIL columns, a bad value fails the run, impact re-derives priority, multiselect/cascade/group values.
  - `ApiTests.test_catalog_lists_every_ticket_detail_field`.
  - `test_set_field_values_are_validated_and_normalised`.
- Playwright on the `gcb-*` stack: 19 options with Users Affected and the rest, a two-level cascade picker, and the summary "set Users Affected to 5". A real ticket got `users_affected=5`.
- **Pre-existing, not fixed:** axe `heading-order` in the rule dialog (an `h4` under the dialog `h2`).

## Update (2026-10-18) — Bug-fix batch: rules follow a workflow copy, `keep_assignee` redundant, rejections run as the bot
- **Workflow copy (U6).** `services/workflow_remap.repoint_project_rules(project, old_wf, new_wf)` re-points a project's transition actions when "Make a copy for this project" clones its workflow. The clone response reports `automation: {repointed, unmatched}`.
- **`keep_assignee` is now redundant.** The engine's `auto_assign` never overwrites an existing assignee (B17c, all orgs). The flag and `preserve_assignee=` stay for compatibility; the code comments say so.
- **Rejected requests.** `itsm_approvals.engine.move_to_rejected` runs the workflow's transition into `rejected` as **`automation-bot`** (`_system_actor()` → `get_automation_bot()`), with the reason as the comment. Because the actor is the bot, the dispatcher's loop guard means no automation rule fires on that status change.
- **`set_field` priority** goes through `update_ticket`, so it re-targets SLA clocks (`hooks.sla_priority_changed`).
- **Open:** after a clone, open tickets (still on the old workflow) miss status-specific automation.
- Batch context: `docs/BUG_LOG.md` "2026-10-18 — Bug-fix batch"; QA: `docs/QA_CHECKLIST.md` "Bug-fix batch (added 2026-10-18)".

## Purpose
Per-project **automation rules**: *When* (trigger) → *If* (conditions) → *Then* (actions). A rule fires
after a ticket write commits, checks a queue-style FilterSpec against the ticket, and runs up to five
actions through the existing service choke-points as the non-login **`automation-bot`** user.
Built 2026-10-18 (v1). Driving use case: *assignee set while the ticket is New → run the workflow's
Assign transition, keeping the agent who was picked.*

**Status: BUILT (v1)** in `backend/apps/itsm_automation/`: models, services, serializer, views, urls,
admin, migration `0001_initial`, and 22 tests. The frontend is the **Automation** tab in project settings.

## Backend app path
`backend/apps/itsm_automation/`. A TENANT app, registered last in `TENANT_APPS`.

## Key concepts
- **`AutomationRule`** (`BaseModel`, one row per rule, FK `project`)
  - Ordered by `order`, then `created_at`.
  - The behaviour lives in three JSON columns: `triggers`, `conditions`, `actions`.
  - `stop_processing` skips the rules after it once it runs successfully.
  - The list UI uses denormalised `last_run_at`, `run_count` and `failure_count`.
- **Triggers** (`[{type, config}]`; any one match fires the rule):
  - `ticket_created`: no config.
  - `ticket_updated`, `{fields: [...]}`. An empty list means any field.
    - Keys come from `catalog.field_catalog().update_fields`.
    - Built-in or column-backed fields use the Ticket **column name** (`assignee`, `assigned_group`, `priority`, `requestor`, `summary`, `description`, `impact`, …).
    - Value-backed custom fields use `cf:<key>`.
  - `status_changed`, `{from_status_ids, to_status_ids}`. Empty lists mean any status.
- **Conditions**: the **queue FilterSpec** `{match, conditions:[{field, op, value}]}`.
  - It is evaluated by `conditions.matches()` as `Ticket.objects.filter(pk=…).filter(query_builder.build_q(spec)).exists()`.
  - There is **no second evaluator**: every queue operator, custom field and `maps_to` column behaves identically to the queue.
  - An empty spec means always true.
- **Actions** (`[{type, config}]`, max 5, run in order, **all-or-nothing per rule**):
  - **`transition`** `{transition_id, keep_assignee}` calls `engine.transition(ticket, tr, bot, preserve_assignee=keep_assignee)`.
    - Every engine guard still applies: approval freeze, conditions, field conditions, mandatory screen fields.
    - It is **skipped** (not failed) in three cases: the ticket is already in the target status, it isn't in the transition's from-status, or the ticket's snapshot `workflow` differs from the transition's.
  - **`set_field`** `{field, value}`
    - `priority`, `impact`, `urgency`, `assignee` and `assigned_group` go through `ticket_service.update_ticket`, so the strict whitelist and membership checks apply.
    - A new group whose members don't include the current assignee **also clears the assignee**.
    - `cf:<key>` goes through `field_service.set_values`. A `maps_to` cf is redirected to its column.
  - **`add_comment`** `{body_html | canned_note_id, visibility}` calls `ticket_service.add_comment(author=bot, counts_as_response=False)`.
    - A public automated comment is emailed like any reply but **does not stop the first-response SLA**.
    - Canned notes must be `is_shared`, and their *current* text is used at run time.
- **Run log**
  - `AutomationRun` is append-only, with `status` = `success` / `failed` / `skipped`, a `message`, and `actions_result`.
  - A row is written for every rule that **matched** (trigger + conditions). Rules that didn't match leave no row.
  - Successful runs also write the audit row `automation_applied` (`{rule_id, rule_name, actions}`), which the Activity tab renders as "ran an automation rule · <name> — <actions>".

## The dispatch path (post-commit)
```
ticket_service.create_ticket/_after        → hooks.automation_dispatch("ticket_created", t, actor)
ticket_service.assign/_after                → hooks.automation_dispatch("ticket_updated", t, actor, changed_fields=[assignee|assigned_group])
ticket_service.update_ticket/_after         → hooks.automation_dispatch("ticket_updated", t, actor, changed_fields=_changed_field_keys(...))
field_service.set_values(notify_automation=True)  (set-fields view only) → ("ticket_updated", cf:<key>…)
engine.transition/_after_commit             → hooks.automation_dispatch("status_changed", t, actor, from_status, to_status)
        └─ dispatcher.dispatch(event, ticket, actor=…)
             1. actor is automation-bot → return            (loop guard: no chains in v1)
             2. active rules of ticket.project whose triggers match
             3. per rule: refresh ticket → conditions.matches → _run_rule (atomic) → AutomationRun + audit
             4. stop_processing on a SUCCESS run → break
```
**Notes on the path**
- `hooks._safe` swallows every exception, so the dispatcher **logs its own failures** into `AutomationRun` and the `itsm` logger. A rule failure never breaks the triggering write or the rules after it.
- `set_values` defaults `notify_automation=False`. Create, transition screens and move rely on their own events, so a create never fires `ticket_updated` before `ticket_created`.

## Frontend
- **Automation tab:** `settings/projects/[projectKey]?tab=automation` renders `components/settings/automation-editor.tsx`.
  - **List:** each rule shows a summary, Off/Stops badges, and run stats. Controls: Recent runs (history icon), reorder arrows, an active Switch, edit, and delete (with a confirm).
  - **"Use template"** pre-fills the driving use case:
    - status = the workflow's initial status AND assignee is not empty;
    - the transition from the initial status to `to_status_key == "assigned"`;
    - keep assignee on.
  - **Rule dialog:** module-level components, so focus stays stable.
    - When: checkboxes, a field checklist, and from/to status pickers.
    - If: condition rows reuse `useFilterOptions`, `ConditionValue` (new **`allowMe={false}`** prop) and `operatorLabel`.
    - Then: action cards; the "(create)" transition is hidden.
  - Copy is in `AUTOMATION_HELP` (`lib/itsm/help/settings.ts`). Help Center: article `admin-automation` + FAQ `faq-admin-automation-not-firing`.
- **Ticket detail:** `syncAfterAutomation` in `ticket-detail.tsx`. When an inline save comes back with a different status, it toasts "Automation moved this ticket to X" and reloads the transition buttons and comments.
- **Ticket API views** (`update`, `assign`, `set-fields`, `transition`) now `refresh_from_db()` before serializing. Without `ATOMIC_REQUESTS`, on_commit automation runs *inside* the request, so the response already carries the post-automation status.

## API clients
`automationRulesApi` (`lib/itsm/api.ts`) has `list`, `create`, `update`, `delete`, `runs` and `catalog`. Types are `AutomationRule*`, `AutomationRun` and `AutomationCatalog*` in `lib/itsm/types.ts`.

## RBAC module codes
- There is **no new module**. Rules are project settings.
- `ProjectSettingsPermission` maps reads to `itsm.projects:read` and **every write** (POST/PATCH/DELETE) to `itsm.projects:update`. This matches the UI gate `hasPerm("itsm.projects","update")` and avoids the routing-rules UI/API mismatch (BUG_LOG 2026-10-18).
- The queryset is clamped by `accessible_helpdesk_ids_cached` and `accessible_project_ids_cached`.
- `perform_create`, `perform_update` and `catalog` 403 an inaccessible project.

## Key files
- `models.py`: `AutomationRule`, `AutomationRun`, `TriggerType`, `ActionType`, `MAX_ACTIONS`.
- `services/dispatcher.py`: `dispatch`, `matching_rules`, `_run_rule`, `_record`.
- `services/conditions.py`: `matches`.
- `services/actions.py`: the `RUNNERS` table, `AutomationError`, `SETTABLE_BUILTINS`.
- `services/catalog.py`: `field_catalog` (watchable and settable fields).
- `services/system_user.py`: `get_automation_bot`, cached **per schema**, plus `is_automation_bot`.
- `serializers.py`: all JSON validation against the rule's project, plus `user_labels`.
- `views.py`: `AutomationRuleViewSet` (`runs` and `catalog` actions) and `ProjectSettingsPermission`.
- `tests.py`.
- Touch-points:
  - `itsm_core/services/hooks.py`: `automation_dispatch`.
  - `itsm_core/services/fields.py`: `set_values` returns the changed keys and takes `notify_automation`.
  - `itsm_core/models/audit.py`: `AUTOMATION_APPLIED`, migration `itsm_core/0013`.
  - `itsm_workflows/services/engine.py`: `preserve_assignee`, and the `status_changed` dispatch.
  - `itsm_tickets/services/ticket_service.py`: the emit points, `_changed_field_keys`, and `add_comment(counts_as_response=)`.
  - `itsm_tickets/views.py`: `refresh_from_db`, and `set-fields` passing `notify_automation=True`.

## Deferred (v2)
- Scheduled/time-based triggers (e.g. auto-close Resolved after N days), via the APScheduler container and `for_each_tenant`.
- A Notify action.
- Helpdesk-wide rules.
- Opt-in chaining with a depth limit.
- Run-log pruning.
- A dry-run "test against a ticket" button.
- Comment templating (`{{ticket.number}}`).
