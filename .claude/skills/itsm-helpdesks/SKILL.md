# itsm-helpdesks

## Purpose
The department/workspace layer above Projects. A `Helpdesk` (IT, HR, Facilities, …) is a
workspace that owns its own default Incident + Request projects, its own Service Desk group,
and an explicit member roster. **Membership is the row-level scope every ticket-facing query is
clamped to** — an IT agent never sees an HR ticket. Three helpdesks are seeded: **IT**, **HR**,
and **Facilities** (FAC). This app is the rename of "ITSM" → **One Helpdesk**: multiple departments
share one platform.

## Update (2026-06-28) — "My Requests" list refreshes live (silent)
The end-user **My Requests** list (`app/t/[org]/(portal)/portal/requests/page.tsx`) now stays live: a new
request, or a status change on an existing one, appears without a hard reload. It uses the shared
`useLivePoll` hook (`lib/itsm/use-live-poll.ts`) against a new requestor-scoped change-token
`GET portal/requests/pulse/` (`PortalTicketViewSet.pulse`, `{version, count}`, scoped to
`requestor=request.user` — never another user's tickets). Same **hybrid apply** as the agent queue:
swaps rows in place when the requestor is idle at the top, otherwise stages them behind a "Refresh" pill
so the list never shifts under a click. Polling pauses when the tab is hidden. New FE client:
`portalApi.requestsPulse`. No new infra (polling, not SSE/WebSockets). See itsm-tickets (2026-06-28) for
the full mechanism + rationale.

## Update (2026-06-25) — Service Portal detail redesign: attachments + watchers + Reopen
The end-user portal request detail (`app/t/[org]/(portal)/portal/requests/[id]/page.tsx`) was rebuilt to
a clean **two-column** layout (`max-w-5xl`, `lg:grid-cols-[minmax(0,1fr)_320px]`) consistent with the agent
console: header (number · helpdesk · type, summary, `StatusBadge`, **Reopen** buttons top-right) → main
(description + `PortalFieldDisplay` + Conversation) → sidebar (**Attachments** + **Watchers** cards). New
module-top-level helpers: `PortalReopenButtons`, `PortalAttachments`, `PortalWatchers`.
- **Attachments** were previously a dash. `PortalTicketViewSet.retrieve` now returns an **`attachments`**
  array (`PortalAttachmentSerializer`, `context={"request":…}` for absolute URLs) — the portal shows image
  previews + download, and **uploads** via the existing `request-intake/{number}/attachments/` endpoint.
  **No portal delete** (requestors hold create, not delete).
- **Watchers** (name only — never another user's email): `retrieve` returns a **`watchers`** array; new
  actions `watchers` (GET list + POST **add-by-email**) and `watchers/remove` (POST). Add-by-email does an
  **exact `email__iexact`** match (no directory enumeration; generic 404 on miss; never creates a user).
- **Reopen** (and any `portal_allowed` transition): new `available-transitions` (GET, `portal_only=True`)
  + `transition` (POST) actions; the UI renders a button per transition (a `note_prompt` transition opens a
  small reason dialog). See itsm-workflows for the `portal_allowed` flag.
- **RBAC trap (important):** requestors hold **read + create** on `itsm.portal.tickets`, **not delete**.
  `HasModulePermission` maps `DELETE→delete`, so every portal **removal is a POST** (`watchers/remove`),
  never DELETE — a DELETE would 403. No new RBAC module was needed (all under `itsm.portal.tickets`).
- New FE `portalApi`: `availableTransitions`, `transition`, `watchers`, `addWatcher`, `removeWatcher`;
  `PortalTicketDetail` gained `attachments`/`watchers`; new `PortalWatcher`/`PortalTransition` types.
- Tests: `apps.itsm_tickets.tests` `PortalAllowedSeedTests`, `EngineAvailableTransitionsPortalTests`,
  `PortalTransitionWatcherAttachmentApiTests` (reopen happy-path, reject non-portal 404, cross-owner 404,
  add-watcher-by-email + unknown-email-404 no-leak + idempotent + list-hides-email + remove-via-POST,
  retrieve-includes-attachments).

## Update (2026-06-24) — Membership guards: active-only + no requestors
- **`HelpdeskViewSet.add_member`** now rejects (400) two cases before upserting the `HelpdeskMembership`:
  the helpdesk is **not `active`** (members are only assignable to active helpdesks), and the target user
  **is a requestor** (`itsm_rbac.services.is_requestor` — portal-only end-users hold no membership).
- The **User-Management UI** mirrors this: the helpdesk pickers (Add-user dialog + Helpdesks sheet) list
  **only `status==="active"`** helpdesks, and both hide assignment entirely for a requestor.
- **Demotion side-effect** (in `itsm_rbac`): setting a user's role to `requestor` deactivates all their
  `HelpdeskMembership` (+ `ProjectMembership`) rows — see the **itsm-rbac** skill.

## Backend app path
`backend/apps/itsm_helpdesks/`

## Key concepts
- **`Helpdesk`** — unique `name`, unique `key` (2–5 uppercase, `KEY_VALIDATOR ^[A-Z][A-Z0-9]{1,4}$`),
  `description`, `icon`, `color`, `status` (active/inactive/archived), `order` (global Home-card sort,
  migration `0002`), `created_by`. The `key` is the **per-helpdesk ticket-number prefix**: helpdesk
  `IT` → projects `ITINC`/`ITREQ` → tickets `ITINC-1`. Kept ≤ 5 chars so `<key>INC` still fits
  `Project.KEY_VALIDATOR` (≤ 10). **Disable** (reversible) via `status='inactive'`; **retire** via
  `status='archived'` — never soft delete (`BaseModel.soft_delete()` doesn't cascade).
- **`HelpdeskMembership`** — `(helpdesk, user)` with `role_in_helpdesk` (member/lead) + `is_active`.
  Unique `(helpdesk, user)`; mirrors `itsm_groups.GroupMembership`. Active membership of an active
  helpdesk = access.
- **`services.py` = the scoping primitives.** Every ticket-facing query across the product reuses
  `accessible_helpdesk_ids(user)` (`None` = unrestricted/superuser; `[]` = nothing) and
  `resolve_helpdesk_scope` (clamps the advisory `?helpdesk=` to the accessible set — never widens,
  never 403s). These live in shared services, NOT only in `TicketViewSet.get_queryset`.

## Frontend path / pages
The agent app lives under `app/(agent)/agent`. `components/shell/agent-shell.tsx` is
**context-aware** (keyed off `usePathname`) and renders ONE header per state:
- `/agent` — the agent **Home** ("Select Helpdesk"). A *minimal* top bar (company logo `/logo.webp`
  + "One Helpdesk" wordmark via `components/shell/brand-mark.tsx`; a **Tenant-Settings gear** for
  managers; profile menu carrying theme + sign-out) over a **brand gradient welcome hero** + a
  **card per accessible helpdesk** (icon from the seeded `helpdesk.icon` via `lib/itsm/icon-map.tsx`)
  + a right-side attention rail (SLA / approvals / assigned — still static) and a Service Portal card.
  - **Decluttered (2026-06-25):** Home dropped the Canned-Responses + Administration card grids and
    collapsed the KB grid to a single **"Knowledge Base"** card (→ `agentKb`); canned responses moved
    into per-helpdesk Settings, and the admin surfaces into the gear (Tenant Settings) — see below.
  - The minimal bar (now used for `/agent/kb`, `/agent/approvals`, `/agent/reports`, `/agent/admin`)
    carries the shared **`components/shell/app-switcher.tsx`** (Home + switch helpdesk) on every state
    **except exact Home**; the switcher is provider-independent (reads `useItsmAuth` + `useParams`),
    so it also serves the workspace header.
- `/agent/w/[helpdeskKey]/...` — inside a helpdesk. AgentShell renders **no bar**; instead a **single
  consolidated sticky header** (`components/agent/workspace/workspace-header.tsx`, rendered by
  `workspace-chrome.tsx` inside `WorkspaceProvider`): app-switcher (the shared
  `components/shell/app-switcher.tsx`, switch helpdesk / Home) · helpdesk icon+name · Dashboard +
  per-project tabs (`workspace-tabs.tsx`) ·
  **Create** dropdown (`create-menu.tsx` → a project's new-ticket form) · pending-approvals badge
  (`approvals-bell.tsx` → `/agent/approvals`) · notifications · **Config** (→ settings) · profile.
- **Full-width responsive working surface (2026-06-21).** Both agent `<main>`s are **fluid
  full-width with adaptive gutters and no `max-w-*` cap**: `workspace-chrome.tsx`
  (`w-full px-3 py-6 sm:px-6 lg:px-8`, wraps queue/dashboard/detail/project pages) and
  `agent-shell.tsx` (`w-full px-4 py-6 sm:px-6 lg:px-8`, wraps Home/approvals/reports). Header
  gutters are aligned to the body (`workspace-header.tsx` `px-3 sm:px-6 lg:px-8`) so the
  app-switcher/Create cluster line up with the page edges at every breakpoint. The queue table
  (shadcn `relative w-full overflow-auto`) then fills the viewport and scrolls horizontally on
  mobile. **Settings** (`settings/layout.tsx` `max-w-6xl`, centred), **helpdesk admin**
  (`max-w-4xl`), the **create form** (`max-w-5xl`) and the **end-user portal** (`max-w-5xl`) keep
  their caps **on purpose** — form/config/reading line length stays legible; full-width is scoped
  to the agent queue/dashboard/detail.
- The selected helpdesk is the **URL route param** (`/agent/w/IT`), resolved by
  `WorkspaceProvider`/`useWorkspace` (`workspace-provider.tsx`) from `useItsmAuth().user.helpdesks`;
  it threads to the API as the advisory `?helpdesk=<key>` (server always re-clamps).
- **Settings hub (built)** — the **Config** button opens `agent/w/[helpdeskKey]/settings`: a left-rail
  nav (`settings/layout.tsx` + `settings-nav.tsx`) + card-grid landing (`settings/page.tsx`) over two
  categories — **HelpDesk Configuration** (`settings/helpdesk` edits name/**prefix**/icon/colour/status;
  `settings/calendar` = shared business calendars; `settings/groups` = assigned groups;
  `settings/canned-responses` = this helpdesk's canned responses, added 2026-06-25) and **Project
  Configuration** (`settings/projects` + per-project 5-tab config). Editing the **ticket prefix (`key`)**
  is allowed with a confirm dialog: existing tickets keep their stored numbers (e.g. `ITINC-1`) — only new
  ones use the new prefix — and the form `router.replace`s to the new `[helpdeskKey]` URL after save. After
  any edit the form calls `useWorkspace().refresh()` so the header/switcher update live.
- **Tenant Settings hub (2026-06-25)** — the Home **gear** (`agent-shell.tsx`) now opens
  `/agent/admin` (`adminHome`), a **master/detail** surface (`agent/admin/layout.tsx` left-rail
  `components/admin/tenant-settings-nav.tsx` + landing `agent/admin/page.tsx`) consolidating the org-wide
  admin pages — **Users** + **Roles & Permissions** (`itsm.admin.roles`) and **Helpdesks**
  (`itsm.admin.helpdesks`). It renders beneath the minimal bar (app-switcher → Home). The gear's gate
  widened to `isSupervisor || itsm.admin.helpdesks:update/create || itsm.admin.roles:read/create/update`.
  The three `agent/admin/{users,roles,helpdesks}` pages dropped their standalone back-link/title (the
  nav provides context); URLs are unchanged.
- **Helpdesk admin** — `/agent/admin/helpdesks` (now inside the hub above).
  `components/admin/helpdesks-admin.tsx`: **create** (`helpdesk-create-dialog.tsx`), **enable/disable**
  (a `Switch` → `PATCH status` active↔inactive), and **drag-reorder** (`@dnd-kit` → `helpdesksApi.reorder`).
  After every change it calls `refreshUser()` so Home reflects it. Per-helpdesk name/icon/colour + members
  stay in the per-helpdesk Settings (each row links there).

## API clients
`/api/v1/itsm/helpdesks` (+ `members` / `add_member` / `remove_member` actions),
`/api/v1/itsm/helpdesk-memberships`. The `?helpdesk=<id|key>` param is advisory and threads
through ticket/report/dashboard/SLA endpoints.

## RBAC module codes
- `HelpdeskViewSet` + `HelpdeskMembershipViewSet` → **`itsm.admin.helpdesks`** (parent `itsm.admin`):
  Supervisor full; **Agent read-only** (added to `AGENT_RO_MODULES`).

## Key files
- `models.py` — `Helpdesk`, `HelpdeskMembership`, `HelpdeskStatus`, `KEY_VALIDATOR`.
- `services.py` — `accessible_helpdesk_ids`, `resolve_helpdesk_scope`, `scope_ticket_queryset`,
  `is_project_accessible`, `helpdesk_member_ids`, `build_helpdesk_membership`.
- `views.py` — `HelpdeskViewSet` (read/write serializer split, member actions), `HelpdeskMembershipViewSet`.
- `serializers.py` — `HelpdeskSerializer` / `HelpdeskWriteSerializer` / `HelpdeskMembershipSerializer`.
- `urls.py` — registers `helpdesks`, `helpdesk-memberships`.
- `seed.py` — `run()` seeds IT + HR; `seed_memberships()` enrolls role-assigned non-superusers.
