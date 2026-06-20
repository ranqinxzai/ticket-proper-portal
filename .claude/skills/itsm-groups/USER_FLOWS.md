# itsm-groups — User Flows

## Flow A — Build a team
1. Supervisor `POST groups` `{ name:"Network Team", key:"network", type:"network", lead }`.
2. Adds members: `POST groups/{id}/add_member` `{ user, role_in_group:"member" }` (repeat).
3. `GET groups/{id}/members` shows the active roster.

## Flow B — Route incoming tickets to the right team
1. Supervisor creates a `RoutingRule`: `POST routing-rules` `{ project:INC, name:"Network issues",
   priority:50, match_spec:{ticket_type:<Network uuid>}, target_group:<Network> }`.
2. A new INC ticket of type Network is created with no explicit assignee.
3. `create_ticket` → `resolve_group_and_assignee` evaluates rules by ascending priority; the
   network rule matches first → ticket lands on the Network Team.

## Flow C — Auto-assign within a group on transition
1. A workflow transition (e.g. "Assign") carries an `auto_assign` post-function with
   `strategy:"round_robin"`.
2. On transition, the engine calls `resolve_assignee("round_robin", group)`.
3. `round_robin_pick` locks the group's cursor, picks the next active member, advances the cursor,
   and the ticket's `assignee` is set to that user.

## Flow D — Rebalance
1. Switch a transition's strategy to `least_loaded`.
2. Next assignment picks the active member with the fewest open assigned tickets.
