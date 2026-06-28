# itsm-groups

## Purpose
Operational teams that own and work tickets, plus the auto-assignment and create-time
routing logic. A `Group` has members (`GroupMembership`), a round-robin cursor
(`GroupAssignmentState`), and `RoutingRule`s decide which group/assignee a new ticket lands
on. Auto-assignment strategies (round-robin, least-loaded, group-lead, fixed-user) are the
service layer the workflow engine calls during a transition.

## Update (2026-06-24) — Members endpoint drives the Lead-badge technician picker
- The ticket **Assigned Technician** dropdown (`components/tickets/group-member-picker.tsx`) consumes
  `GET /groups/{id}/members/` and now renders a small **Lead** badge for any member whose
  `role_in_group === "lead"` (it was bare "(lead)" text in a native `<select>`; rebuilt as a Popover so
  the badge can render). No backend/serializer change — `GroupMembershipSerializer` already returns
  `role_in_group`, and the endpoint already filters to active members, leads-first on the client. See
  the **itsm-tickets** skill for the full picker rewrite.

## Update (2026-06-23) — Routing rules editor + assignment-group whitelist (BUILT)
- **Routing tab (project settings).** New project settings tab **Routing**
  (`components/settings/routing-editor.tsx`) — the long-planned routing-rule editor, plus a
  per-project **assignment-group whitelist**. Two sections, gated independently: the whitelist writes
  ride **`itsm.projects:update`** (it's a `Project` column), the rules ride **`itsm.groups:update`**.
- **Assignment-group whitelist.** New `Project.allowed_group_ids` (JSONField, default `[]`, migration
  `itsm_projects/0005`). **Empty ⇒ ALL groups allowed (the default — nothing restricted).** When
  non-empty, only those group ids (plus the project's own `default_group`, always folded in by
  `services.allowed_group_ids_for(project)`) may be assigned. Enforced by
  `ticket_service.ensure_group_allowed(project, group_id)` on the agent write paths (create / inline
  `update_ticket` / `assign` / bulk-assign — mirrors `ensure_assignee_in_group`; the low-level
  `create_ticket`/`assign` stay permissive for routing/portal/email/seeds). The frontend group pickers
  (create form group_picker + detail `GroupSelect`) filter to the set via
  `lib/itsm/groups.ts:allowedGroupsForProject(groups, project, keep)` (keeps the default + current
  group so an existing assignment never drops out). `ProjectWriteSerializer.validate_allowed_group_ids`
  drops non-UUIDs, dups, and ids not in this project's helpdesk or a shared/global team.
- **`RoutingRule.match_spec` now matches on any field.** The resolver
  `services.resolve_group_and_assignee(ticket, custom_fields=None)` supports a **condition list**
  `{match: "all"|"any", conditions: [{field, operator: "eq"|"neq", value}]}` where `field` is a
  built-in attribute (`ticket_type`/`priority`/`impact`/`urgency`/`source`) **or a custom field key**
  (e.g. a "location" dropdown) — read from the create payload's `custom_fields` (those values aren't
  persisted until after save, so they're threaded in). The legacy flat `{ticket_type, priority}` shape
  still matches (AND). Empty spec matches every ticket. `_routing_actual_value` / `_value_matches` /
  `_spec_matches` are the helpers; multi-value actuals (multiselect) match on membership.
- **Routing fires only when ownership is unset.** `create_ticket` now applies routing **only when both
  `assignee is None` AND `assigned_group is None`** — an explicitly-chosen group/assignee is always
  respected (was: routed whenever `assignee is None`, which could override an explicit group). So a
  ticket created with no group + Location=Delhi lands on IT Delhi; one created with an explicit group
  keeps it. Builder UX: name + condition rows (field/operator/value, Match all/any) + target group +
  optional target technician (`UserSearchCombobox`); reorder = ascending `priority` (first match wins);
  per-row active toggle; `routingRulesApi` (`/routing-rules`).

## Update (2026-06-23) — team management moved into the Edit group panel
- **Edit owns team management** — the Edit group sheet (`group-form-sheet.tsx`) now has a **Team**
  section: a **Leads** multi-select (chips) and an **Agents** list, both via `UserSearchCombobox` →
  `add_member`/`remove_member`. It only renders in **edit mode** (memberships need a saved group); create
  is core-only with a hint to reopen. Team writes are **immediate** (same as the old members sheet); the
  core **Save** persists only name/key/type/description and **must not send `lead`** (that would clobber
  the primary).
- **Multiple leads + primary** — leads are just `role_in_group="lead"` memberships (already supported).
  `leads[0]` is the **primary**, mirrored into the single `Group.lead` FK so the `group_lead` auto-assign
  strategy is unchanged. Helpers: "Set primary" reorders; demoting/removing the primary promotes the next
  lead (or clears `lead` to null); "Make lead" promotes an agent; adding a user as lead-vs-agent moves them
  between sections (no duplicate membership — `add_member` upserts the role).
- **Members button is now Shared/read-only only** — `groups-list.tsx` shows **Edit/Delete** for owned
  groups a supervisor can manage (team lives in Edit) and keeps the standalone `group-members-sheet.tsx`
  **Members** button for shared/global teams and read-only viewers (`!canManage`).

## Update (2026-06-21) — group membership drives strict assignment
- **Members feed the assignee picker** — `GET /groups/{id}/members/` (active memberships, role in
  `role_in_group`) is the candidate pool for a ticket's assignee in both the detail view and the create
  form (`components/tickets/group-member-picker.tsx`, leads listed first).
- **Strict assignment** — a ticket's assignee must be an active member of its assigned group; enforced
  by `apps.itsm_tickets.services.ticket_service.ensure_assignee_in_group` (uses `active_member_ids`) on
  the agent write paths (see itsm-tickets). The group services here stay unchanged.
- **Add member / lead, promote / demote** — `add_member` (already `update_or_create` on
  `(group,user)` with `role_in_group` in defaults) doubles as the promote/demote path; the members
  sheet (`group-members-sheet.tsx`) adds members as **member or lead** and toggles the role inline.

## Backend app path
`backend/apps/itsm_groups/`

## Key concepts
- **`Group`** — `helpdesk` (FK Helpdesk, **SET_NULL**, nullable — `null` = shared/global team),
  `name`/`key` (both unique), `type` (service_desk/network/infra/security/app_support/custom),
  `lead`, `is_active`. Seeded: 4 shared global teams (Network, Infrastructure, Security, Application
  Support) **plus one namespaced Service Desk group per helpdesk** (e.g. `it-service-desk` / "IT
  Helpdesk Service Desk"), which is the default landing group for that helpdesk's projects.
- **`GroupMembership`** — `(group, user)` unique; `role_in_group` member/lead; `is_active`.
- **`GroupAssignmentState`** — one row per group, the round-robin cursor (`last_assigned_user`),
  locked with `select_for_update` during a pick so two tickets never grab the same member.
- **`RoutingRule`** — create-time ownership: ascending `priority`, first match wins; `match_spec`
  JSON (ticket_type / priority / field conditions) → `target_group` (+ optional `target_assignee`).
  A `project=null` rule is global.
- **Services (`services.py`)** — `round_robin_pick`, `least_loaded_pick`, `resolve_assignee(strategy,
  group, fixed_user_id)`, `resolve_group_and_assignee(ticket)`, `active_member_ids`.

## Frontend path / pages
**Assigned Groups (built)** — `agent/w/[helpdeskKey]/settings/groups` lists this helpdesk's groups
**plus** shared/global teams (flagged "Shared", read-only there). Owned groups: create/edit
(`group-form-sheet.tsx`, sets `helpdesk` to the current one + auto-slugged `key`) **with team management
(leads multi-select + agents) folded into Edit** — see the 2026-06-23 update. Shared teams + read-only
viewers keep the standalone members sheet (`group-members-sheet.tsx`), both via the `/users/?search=`
combobox. `GroupSerializer` exposes `helpdesk`/`helpdesk_name`/`member_count`;
`GroupViewSet.get_queryset` is helpdesk-scoped (`Q(helpdesk_id__in=scope) | Q(helpdesk__isnull=True)`) and
`perform_create` guards inaccessible helpdesks (global groups are superuser-only). Routing-rule editor:
still planned.

## API clients
`/api/v1/itsm/groups` (+ `members`/`add_member`/`remove_member` actions),
`/api/v1/itsm/group-memberships`, `/api/v1/itsm/routing-rules`.

## RBAC module codes
All three ViewSets → **`itsm.groups`** (Agent: read-only; Supervisor: full CRUD + membership
actions).

## Key files
- `models.py` — `Group`, `GroupMembership`, `GroupAssignmentState`, `RoutingRule`, `GroupType`.
- `services.py` — auto-assign strategies + routing resolver.
- `views.py` — `GroupViewSet` (member actions), `GroupMembershipViewSet`, `RoutingRuleViewSet`.
- `urls.py` — `groups`, `group-memberships`, `routing-rules`.
- `seed.py` — seeds the 4 shared global teams + one Service Desk group per active helpdesk.
