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
```

### 3.3 Create Ticket (`components/tickets/Create/`) — 3‑step wizard
```
CreateWizard
├── Step 1: TicketTypePicker (project → type)
├── Step 2: TemplatePicker (optional; TicketTemplate prefill — M7)
└── Step 3: DynamicTicketForm
    ├── built from FieldLayout (runtime Zod) — M3
    └── FieldControl registry (text, multiline, number, date, dropdown, multiselect,
        checkbox, radio, user_picker, group_picker)
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
