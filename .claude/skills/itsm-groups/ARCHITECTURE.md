# itsm-groups — Architecture

## Layout
```
itsm_groups/
  models.py       # Group, GroupMembership, GroupAssignmentState, RoutingRule
  services.py     # round_robin_pick, least_loaded_pick, resolve_assignee, resolve_group_and_assignee
  views.py        # GroupViewSet(+members/add_member/remove_member), GroupMembership, RoutingRule
  urls.py
  seed.py         # five default groups
```

## Design decisions
- **Round-robin fairness under concurrency.** `round_robin_pick` opens a transaction, locks the
  per-group `GroupAssignmentState` row with `select_for_update`, computes the next active member
  after the stored cursor, advances the cursor, and commits. Two simultaneous auto-assigns
  therefore serialize on the cursor row and can't pick the same member. `get_or_create` lazily
  creates the cursor row on first use.
- **Members are sorted deterministically** (`order_by("user_id")`) so the round-robin order is
  stable across calls and the "next after cursor" math is well-defined; if the cursor user has
  left the group, it falls back to index 0.
- **Least-loaded** counts open (non-`done`) assigned tickets per candidate via a single aggregate
  query and picks the min (ties broken by `str(uid)` for determinism).
- **Strategy dispatch is data-driven.** `resolve_assignee(strategy, group, fixed_user_id)` maps the
  five `AutoAssignmentRule.Strategy` values (`round_robin`, `least_loaded`, `group_lead`,
  `fixed_user`, `keep_current`→None) to the right picker. The workflow engine's `auto_assign`
  post-function calls this.
- **Routing = ordered first-match.** `resolve_group_and_assignee(ticket)` pulls active rules for
  the ticket's project (or global, `project=null`) ordered by `priority`, and returns the first
  whose `match_spec` matches (ticket_type / priority today; field conditions reserved). Called at
  ticket-create time when no explicit assignee was given.
- **Soft membership removal.** `remove_member` sets `is_active=False` rather than deleting, so
  history and the unique `(group,user)` constraint stay intact (re-adding flips it back via
  `update_or_create`).

## Where the services are invoked
- `itsm_tickets.services.ticket_service.create_ticket` → `resolve_group_and_assignee`.
- `itsm_workflows.services.engine._apply_post_function` (`auto_assign`) → `resolve_assignee`.
