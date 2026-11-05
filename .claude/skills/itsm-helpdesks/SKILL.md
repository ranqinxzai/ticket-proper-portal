# itsm-helpdesks

## Update (2026-11-05c) — Modern by default; menu logo, icon pin, no flicker
- **Default:** agents with no saved choice get **Modern**: `TenantInterfaceConfig.ui_default` default `modern` (`itsm_rbac 0018`,
  default only), `_PUBLIC_INTERFACE_DEFAULT`, `resolveUi`, `DENSITY_SCRIPT` (only `itsm-ui = "classic"` gives Classic) and
  `readUi`. `InterfaceSync` now writes `itsm-ui` on every resolve (`persistUi`). Profile menu → Interface → Classic is saved on
  the account. Copy: Classic = "the previous layout" (`ui-toggle.tsx`, admin form, `INTERFACE_HELP`).
- **Logo:** `RailBrand` (`modern-rail.tsx`) is the first row of the menu head inside and outside a helpdesk: the tenant logo at
  32px — folded, a 40px clip shows its left end (GridCrest's round mark); open, the whole logo; no logo → company name; no
  branding → the OneDesk mark. Uses `useBranding()` (exported from `company-brand.tsx`, same module cache). The Modern top
  bar no longer shows `CompanyBrand`; Classic headers and the portal still do.
- **Pin:** `RailPinButton` is icon-only (40×32, `aria-label` Pin menu open / Unpin menu, `aria-pressed`, tooltip) in the same
  footer spot folded and open.
- **Hold:** `useRailState` has `held` + `hold(open)` (+ `panelRef`), in `useRail()`. `UserMenu` and `AppSwitcher` take an additive
  `onOpenChange`; the rail passes `hold`, so the rail stays open while their menus are open (the modal menu's
  `pointer-events:none` used to fire `pointerleave` → fold → menu jumps → re-expand = flicker). Focus opens the rail only for
  `:focus-visible`; Esc inside a held menu doesn't blur the rail.
- QA: `docs/QA_CHECKLIST.md` "Batch 2026-11-05c".

## Update (2026-11-05) — Modern shell (step B2): icon rail, 44px top bar, ⌘K, Interface org setting
- **Chrome branch (Classic untouched):** `WorkspaceChrome` → `useUi().ui === "modern"` ? `ModernWorkspaceChrome` :
  `ClassicWorkspaceChrome` (today's sidebar, its `itsm-sidebar-collapsed` / `itsm-sidebar-width` prefs and resize handle);
  `AgentShell` (outside a helpdesk) → `ModernAgentChrome` in Modern. The `<main>` body (loading / not-a-member / page) is
  `workspace-body.tsx`, shared by both.
- **Rail** (`components/agent/workspace/modern-rail.tsx`): `useRailState` (hover 140/220 ms, focus opens, Esc / pick folds,
  pin in `itsm-rail-pinned`), `Rail` (in-flow placeholder `w-nav-rail`/`w-sidebar` + absolute panel, `z-[45]`, overlay
  shadow `shadow-soft-lg`), `RailItem` (one `<Link>`, label `sr-only` folded, `Hint disabled={expanded}`, `aria-current`
  marker, optional badge / shortcut), `RailSub`/`RailSubItem` (mounted, `hidden` folded), `RailSection`, `RailPinButton`,
  `RailBack`. Workspace items + gates mirror `workspace-nav.tsx`; Approvals uses `usePendingApprovals`. `Hint` gained an
  additive `disabled` prop (keeps the tooltip in the tree without opening it).
- **Top bar** (`modern-topbar.tsx`): breadcrumb (`workspace-crumbs.tsx` — `WorkspaceCrumbs` / `AgentCrumbs`, built from
  the URL; settings labels from the now-exported `buildGroups`) + `HeaderTitleOutlet`, centred `CompanyBrand` (xl+),
  `HeaderActionsOutlet`, `SearchButton` (⌘K), then Create / Help / Notifications; below lg the Classic drawer menu,
  ApprovalsBell and avatar menu (mounted only there — `useMediaQuery`).
- **Header slot** (`components/shell/header-slot.tsx`, provider in `app/t/[org]/(agent)/layout.tsx`): `PageHeader` (now
  `"use client"`) portals its `<h1>` + actions into the bar in Modern on lg+; `descriptionInline` for live-status
  descriptions; inline (`InlinePageHeader`, unchanged markup) everywhere else.
- **Settings** layouts use `SettingsColumns` (`components/settings/settings-columns.tsx`): Classic grid byte-identical;
  Modern keeps the in-page column with "← Back to helpdesk / home".
- **Shortcuts** (`components/shell/shortcuts-host.tsx`, `command-palette.tsx`, `shortcuts-sheet.tsx`,
  `lib/itsm/use-global-shortcuts.ts`): ⌘K/Ctrl+K, `?`, G then D/T/A/E/S; palette = tickets (server search) + go to +
  actions (`>`). Account menu → "Keyboard shortcuts" in Modern.
- **Interface setting:** Tenant Settings → Organisation → "Interface: Classic or Modern" (`admin/interface/page.tsx`,
  `components/admin/interface-config-form.tsx`, help `INTERFACE_HELP` in `lib/itsm/help/admin.ts`, nav helper
  `adminInterface`). Resolution: `lib/itsm/interface-settings.ts` (`useInterfaceConfig`, `resolveUi`) +
  `components/theme/interface-sync.tsx`; `useUi()` gained `uiLocked`. Backend in itsm-rbac (2026-11-05).
- QA: `docs/QA_CHECKLIST.md` "Modern interface — step B2". Next: B3 Modern queue, B4 docked ticket (plan §14).


## Update (2026-11-05) — Interface switch: Classic | Modern (Modern step B1, token layer)
- **Why:** UI/UX benchmark vs Jira / Freshservice / ManageEngine (client: fonts large, space wasted, text
  "hard black"). Direction decided through mockups v1–v7 (`ui-designs/workbench-v7-2026-11.html`, approved
  2026-11-04): a docked "Workbench" layout, a soft-ink palette, hover-expanding pinnable menu, and a per-agent
  **Classic / Modern** switch because agents are used to the old menu. B1 ships the switch + tokens only.
- **Preference:** profile menu → **Interface** (Classic | Modern (New)); `components/theme/ui-toggle.tsx`,
  state in `density-provider.tsx` (`useUi()`, localStorage `itsm-ui`, **unset ⇒ classic** — changed 2026-11-05c: unset ⇒ modern). Portal hides it via
  the existing `showDensity={false}`.
- **Attributes (pre-paint, React never renders them):** `DENSITY_SCRIPT` now also sets `<html data-ui="modern">`
  (only when chosen) and `<html data-app="agent">` when `location.pathname` matches `/^\/t\/[^/]+\/agent(\/|$)/`;
  `AgentShell` has a `useLayoutEffect` (before its early return) that adds/removes `data-app` on soft navigation.
- **Scope:** every Modern rule is `html[data-app="agent"][data-ui="modern"]` (globals.css, light + `html.dark`
  block) or the `modern:` variant (`tailwind.config.ts`, 0,3,0). Reaches portaled dialogs/menus; never the
  portal, `/console` or login. **Classic is untouched** — rule 24 in `_CODING_RULES.md`.
- **Tokens:** Modern overrides the ink/secondary/border/input/muted/accent/primary-ink/status colours (Jira's
  current neutrals on the brand pink; values and sources in the globals.css comment), `--radius` 0.5rem, and two
  new tokens that Classic defines at `:root` with the old literals: `--radius-xl` (`rounded-xl` → `var(--radius-xl)`)
  and `--shadow-soft` / `--shadow-soft-md` (`shadow-soft*` → vars; Modern `0 0 #0000`). Modern also repeats the
  compact geometry vars on `html[…][data-density="compact"]` so portals densify, and renders `.font-semibold` as
  500 except `h1` (`@layer utilities`).
- **Next steps:** B2 shell (rail hover/pin, breadcrumb title, Interface org setting + one migration), B3 queue,
  B4 docked ticket … see `~/.claude/plans/can-you-check-the-graceful-blum.md` §11–12 and QA_CHECKLIST
  "Modern interface — step B1".


## Update (2026-10-19) — Assets in the workspace chrome
- Sidebar (`workspace-nav.tsx`): new **Assets** section (Asset Dashboard / Asset List / Asset Report) after Insights, gated on `itsm.assets` read.
- Settings nav (`settings-nav.tsx`, `buildGroups(base, {assets})`) + `settings/page.tsx`: an **Asset Configuration** group (Categories & Fields, Statuses, Vendors, Locations, Departments), shown with `itsm.assets.config` read. The sidebar's Configuration link is still admin-only, so asset pages carry a **Configure** button.
- Assets, categories and fields are per helpdesk (`Helpdesk.key` is the auto-tag prefix); statuses and masters are org-wide. See **itsm-assets**.

## Update (2026-10-19) — AA-safe brand ink on tints (N14)
- **New theme token `--primary-ink`** (`globals.css`): `338 100% 38%` light, the same as `--primary` in dark. It is exposed as Tailwind `text-primary-ink` (`primary.ink`).
- **Rule:** text that sits on a pale primary tint (`bg-primary/5|10|15`: active sidebar/portal nav item, chips, badges, mention chips) uses `text-primary-ink`.
  - The exact brand pink (#E60053, `text-primary`) only gets 3.6–4.3:1 there.
  - The ink gives about 5.2:1 on `/10` and 4.8:1 on `/15`.
  - Buttons, fills and links on white keep the exact brand pink (4.69:1 on white).
  - 22 tinted spots were switched by rule.
- **Section headings in the sidebar** (`workspace-nav.tsx`) and the "· None" label (Linked issues) are full `text-muted-foreground`. Opacity variants (`/40–/80`) are only for decorative icons and separators, which WCAG exempts.
- Supersedes the brand-pink "known AA trade-off on pink-on-tint".

## Update (2026-10-18) — Bug-fix batch: create provisions lead + standard projects, inactive edit, portal read-only viewers, password reset
- **B23.** `HelpdeskViewSet.perform_create` makes the creator a **lead** member. The write-only `with_standard_projects` (dialog checkbox, on by default) imports INC + REQ from the standard catalog; import errors are non-fatal.
- **U10.** Admin home has a User Attributes card. `components/admin/helpdesk-edit-dialog.tsx` edits inactive helpdesks.
- **Portal (U3/U13).** Approvers and watchers can open a request **read-only** (`portal_viewable_tickets`, `viewer_role`). Reply, reopen, watchers, upload and feedback are requestor-only. Back link by role. "My requests" stays requestor-only.
- **Portal Approvals.** The nav, home card and agent approvals bell are gated on `itsm.portal.approvals` read; users with no role still see them.
- **Portal create (U13).** No P3 pre-select; option-less fields are hidden.
- **Login / reset (U14).**
  - The label is "Username or email".
  - New pages `(auth)/forgot-password` and `(auth)/reset-password`, backed by `POST itsm/auth/password-reset/` (+ `validate/`, `confirm/`).
  - Links last 60 min, work once, and are bound to the org schema.
  - No email for bots, SSO users, unusable-password or inactive accounts.
- **Bell (U5):** also in the portal header, with per-item read and links.
- Supersedes:
  - the 2026-10-18 hover-help bullets "There is still no reset flow" (static "Contact your IT administrator" text) and "watchers … aren't told they were added, and can't open the request"
  - the corrected "nothing is seeded" helpdesk-create copy (now optional via the checkbox)
- Batch context: `docs/BUG_LOG.md` "2026-10-18 — Bug-fix batch"; QA: `docs/QA_CHECKLIST.md` "Bug-fix batch (added 2026-10-18)".

## Update (2026-10-18) — Hover help in the agent chrome, Service Portal and login
- Primitives: `ui/hint.tsx` (`Hint`), `ui/icon-button.tsx` (`IconButton`), `ui/info-tip.tsx` (`InfoTip`); copy in `lib/itsm/help/*`. Rules + verification: `docs/QA_CHECKLIST.md` "Hover help / tooltips (2026-10-18)". Behaviour mismatches found (not fixed) are listed in `docs/BUG_LOG.md` 2026-10-18 — tooltips describe the REAL behaviour.
- **Chrome**
  - Create menu, approvals bell, notification bell ("opening the list marks all read"), account menu, helpdesk switcher, mobile menu and the Collapse/Expand rail all have hints.
  - Truncated nav labels carry `title`.
  - The density toggle explains Compact vs Comfortable.
- **Portal** (`help/portal.ts`)
  - `StatusBadge hint={portalStatusHelp(key, category)}` gives plain-language status meanings.
  - Reopen copy promises no time window (`ReopenRule.window_days` isn't enforced).
  - The Watchers ⓘ says watchers get emails, aren't told they were added, and can't open the request.
  - Add file says files can't be deleted.
  - Feedback buttons carry each point's meaning (`surveyPointLabel`). Submit says why it's disabled, including the `comment_required` rule.
  - The mobile "Agent home" link now has an accessible name.
- **Login**
  - Neutral subtitle.
  - The "Username" ⓘ says email works too (case-insensitive).
  - Static text "Forgot your password? Contact your IT administrator." There is still no reset flow.
- `FIELD_HELP.priority` is plain-language for both audiences and mentions the Impact × Urgency auto-calculation.

## Update (2026-07-24) — Standard-project import is the provisioning path for new helpdesks
- A helpdesk created from the UI still starts with **zero projects** (`HelpdeskViewSet.perform_create`
  deliberately seeds nothing; only org-provisioning `seed_itsm` auto-seeds Incident+Request for the
  helpdesks that exist at that moment). The gap is now closed by the **standard-project catalog**:
  Settings → Projects → **Import standard project** provisions Incident / Request / **Problem** into
  any active helpdesk, one-per-helpdesk, with the full engine chain (workflow, ticket types, layout,
  notification scheme, survey config, membership grants; Problem = no SLA + portal-hidden). See
  **itsm-projects** (2026-07-24) for the service/API. No Helpdesk model change.

## Update (2026-07-15) — Helpdesk-level default columns for the "All Tickets" queue
- New **`Helpdesk.combined_queue_columns`** (JSONField, default `[]`, migration
  `0004_helpdesk_combined_queue_columns`, TENANT → per-org `migrate_schemas`) — the **admin default**
  column layout for this helpdesk's cross-project **All Tickets** queue (built-in + `cf:<key>` keys;
  empty ⇒ `COMBINED_DEFAULT_COLUMNS`). Previously that queue had **no** server-side default — columns were
  per-user localStorage only. Precedence is now **agent localStorage override → this field → built-in
  default** (`resolveCombinedColumns` gained the middle tier); agents keep their personal override.
- Exposed on `HelpdeskSerializer` (read) + `HelpdeskWriteSerializer` (write, gated `itsm.admin.helpdesks`);
  **`validate_combined_queue_columns`** narrows to built-ins + the `cf:` **union** of the helpdesk's active
  projects (shared `filter_fields.clean_queue_columns`). Added to the slim `/me` payload
  (`build_helpdesk_membership`) so `useWorkspace().helpdesk` carries it — the combined queue applies it
  with no extra fetch.
- **New settings page** `settings/columns` ("All-Tickets Columns", in the **HelpDesk Configuration** nav
  group + landing card) renders the shared `QueueColumnEditor` via `CombinedColumnLayoutEditor`
  (fields = helpdesk union; save → `helpdesksApi.update` → `useWorkspace().refresh()`). See **itsm-tickets**
  / **itsm-projects** / **itsm-fields** (2026-07-15).

## Purpose
The department/workspace layer above Projects. A `Helpdesk` (IT, HR, Facilities, …) is a
workspace that owns its own default Incident + Request projects, its own Service Desk group,
and an explicit member roster. **Membership is the row-level scope every ticket-facing query is
clamped to** — an IT agent never sees an HR ticket. Three helpdesks are seeded: **IT**, **HR**,
and **Facilities** (FAC). This app is the rename of "ITSM" → **One Helpdesk**: multiple departments
share one platform.

## Update (2026-06-28) — Membership now gates the agent app, not just data
Active helpdesk membership is now required to **enter the agent app at all**, not only to see tickets.
New frontend helper **`hasHelpdeskAccess(user)`** (`lib/itsm/nav.ts`) = superuser OR ≥1 active membership;
**`AgentGuard`** (`lib/itsm/auth.tsx`) renders a blocking **"No helpdesk assigned — contact your
administrator"** screen (`NoHelpdeskScreen`, sign-out only — no menu, no Home cards, no workspace) when a
roled agent/lead/admin has zero helpdesks. Superusers are exempt; pure `requestor`s still route to the
portal (unchanged via `isAgentUser`). `isAgentUser` is deliberately **unchanged** so a roled, zero-helpdesk
user still lands *in* the agent app (where the blocking screen shows) rather than being bounced to the
portal. This is a **UI gate** — the backend already returns empty/scoped data for such a user
(`accessible_helpdesk_ids` ⇒ `[]`), so no server change. Helpdesk assignment at user creation stays
**optional** (the Add-user dialog shows an amber soft-hint when a non-requestor role has no helpdesk ticked,
but never blocks submit). Impact: a **non-superuser admin** needs ≥1 helpdesk to reach `/agent/admin/*`; the
superuser is the bootstrap. See **itsm-rbac** (Agent-app access requires a helpdesk).

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
  per-project links — *(since the 2026-07-02 UI overhaul these live in the collapsible LEFT SIDEBAR,
  `workspace-nav.tsx`; `workspace-tabs.tsx` is dead code and the header only carries the mobile
  helpdesk name, the optional centred CompanyBrand and the right cluster)* ·
  **Create** dropdown (`create-menu.tsx` → a project's new-ticket form) · pending-approvals badge
  (`approvals-bell.tsx` → `/agent/approvals`) · notifications · **Config** (→ settings) · profile.
- **Density toggle + chrome tokens (2026-10-15).** Customer feedback "optimize the GUI free space".
  - **Preference:** profile menu → **Density** (Comfortable | Compact; `components/theme/density-toggle.tsx`,
    provider `density-provider.tsx`, wrapped in `app/layout.tsx`). localStorage `itsm-density`; **unset ⇒
    compact** (the default). A pre-paint `DENSITY_SCRIPT` sets `<html data-density>` (no flash; React
    never renders the attribute, like `.dark`). The portal's UserMenu passes `showDensity={false}`.
  - **Scope:** effects apply only under `[data-shell="agent"]` — set on the AgentShell root and the
    WorkspaceChrome root (they never nest). Portal, `/console`, login and portaled popovers/dialogs/
    sheets keep comfortable values.
  - **Single source of truth for chrome geometry** — CSS variables in `app/globals.css` (`:root` =
    comfortable = the pre-2026-10-15 values; compact overrides under `[data-density="compact"]
    [data-shell="agent"]`, with their own media queries for `--main-px`): `--header-h` 56/48px,
    `--main-px` 12·24·32 / 12·16·20px, `--main-py` 24/12px, `--sidebar-w` 256/224px, `--ctl-h` 36/32,
    `--ctl-h-sm` 32/28, `--cell-px/py` 12·12 / 10·6, `--th-h` 40/32, `--tabs-h` 36/32, `--tab-px` 12/8.
    Tailwind tokens (`tailwind.config.ts` spacing): `h-header`/`top-header`, `px-main-x`/`-mx-main-x`,
    `py-main-y`/`-my-main-y`, `w-sidebar`, `top-rail` (= header + main py, a calc — never a derived
    variable at `:root`). `lib/utils.ts` registers them with `extendTailwindMerge`.
  - **Primitives read the variables** (`ui/button|input|select|table|tabs`, `tickets/field-styles.ts`):
    `h-[var(--ctl-h)]`, `px-[var(--cell-px)] py-[var(--cell-py)]`, … so every agent table/control densifies
    and consumer overrides (`h-8`, `p-0`) still win via twMerge.
  - **`compact:` variant** = `:is([data-density="compact"] [data-shell="agent"] &)` for leaf spacing.
    Specificity 0,3,0 beats `sm:/lg:/hover:`; use `compact:lg:` only for breakpoint-gated layout;
    **never** inside `components/ui/*` (it would beat consumer overrides).
  - Header height lives on the OUTER `<header>` (`h-header`, border inside → exactly `--header-h`);
    WorkspaceHeader is z-40 (above the queue's z-30 bands). Sidebar collapse is read in a lazy
    `useState` (no flash; safe because AgentGuard means the chrome never server-renders).
  - **Caps policy (supersedes the paragraph below):** the Settings + Tenant-Settings shells dropped
    `mx-auto max-w-6xl` (full width; `px-1` kept; nav 220px / 200px compact; `lg:top-rail`), so wide
    tables (Users) and wide editors use the window. Single-column forms keep their own `max-w-xl/2xl`;
    multi-control editors widened (notifications `max-w-5xl`, routing + SLA `max-w-4xl`). The settings
    nav no longer repeats the helpdesk name. The portal keeps `max-w-5xl`.
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
