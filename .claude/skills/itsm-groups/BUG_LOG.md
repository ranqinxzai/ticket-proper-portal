# itsm-groups — Bug Log / Gotchas

- **Round-robin MUST stay inside the locked transaction.** `round_robin_pick` advances the cursor
  under `select_for_update`. Calling the picker outside a transaction, or reading the cursor
  without the lock, reintroduces the double-assign race the lock exists to prevent.
- **Cursor user leaving the group resets to index 0.** If `last_assigned_user` is no longer an
  active member, the next pick starts at the first member — a small fairness blip, not a bug.
- **`least_loaded_pick` excludes only `status__category__key="done"`.** "Open load" = anything not
  in a Done-category status. Custom statuses miscategorized as `done` won't count toward load.
- **Routing `match_spec` matching is shallow today.** Only `ticket_type` (compared as strings) and
  `priority` are honored in `resolve_group_and_assignee`; documented "field conditions" are
  reserved and currently ignored.
- **Routing only runs at create time and only when no assignee was passed.** `create_ticket`
  applies routing iff `apply_routing and assignee is None`. An explicit assignee skips routing
  entirely.
- **`remove_member` is soft (sets `is_active=False`).** The `(group,user)` row persists; agents who
  "left" still satisfy the unique constraint. Re-adding reactivates via `update_or_create`.
- **`group_lead` strategy returns None if the group has no lead.** Auto-assign then leaves the
  ticket unassigned rather than erroring.
- **`keep_current` returns None.** The engine interprets a None assignee from `resolve_assignee` as
  "don't change the assignee", so `keep_current` is effectively a no-op picker.
