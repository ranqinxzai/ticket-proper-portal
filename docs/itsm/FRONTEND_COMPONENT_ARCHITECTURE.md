# Frontend Component Architecture — ITSM Platform

Next.js 14 (App Router) + React 18 + TypeScript + Tailwind + shadcn/ui. A **standalone `(itsm)` route group** with its own JWT `ApiClient`, auth provider, app shell, and typed per‑domain API modules — all newly written, independent of the host repo's other apps.

> Status: the backend M0/M1 is built; the `(itsm)` frontend is authored milestone‑by‑milestone. This document is the target architecture (aligned to the plan), with library choices and the component tree.

---

## 1. Folder Structure

```
frontend/
  app/
    login/                      ← public; obtains JWT
    (itsm)/                     ← ItsmGuard → ItsmShell (auth required)
      layout.tsx                ← ItsmAuthProvider + ItsmGuard + ItsmShell
      page.tsx                  ← default queue
      queues/[queueId]/
      tickets/  (page · new · [key])
      projects/[projectKey]/
      dashboards/[id]/(edit)
      reports/[reportType]/
      admin/projects/[projectKey]/{fields,workflows/[id],slas/[id],notifications,groups,canned-notes,templates}
      admin/roles/
  lib/itsm/
    client.ts                   ← JWT ApiClient (fetch wrapper, refresh, error mapping)
    auth.tsx                    ← ItsmAuthProvider, useItsmAuth, ItsmGuard, permission helpers
    types.ts                    ← shared TS types (Ticket, Project, Workflow, …)
    filters.ts                  ← query_spec ↔ UI filter model helpers
    api/                        ← per-domain typed modules
      tickets.ts  projects.ts  groups.ts  workflows.ts  fields.ts
      sla.ts  notifications.ts  reports.ts  dashboards.ts  rbac.ts
  lib/store/                    ← Zustand UI stores (filters, selection, composer, layout)
  components/
    ui/                         ← shadcn primitives
    shell/                      ← AppShell, LeftNav, TopHeader, NotificationBell, CommandMenu
    tickets/                    ← Queue, TicketDetail, composer, panels, create wizard
    admin/                      ← field-designer, workflow-builder, sla-editor, notif-editor, …
    dashboards/                 ← grid, widget registry, widgets
    reports/                    ← ReportShell, charts
    common/                     ← shared bits (RAGPill, UserAvatar, EmptyState, …)
```

## 2. Auth & Data Layer

### 2.1 `ApiClient` (`lib/itsm/client.ts`)
- Thin `fetch` wrapper; attaches `Authorization: Bearer <access>`; base `/api/v1/itsm/`.
- Transparent **refresh**: on 401, calls `/auth/refresh` once and retries; on failure, clears tokens → redirect to `/login`.
- Maps error bodies to typed errors so screens can render 400 field errors, **409** stale‑button, **422** transition‑validator errors, **403** permission‑denied consistently.

### 2.2 `ItsmAuthProvider` / `ItsmGuard` (`lib/itsm/auth.tsx`)
- On mount: hydrate tokens, call `/auth/me`; store `user` + **permission map**.
- `ItsmGuard` blocks render until authenticated; redirects to `/login` otherwise.
- `can(module, action)` helper reads the permission map → gates nav items, buttons, routes. Mirrors backend `check_permission` (closest‑ancestor semantics) for UI parity; the server remains the source of truth.

### 2.3 Data fetching
- **Server state:** `@tanstack/react-query` over the typed `api/*` modules — caching, pagination, optimistic updates for inline edits (assign/transition/status PATCH), invalidation on mutation.
- **UI state:** **Zustand** stores for ephemeral UI (active filters, table selection for bulk bar, composer draft, dashboard layout in edit mode).
- **Forms:** `react-hook-form` + **Zod**; the create form builds a **runtime Zod schema from the field layout** (M3).

## 3. Component Tree (top‑level)

```
ItsmShell
├── TopHeader
│   ├── CommandMenu (cmdk, ⌘K)            → search tickets / navigate
│   ├── NotificationBell → InboxPopover    → in-app notifications (M6)
│   ├── ProjectSwitcher
│   └── UserMenu
├── LeftNav (permission-gated items)
└── <route content>
```

### 3.0 Implemented agent shell (as-built — supersedes the planned tree above)

The shipped agent app lives under `app/(agent)/agent` (not `(itsm)`), product name **One Helpdesk**.
`components/shell/agent-shell.tsx` is **context-aware** (keyed off `usePathname`) and renders exactly
ONE header per route state — never two stacked bars:

```
(agent)/layout.tsx → ItsmAuthProvider → AgentGuard → AgentShell
  AgentShell
  ├── /agent · /agent/approvals · /agent/reports  → MINIMAL bar
  │     ├── BrandMark (components/shell/brand-mark.tsx)  /logo.webp + "One Helpdesk" (img onError fallback)
  │     ├── [managers only] gear → /agent/admin/helpdesks  (create/disable/drag-reorder helpdesks)
  │     └── UserMenu (profile; theme switch folded inside; sign-out)
  │     └── Home body: "Select Helpdesk" cards (icon via lib/itsm/icon-map.tsx) + attention rail
  └── /agent/w/[helpdeskKey]/...                   → AgentShell renders NO bar; instead:
        WorkspaceProvider → WorkspaceChrome → WorkspaceHeader (single consolidated sticky bar)
        ├── AppSwitcher (app-switcher.tsx)         switch helpdesk / Home
        ├── helpdesk icon + name (ItsmIcon)
        ├── WorkspaceTabs (workspace-tabs.tsx)     Dashboard + one tab per project
        └── right cluster: CreateMenu (create-menu.tsx) · ApprovalsBell (approvals-bell.tsx, count →
            /agent/approvals) · NotificationBell · Config (→ settings) · UserMenu
```
Why context-aware: the consolidated bar needs `useWorkspace()` (helpdesk + projects), which only exists
inside the workspace layout — deeper than `AgentShell`. So the workspace bar is owned by
`WorkspaceChrome` while `AgentShell` returns bare `{children}` on `/agent/w/*`. Icons come from the
seeded kebab lucide names on `helpdesk.icon`/`project.icon` via the `lib/itsm/icon-map.tsx` registry.

**Layout width (updated 2026-06-21).** Both agent `<main>` surfaces are **fluid full-width with
adaptive gutters and no `max-w-*` cap** — `WorkspaceChrome` `<main>` = `w-full px-3 py-6 sm:px-6 lg:px-8`
(queue/dashboard/detail), `AgentShell` `<main>` = `w-full px-4 py-6 sm:px-6 lg:px-8` (Home/approvals/
reports). Header gutters were aligned to the body so the leftmost header item and the Create cluster
line up with the page edges at every breakpoint (the queue previously sat in a centred ~1280px column
under a full-bleed header — a visible stagger). The agent **working surface** therefore uses the whole
viewport and adapts on resize. Surfaces that read better constrained keep their own caps **by design**:
Settings (`settings/layout.tsx` `max-w-6xl`, centred), helpdesk admin (`max-w-4xl`) and the end-user
portal (`portal-shell.tsx` `max-w-5xl`). The agent **create form** is full-width too (2026-06-22): it
dropped its `max-w-5xl` cap and uses the detail view's `lg:grid-cols-[minmax(0,1fr)_320px]` (flexing Main
+ fixed 320px Sidebar); a no-sidebar layout keeps a centred `max-w-2xl` single column. Ultra-wide polish: queue
summaries `line-clamp-1`, Home cards scale `sm:2 → xl:3 → 2xl:4`, Reports bar lists cap at `max-w-2xl`.

**Login (`app/(auth)/login/page.tsx`)** — a split screen: a branded `LoginHero`
(`components/auth/login-hero.tsx`, ONE-LEARN pink→violet→cyan gradient + headline + feature chips;
optional photo override at `public/login-hero.{webp,png,jpg}`) on the left (`lg` and up), and the
sign-in form on the right at `clamp(360px,38%,520px)` — full-width below `lg`. The form header uses the
same `BrandMark` (company logo + "One Helpdesk", fallback-safe). A standalone `ThemeToggle` stays on the
page (the theme e2e selects its "Dark" radio here).

### 3.1 Ticket Queue (`components/tickets/Queue/`)
```
QueueView
├── QueueToolbar (saved-queue selector, QuickFilterPills, FilterBuilder, ColumnPicker, GroupBy)
├── TicketTable  (@tanstack/react-table + @tanstack/react-virtual)
│   └── columns: number, summary, StatusPill, PriorityTag, AssigneeCell, GroupCell, SLARagPill, updated
└── BulkActionBar (sticky; appears on selection; gated by itsm.tickets.bulk)
```
- Filters serialize to `query_spec` and map to DRF `filterset_fields`/`search`/`ordering`.
- Virtualized rows keep large queues smooth.

> **BUILT (compact toolbar, 2026-06-21):** the queue header is **2 rows**, not the stacked ~4 it was.
> Row 1 (`ticket-queue.tsx`) = project title + search box + **New ticket**; row 2 (`filters/filter-bar.tsx`)
> = the saved-views menu + filter chips + **More filters** + **Save view** + **Clear all** flattened
> into one wrapping `flex` row (all left-grouped — no `ml-auto`, so the row wraps as a unit under heavy
> filtering rather than stranding the actions on a 3rd line). Search moved from `FilterBar` up to row 1.

### 3.2 Ticket Detail (`components/tickets/Detail/`) — JSM 2‑pane
```
TicketDetail
├── DetailHeader (number, summary inline-edit, breadcrumb)
├── LeftPane
│   ├── DescriptionBlock (inline-edit, sanitized HTML)
│   ├── Tabs: Comments | Worklog | History | Files
│   │   ├── CommentsTab (Public/Internal toggle; private hidden without grant)
│   │   ├── HistoryTab (ActivityFeed ← /activity)
│   │   └── FilesTab (attachments)
│   └── Composer (Tiptap + mention; PublicInternalToggle; CannedNoteInserter)
└── RightPane (DetailsPanel)
    ├── StatusControl (+ TransitionMenu ← /available-transitions, TransitionDialog screen)
    ├── AssigneeControl / GroupControl (→ /assign)
    ├── PriorityControl
    ├── SLAWidgets (countdown + RAG; ticks locally from due_at — M5)
    ├── WatchersWidget · LinkedTicketsWidget
    └── CustomFieldsPanel (from layout — M3)

> **BUILT:** `components/tickets/ticket-detail.tsx` is **layout-driven** (read-only) — it resolves the
> project's `FieldLayout` and renders fields in the Main/Sidebar columns + sections exactly like the
> create form (Description as prose, Attachments as a file list, value-backed fields from
> `custom_fields`). Summary is the page title; Status/Type/Workflow/Created are a fixed meta block.
> So the layout config drives BOTH the create form and the ticket detail. Inline field editing on the
> detail page is a later milestone (today: transitions + comments + status meta).
```

### 3.3 Create Ticket (`components/tickets/Create/`) — 3‑step wizard
```
CreateWizard
├── Step 1: TicketTypePicker (project → type)
├── Step 2: TemplatePicker (optional; TicketTemplate prefill — M7)
└── Step 3: DynamicTicketForm (BUILT — `components/tickets/ticket-create-form.tsx`)
    ├── resolves FieldLayout (`layoutsApi.resolve`) → two-pane render:
    │   Main column (left, half/full-width grid) + Sidebar column (right, stacked)
    │   per item `region`/`width`; rich-text is always full-width in Main
    ├── honours order, sections, required, hidden, conditional show/read-only rules
    └── FieldControl registry (text, multiline, richtext→textarea, number, date, datetime,
        dropdown, radio, checkbox, multiselect, user_picker, group_picker, cascade, attachment)
```

### 3.4 Admin (`components/admin/`)
| Screen | Key components | Library |
|---|---|---|
| **Field & Layout Designer** | `LayoutCanvas`, `FieldPalette`, `FieldEditorDrawer` | `@dnd-kit` |
| **Visual Workflow Builder** | `WorkflowCanvas`, `StatusNode`, `TransitionEdge`, `Inspector` | `@xyflow/react` (React Flow) |
| **SLA Policy Editor** | `CalendarEditor`, `MetricEditor`, `EscalationEditor` | shadcn + `react-day-picker` |
| **Notification Scheme Editor** | `RuleList`, `RecipientPicker`, `EmailTemplateEditor` (Tiptap) | Tiptap |
| **Groups & Routing** | `GroupTable`, `MembershipEditor`, `RoutingRuleBuilder` | react-table |
| **Roles & Permissions** | `RoleEditor`, `ModuleTree`, `PermissionGrid` | react-table |

### 3.5 Dashboards (`components/dashboards/`)
```
DashboardView / DashboardBuilder
├── GridLayout (react-grid-layout; drag + resize in edit mode)
└── WidgetRegistry → KPIWidget, PieWidget, BarWidget, TrendWidget, SLAGaugeWidget, TicketListWidget
                     (Recharts; backed by SavedFilter.query_spec — M10)
```

### 3.6 Reports (`components/reports/`)
```
ReportShell
├── ReportFilters (date range, project/group, group-by)
├── ChartArea (Recharts)
├── DataTable
└── CsvExportButton
```

**AS-BUILT (no Recharts / no react-grid-layout added):** the Reports page and the workspace
"command center" Dashboard are implemented with **hand-rolled SVG** in
`components/reports/report-views.tsx` — no charting dependency was added. The shared primitives are:
`ReportCard`, `BarList`, `StatTile`, `MiniTable`, `TrendChart` (original set) plus the command-center
set `KpiCard` (+ `Sparkline`/`DeltaBadge`/`pctChange`), `DonutChart`, `GaugeChart` (semicircular SLA
gauge), `DualTrendChart` (created-vs-resolved overlay), `AlertTile`, and `CHART_PALETTE` (the
`--chart-1..6` theme tokens). The dashboard (`…/w/[helpdeskKey]/dashboard/page.tsx`) is a curated fixed
layout consuming the `itsm-reporting` endpoints — **not** the `Dashboard`/`Widget` model-backed
drag-and-drop builder, which remains planned (§3.5). State is fetched server-side via `reportsApi`;
period-over-period deltas are derived client-side by splitting a `days × 2` trend series.

## 4. Library Choices & Rationale

| Library | Used for | Why |
|---|---|---|
| **Next.js 14 App Router** | routing, layouts, the `(itsm)` group | Standalone shell, nested layouts, server/client split, fast nav. |
| **shadcn/ui + Tailwind** | primitives & styling | Owned components (copy‑in), themable, accessible, no runtime lock‑in. |
| **@tanstack/react-query** | server state | Caching, pagination, optimistic inline edits, mutation invalidation. |
| **Zustand** | UI state | Minimal, ephemeral UI (filters/selection/composer/layout) without prop drilling. |
| **react-hook-form + Zod** | forms & validation | Performant forms; runtime Zod generated from field layout for dynamic forms. |
| **@tanstack/react-table + react-virtual** | ticket queue | Headless table + virtualization for large queues. |
| **@xyflow/react** (React Flow) | workflow builder | Node/edge canvas mapping cleanly to Status/Transition (`canvas_x/y`). |
| **@dnd-kit** | layout designer / palettes | Accessible drag‑and‑drop for the field layout. |
| **react-grid-layout** | dashboard grid | Draggable/resizable widget grid. |
| **Recharts** | charts | Reports + dashboard widgets. |
| **Tiptap (+ mention)** | rich text | Comments, descriptions, email templates; emits clean HTML (server still sanitizes). |
| **cmdk** | ⌘K palette | Global search / navigation. |
| **date-fns + react-day-picker** | dates | Calendars, ranges, business‑hours editing. |
| **sonner** | toasts | Lightweight notifications for actions. |

## 5. Cross‑Cutting Frontend Patterns
- **Permission gating** everywhere via `can(module, action)`; never render an action the role can't perform — but the server still enforces.
- **Optimistic inline edits** on assign/priority/status with rollback on error (esp. 409 stale‑button → refetch + re‑present transitions).
- **Error UX:** 409 ⇒ "ticket moved, refresh"; 422 ⇒ field‑level errors on the transition dialog; 403 ⇒ disabled control + tooltip.
- **Sanitized HTML render:** stored bodies are server‑sanitized, rendered via `dangerouslySetInnerHTML` safely.
- **Skeletons + empty states + a11y** as standard (M11 polish), plus error boundaries per route segment.
