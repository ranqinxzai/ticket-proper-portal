# itsm-dashboards — User Flows

## Flow A — Save a queue / filter (M2)
1. On the ticket queue, the agent builds a filter (status=open, priority in [critical,high],
   unassigned) → a `query_spec`.
2. `POST saved-filters` `{ name:"My critical backlog", query_spec }`.
3. The saved queue appears in the sidebar; opening it compiles `query_spec`→Q and lists matching
   tickets.

## Flow B — Bulk-update from a saved queue (M2)
1. From the saved queue, select all matching tickets.
2. `POST tickets/bulk/` (module `itsm.tickets.bulk`) with the `SavedFilter`/`query_spec` + an action
   (e.g. reassign to a group).
3. The same `query_builder` selects the set, so "select all" matches the visible queue exactly.

## Flow C — Build a dashboard (M10)
1. Agent opens `dashboards/[id]/edit` (react-grid-layout).
2. Drags widgets from the registry: a KPI (open count), a pie (by priority), an SLA gauge, a
   ticket-list bound to a saved filter.
3. Each widget's `source` points at a report aggregate or a `SavedFilter`; positions saved as
   `x/y/w/h`.
4. Save → view at `dashboards/[id]`; optionally `POST dashboards/{id}/share` with a user/role/group.

## Flow D — View a shared dashboard
A shared viewer sees the layout, but every widget's data is still gated by their RBAC — they never
see tickets they couldn't see in the queue.
