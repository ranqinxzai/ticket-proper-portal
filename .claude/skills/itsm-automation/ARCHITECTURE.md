# itsm-automation: Architecture

## Why a separate app
Automation is its own domain: rule config plus an execution log. It follows the one-app-per-domain convention, like `itsm_surveys` and `itsm_approvals`.
- **It owns no write path.** Every action calls an existing choke-point (`engine.transition`, `ticket_service.update_ticket` / `add_comment`, `field_service.set_values`). Guards, audit rows, SLA hooks and notifications therefore behave exactly as they do for a manual edit (rule 4).
- **Callers reach it only through `hooks.automation_dispatch`** (lazy import, rule 12). Removing the app turns automation into a no-op.

## Execution model
1. **Post-commit.** Each emit point sits at the end of the write's existing `transaction.on_commit` callback, so automation only sees committed data, and a rolled-back write never triggers a rule.
2. **Synchronous within the request.** There is no `ATOMIC_REQUESTS`, so the on_commit callback runs when the service's `@atomic` block exits, before the view returns. The views therefore `refresh_from_db()` before serializing, and the agent's PATCH response already shows the post-automation status.
3. **One `transaction.atomic()` per rule.**
   - An `AutomationError`, or any unexpected exception, rolls back that rule's actions, together with the on_commit callbacks they queued.
   - A FAILED `AutomationRun` is written outside the rolled-back block.
   - Processing then continues with the next rule.
4. **Re-read between steps.** The ticket is refreshed before each rule and each action, so later steps see earlier effects.

## Loop guard
Every action runs as `automation-bot`, and `dispatch()` returns immediately when the event's actor is the bot. So:
- a rule's own writes never re-trigger it, or any other rule;
- loops can't happen, and neither can chains.

That is the v1 trade-off. Opt-in chaining with a depth limit is deferred.

**SLA escalation is not the bot.** It calls `assign(user=None)`, and `None` is a real event source, so an escalation reassignment *can* fire `ticket_updated` rules.

## Conditions = the queue compiler
`conditions.matches()` runs `build_q(spec)` against a single-row queryset.
- Rules get the full operator set and the `cf:` / `maps_to` handling for free, with one source of truth.
- `build_q` silently **drops** a condition it can't compile. Under `match: all`, that would widen the rule. The serializer therefore rejects any condition `_compile_condition` returns `None` for, and rejects `"me"`, which has no meaning for the bot.

## The bot user
`get_automation_bot()` lazily creates `automation-bot` ("Automation", unusable password, `app_access=[]`) in each tenant schema.
- The cache is keyed by `connection.schema_name`. The email-bot's process-wide cache would hand one tenant's user to another; that is logged in BUG_LOG.
- Tests call `system_user.reset_cache()` in `setUp`.

## Engine change: `preserve_assignee`
`engine.transition(..., preserve_assignee=False)`: when True and the ticket already has an assignee, the `auto_assign` post-function is skipped.
- Automation passes `keep_assignee`, which defaults to on, so running Assign keeps the agent who was just picked.
- Manual clicks are unchanged. The seeded round-robin overwrite on a manual Assign still exists. Making a manual Assign keep an existing assignee would be a separate change.
