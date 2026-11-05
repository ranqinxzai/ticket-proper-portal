# itsm-automation: Bug Log

Gotchas found while building v1 (2026-10-18).

- **`TestCase` defers on_commit until `captureOnCommitCallbacks` exits.** That happens *after* the view has returned, so a `TestCase` can't prove that the PATCH response reflects automation. `ViewResponseTests` uses `TransactionTestCase` (real commits), which matches production.
- **`build_q` silently drops conditions it can't compile.** Under `match: all`, an incomplete condition would quietly make the rule match more tickets. The serializer rejects any condition `_compile_condition()` returns `None` for.
- **`"me"` in a rule condition** compiles to "match nothing" (no request user), so the serializer rejects it. The UI hides the "Current user (me)" option with `ConditionValue allowMe={false}`.
- **`set_values` used to emit nothing.** It is also called from `create_ticket`, from transition screens, and from move. Dispatching from all of them would fire `ticket_updated` *before* `ticket_created`, and once again on every transition. Only the agent `set-fields` view passes `notify_automation=True`.
- **A public automated comment would have stopped the first-response SLA**, because the first public reply stamps `first_responded_at`. `add_comment(counts_as_response=False)` was added; only people answering count.
- **The seeded Assign transition round-robins** (`auto_assign`), so running it via automation would replace the agent the user just picked. Fixed with `engine.transition(preserve_assignee=True)`.
- **The email-bot's cache is process-wide.** It returns tenant A's `User` to tenant B, the same id in another schema. The automation bot caches per `connection.schema_name`. The email-bot issue is logged in `docs/BUG_LOG.md` and is still open.
- **The seed already has a group with key `network`.** Test fixtures that create groups must use unique keys.
- **The transitions API returns only `to_status_key`.** The editor resolves names from `workflowsApi.statuses` (BUG_LOG 2026-10-18).
