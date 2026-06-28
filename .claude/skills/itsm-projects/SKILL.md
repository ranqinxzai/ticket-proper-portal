# itsm-projects

## Purpose
The top-level container, now owned by a **Helpdesk** (department/workspace — see itsm-helpdesks).
A `Project` owns a `helpdesk` (non-null FK), a key, a type, its default group and workflow, and a
set of `TicketType`s. Each active helpdesk is seeded its OWN default **Incident** + **Request**
projects (so IT's Incident ≠ HR's), each wired to the matching default workflow + the helpdesk's own
Service Desk group, with starter ticket types. Keys are helpdesk-prefixed (e.g. `ITINC`, `ITREQ`,
`HRINC`, `HRREQ`) so they stay globally unique and become the ticket-number prefix.

## Update (2026-06-24) — Per-user project assignment (strict-whitelist access)
- **Request:** assign **projects** to a user from User Management (alongside helpdesks), and make a
  project's workspace **tab + its tickets/reports a hard access boundary** — a user sees a project only
  when assigned (strict whitelist).
- **Model:** new **`ProjectMembership(project, user, is_active)`** (`uniq(project,user)`,
  index `(project,is_active)`; migration `0006`). Backfill migration `0007` grants every active
  helpdesk member access to all that helpdesk's active projects (so existing agents keep their tabs);
  `seed_project_memberships` (new `seed_itsm` step, runs last) does the same for fresh/re-seeded orgs.
- **Scope service:** `services.accessible_project_ids(user, request)` + `_cached` (mirrors
  `itsm_helpdesks.services`). `None` ⇒ unrestricted (superuser **or** `itsm.projects:update` admin/
  Supervisor). Else: a helpdesk the user **leads** → all its active projects; a helpdesk they're a
  **member** of → only assigned active projects (strict; none ⇒ none); **plus** any project they're the
  `lead` of. `[]` ⇒ sees nothing.
- **Hard-boundary clamps (every ticket-data surface, mirroring the helpdesk guard points):**
  `ProjectViewSet.get_queryset` (narrows tabs/Create-menu/dashboard+reports pickers for free);
  `TicketViewSet.get_queryset` + `_bulk`; `is_project_accessible` (now also requires project membership →
  covers create/links/apply_template/watchers + reports `?project=`); `query_builder.build_q`/
  `filtered_tickets` gained an `accessible_project_ids` kwarg (saved filters, widgets, bulk-by-filter);
  reports `_base`/SLA sections (`project_ids`), dashboards `results`/widget `data`, `SLATrackerViewSet`.
- **Assignment API:** `add_member`/`remove_member` `@action`s on `ProjectViewSet` + a
  `ProjectMembershipViewSet` (`/project-memberships/`, `?user=&project=&is_active=`), all gated by
  **`itsm.admin.helpdesks`** (membership admin, not project config). A **requestor** target is rejected
  (400). `MemberSerializer` gained `projects[]`; `create_user` accepts `projects: [{id}]` (each project's
  helpdesk must be among the requested helpdesks).
- **Frontend:** `user-helpdesks-sheet.tsx` (now "Helpdesks & Projects") shows each member helpdesk's
  active projects as checkboxes (leads see all — no picker); `AddUserDialog` collects projects under each
  selected helpdesk; a new project-route **`layout.tsx`** guards `page`/`new`/`[ticketId]` by
  `projectByKey` (a hidden project can't be reached by URL). The workspace tabs/Create-menu/pickers narrow
  automatically since they all derive from the scoped `projectsApi.list()`.

## Update (2026-06-24) — Notifications tab (per-project notification config)
- **Project settings now has 10 tabs**: Overview, Fields, Workflow, Layout, Columns, Filters, Routing,
  SLA, **Notifications**, Approval. The **Notifications** tab
  (`components/settings/notifications-editor.tsx`) is a per-event matrix to enable/disable each event,
  pick channels (In-App / Email / WhatsApp-disabled "Coming soon"), choose recipients, toggle
  notify-actor, and edit the email subject + HTML body (Tiptap, with Edit/Preview). Gated by
  `itsm.notifications.schemes` (rules) + `itsm.notifications.templates` (templates) — Supervisor-only.
- **New projects get their own notification scheme.** `ProjectViewSet.perform_create` now also calls
  `itsm_notifications.seed.ensure_notification_scheme(project)` (guarded — never blocks creation),
  right after `ensure_project_layout`. Existing projects are backfilled by re-running `seed_itsm`
  (new step `backfill_notification_schemes`). See the itsm-notifications skill for the full design.

## Update (2026-06-23) — Routing tab + assignment-group whitelist
- **Project settings now has 9 tabs**: Overview, Fields, Workflow, Layout, Columns, Filters,
  **Routing**, SLA, Approval. The **Routing** tab (`components/settings/routing-editor.tsx`) holds two
  independently-gated sections: (a) the **assignment-group whitelist** (writes ride
  `itsm.projects:update`) and (b) the **routing-rule editor** (writes ride `itsm.groups:update`). See
  the itsm-groups skill for the full design.
- **New `Project.allowed_group_ids`** (JSONField, default `[]`, migration `0005`) — the whitelist of
  group ids assignable on this project's tickets. **Empty ⇒ all groups allowed (default).** Exposed on
  `ProjectSerializer` + `ProjectWriteSerializer` (`validate_allowed_group_ids` drops non-UUIDs, dups,
  and ids outside this project's helpdesk / shared teams). The project's `default_group` is always
  implicitly allowed (folded in at enforcement time). Enforcement + the routing engine live in
  itsm-groups (`ensure_group_allowed`, `resolve_group_and_assignee`).

## Update (2026-06-22) — Filters tab (queue default views + custom filters)
- **Project settings now has 8 tabs**: Overview, Fields, Workflow, Layout, Columns, **Filters**, SLA,
  Approval. The **Filters** tab (`components/settings/filters-editor.tsx`, module `itsm.projects`)
  lets admins: (a) **enable/disable built-in system views** per project — every view except
  **All tickets** (which is always on); (b) **create/edit/delete/reorder custom shared filters** with
  the same chip builder used on the queue (reuses `FilterChip`/`FieldPicker`/`useFilterOptions`,
  persisted as project-scoped `SavedFilter`s — see itsm-dashboards); and (c) pick the **project
  default view**.
- **Two new `Project` columns** (migration `0004_project_default_view_key_project_disabled_view_keys`):
  - **`default_view_key`** (CharField(64), blank) — a system view key (`"open"`, `"all"`, …) or
    `"saved:<uuid>"`. Blank ⇒ product default (`PRODUCT_DEFAULT_VIEW_KEY = "open"`, in
    `itsm_tickets/services/filter_fields.py`). `ProjectWriteSerializer.validate_default_view_key`
    blanks anything that no agent's queue could resolve — an unknown key, or a `saved:<uuid>` that
    isn't a **shared** filter scoped to **this project** (or a global/null-project shared one),
    mirroring `SavedFilterViewSet`'s scoping (so a personal or cross-project filter can't be a default).
  - **`disabled_view_keys`** (JSONField, default `[]`) — system view keys hidden from this project's
    queue dropdown. `validate_disabled_view_keys` strips `"all"` + unknown keys + dups.
- **Queue resolution (frontend, `ticket-queue.tsx`):** on a fresh visit (no `?view`/`?q` in the URL)
  the queue resolves the active view as **personal default → project `default_view_key` → product
  default (`open`) → All tickets**, validating each candidate still resolves to an available view; a
  `ready` gate holds the first fetch so there's no "All tickets" flash. Deep links are honoured as-is.
- **Per-user default** lives in **itsm-dashboards `QueueViewPreference`** (parallel to
  `QueueColumnPreference`); agents set it from the queue view dropdown's **star** ("Set as my default").

## Update (2026-06-22) — Ticket-categories editor removed from Overview
- The **Ticket categories** management section (the `TicketType` CRUD list + "New category"
  add row) was **removed from the Overview tab** — deemed low value (categories are rarely edited
  and cluttered the tab). The frontend `ticket-types-editor.tsx` component, the dead `ticketTypesApi`
  client, and the unused `CreateTicketTypeInput` type were deleted with it.
- **`TicketType` itself is unchanged and still load-bearing.** Categories stay seeded per project and
  are consumed **read-only** by the ticket flow — the create form resolves the layout for the project's
  **default** type (the standalone create-form **Type** *selector* was removed 2026-06-23 as a
  config↔create mismatch — see itsm-tickets; the default type is now sent silently and still drives
  layout resolution), the queue **Type** filter, and the detail **Type** row all read the embedded
  `project.ticket_types` (from `ProjectSerializer`). So the model / serializer / seed stay intact.
- The backend `TicketTypeViewSet` (`/ticket-types`, module `itsm.projects.config`) is left in place
  but is **no longer surfaced in the UI** — categories are now managed only via seed / API, not Settings.

## Update (2026-06-21) — queue column + SLA config tabs
- **`Project.queue_columns`** (JSONField, default `[]`) — the project's default ticket-queue column
  layout (ordered column keys; empty ⇒ built-in default). Exposed on `ProjectSerializer` +
  `ProjectWriteSerializer`. Edited on the new **Columns** tab (`column-layout-editor.tsx`); agents may
  still override their own layout (see itsm-tickets / `QueueColumnPreference`).
- **Project settings now has 7 tabs**: Overview, Fields, Workflow, Layout, **Columns**, **SLA**,
  Approval. The **SLA** tab (`sla-editor.tsx`) configures the project's SLA policy — see itsm-sla.

## Backend app path
`backend/apps/itsm_projects/`

## Key concepts
- **`Project`** — `helpdesk` (FK Helpdesk, **CASCADE**, `related_name="projects"`, non-null), `name`,
  globally-unique `key` (2–10 uppercase, validated by `KEY_VALIDATOR`),
  `project_type` (incident / service_request / custom), `status` (active/inactive), `color`/`icon`,
  `default_group` (FK Group, SET_NULL), `default_workflow` (FK Workflow, **PROTECT**), `lead`,
  `created_by`. The `key` becomes the ticket-number prefix (`ITINC-1`). A **partial UniqueConstraint
  `(helpdesk, project_type)`** (WHERE type ∈ incident/service_request AND `is_deleted=False`) enforces
  exactly one default Incident + one default Request per helpdesk; CUSTOM projects are unconstrained.
- **`TicketType`** — per-project ticket flavor (Incident, Hardware, Access Request…) with a
  `base_category` (incident / service_request), optional parent, `is_default`, `is_active`,
  `sort_order`. Unique `(project, key)`.
- **`Project.calendar`** (FK `itsm_sla.BusinessCalendar`, **SET_NULL**, nullable, migration
  `0002_project_calendar`) — the business calendar this project's SLA clocks use. `sla_engine.start_trackers`
  prefers `ticket.project.calendar` over the resolved policy's calendar and the global default; the
  per-tracker `calendar` snapshot still freezes the choice (in-flight clocks unaffected). Set it in the
  project's **Overview** settings tab. Other config (notification scheme / field layout) attaches via FKs
  in later milestones.

## Frontend path / pages
A helpdesk's projects render as **tabs in the consolidated workspace header** (after Dashboard) and as
items in the header **Create** dropdown — both via `components/agent/workspace/workspace-tabs.tsx` /
`create-menu.tsx`, using `project-display.ts` (`projectLabel` → "Incident"/"Request"/name) and the
`lib/itsm/icon-map.tsx` registry (`project.icon`, falling back per `project_type`). Queue/detail/create
live under `agent/w/[helpdeskKey]/p/[projectKey]/...`.

**Project configuration hub (built).** `agent/w/[helpdeskKey]/settings/projects` lists all projects
(active + inactive, from `useWorkspace().allProjects`) and creates **custom** projects
(`project-create-dialog.tsx` forces `project_type="custom"` — Incident/Request are one-per-helpdesk
singletons). `agent/w/[helpdeskKey]/settings/projects/[projectKey]` is a 5-tab config page
(`?tab=` deep-link): **Overview** (name/key/desc/status/icon/colour/default group/default workflow/
**business calendar**/lead — ticket-type CRUD was removed 2026-06-22, see Update above),
**Fields** (`itsm.fields`), **Workflow**
(`itsm.workflows` — statuses/transitions + validate), **Layout** (`itsm.fields.layouts`), **Approval**
(`itsm.approvals.admin`). Editing a project `key` is allowed with a UI warning — existing tickets keep
their stored numbers (no renumber); only new tickets use the new prefix.

## API clients
`/api/v1/itsm/projects`, `/api/v1/itsm/ticket-types`.

## RBAC module codes
- `ProjectViewSet` → **`itsm.projects`** (Agent: read-only; Supervisor: full). `get_queryset` is
  **helpdesk-scoped**: filtered to the requester's accessible helpdesks and clamped by the advisory
  `?helpdesk=<id|key>` param (superusers unrestricted); `perform_create` rejects (403) a helpdesk the
  creator can't access. Serializer exposes `helpdesk`/`helpdesk_key`/`helpdesk_name`/`project_type`.
- `TicketTypeViewSet` → **`itsm.projects.config`** (config-level; Supervisor only by default).

## Key files
- `models.py` — `Project`, `TicketType`, `ProjectType`, `KEY_VALIDATOR`.
- `views.py` — `ProjectViewSet` (read/write serializer split), `TicketTypeViewSet`.
- `serializers.py` — `ProjectSerializer` / `ProjectWriteSerializer` / `TicketTypeSerializer`.
- `urls.py` — registers `projects`, `ticket-types`.
- `seed.py` — loops active helpdesks, seeding each helpdesk's `<KEY>INC` + `<KEY>REQ` projects, wiring
  the shared default workflow + the helpdesk's Service Desk group and ticket types (idempotent).
  After each project it calls `itsm_core.seed.ensure_project_layout(project)` to seed the
  **standard field set + default `FieldLayout`** (see itsm-fields). `ProjectViewSet.perform_create`
  calls the same helper so **new custom projects** get the standard Fields/Layout too.
