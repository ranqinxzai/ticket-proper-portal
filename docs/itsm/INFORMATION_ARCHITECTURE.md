# Information Architecture — ITSM Platform

How the product is organized: navigation, the route tree, the entity hierarchy, and the admin IA. The frontend lives in a standalone Next.js 14 App Router `(itsm)` route group, JWT‑guarded by `ItsmGuard` and framed by `ItsmShell`.

---

## 1. Global Navigation

### 1.1 Left navigation (primary)

```
┌──────────────────────────┐
│  ITSM                     │   ← product/brand
├──────────────────────────┤
│  ▸ Projects              │   itsm.projects (read)
│  ▸ Queues                │   itsm.tickets.queue
│  ▸ Tickets               │   itsm.tickets
│  ▸ Dashboards            │   itsm.dashboards / itsm.dashboard
│  ▸ Reports               │   itsm.reports
├──────────────────────────┤
│  ⚙ Administration        │   itsm.admin / itsm.projects.config (Supervisor)
└──────────────────────────┘
```

Nav items are **gated by the permission map** returned at login (`user.permissions`). An Agent sees Projects, Queues, Tickets, Dashboards, Reports; the **Administration** section is shown only when the user holds the relevant `itsm.admin.*` / config grants (Supervisor).

### 1.2 Top header

| Element | Purpose | Backing |
|---|---|---|
| **⌘K global search** (`cmdk`) | Jump to ticket by number/summary, navigate. | `GET /tickets?search=` |
| **Notification bell** (in‑app inbox popover) | Unread count + recent in‑app notifications, mark‑all‑read. | `itsm.notifications.inbox` (M6) |
| **Project / queue context switcher** | Switch active project or saved queue. | `GET /projects`, saved filters |
| **User menu** | Profile, role, logout. | `GET /auth/me` |

Responsive: on mobile the left nav collapses into a drawer.

## 2. Route Tree (frontend)

```
app/
  login                                  ← public; JWT obtain
  (itsm)/                                ← ItsmGuard → ItsmShell (auth required)
    page                                 ← landing / default queue redirect
    queues/[queueId]                     ← saved-queue view of the ticket list
    tickets/
      page                               ← all-tickets queue (table + filters)
      new                                ← 3-step create wizard
      [key]                              ← ticket detail (e.g. /tickets/INC-1042), 2-pane
    projects/[projectKey]                ← project home (types, queues, config entry)
    dashboards/
      [id]                               ← view a dashboard
      [id]/edit                          ← drag-grid dashboard builder
    reports/[reportType]                 ← ReportShell for a standard report
    admin/
      projects/[projectKey]/
        fields                           ← Field & Layout Designer (dnd-kit)
        workflows/[id]                   ← Visual Workflow Builder (React Flow)
        slas/[id]                        ← SLA Policy Editor
        notifications                    ← Notification Scheme + email template editor
        groups                           ← Groups management
        canned-notes                     ← Canned-note library
        templates                        ← Ticket-template library
      roles                              ← Roles & Permissions (itsm.admin.roles)
```

> Ticket detail is addressed by the human‑readable **ticket key** (`INC-1042`) in the URL; the API resolves it to a UUID. List/search is `/tickets`; saved views are `/queues/[queueId]`.

## 3. Entity Hierarchy

The conceptual containment, top‑down:

```
Project (key=INC/REQ, default_workflow, default_group)
└── TicketType (Incident, Hardware, Network, …; per project)
    └── Ticket (KEY-N, status, priority, assignee, group, workflow snapshot)
        ├── Comment (public | private) ── CommentAttachment, MentionRecord
        ├── Watcher (user)
        ├── TicketLink (relates_to / blocks / duplicates / causes …)
        ├── TicketAttachment
        ├── FieldValue (custom fields, via the field engine — M3)
        ├── SLATracker (per metric — M5)
        └── AuditEvent  (activity feed; append-only)
```

Supporting/config entities that a Ticket references:

```
Workflow ── Status (category: todo/in_progress/done) ── Transition
                                                          ├── TransitionCondition
                                                          ├── TransitionScreen → Field
                                                          └── AutoAssignmentRule
Group ── GroupMembership (member/lead) ── GroupAssignmentState (round-robin cursor)
RoutingRule (project-scoped; first match sets group+assignee)
```

See `ERD.md` for fields, FKs, constraints, and indexes.

## 4. Ticket Detail IA (2‑pane, JSM‑style)

```
┌───────────────────────────────────────────────┬───────────────────────────┐
│  LEFT (work surface)                           │  RIGHT (details panel)    │
│  • Summary + inline-edit description           │  • Status + transitions   │
│  • Tabs:                                       │  • Assignee / Group (PATCH)│
│      Comments  (Public | Internal toggle)      │  • Priority (PATCH)       │
│      Worklog                                   │  • SLA countdown widgets   │
│      History  (AuditEvent feed)                │  • Watchers               │
│      Files    (attachments)                    │  • Linked tickets         │
│  • Tiptap composer: public/internal toggle,    │  • Custom fields (layout) │
│    canned-note inserter, @mention              │  • People (requestor)     │
└───────────────────────────────────────────────┴───────────────────────────┘
```

- **Comments tab** filters by visibility; Internal comments require `itsm.tickets.comments_private` (the comments list endpoint hides private comments for users without that grant).
- **Right‑rail** edits issue targeted `PATCH` / custom actions (`assign/`, `transition/`).

## 5. Queue / List IA

- Backed by `@tanstack/react-table` + `@tanstack/react-virtual`.
- **Saved queues** (M2) come from `SavedFilter.query_spec`; quick‑filter pills + a filter builder map to DRF `filterset_fields` and the `query_builder` service.
- Columns: number, summary, status (RAG by category color), priority, assignee, group, SLA pill, updated. Column picker + group‑by.
- **Bulk‑action bar** (sticky) drives the bulk endpoint (gated by `itsm.tickets.bulk`).

## 6. Administration IA

Administration is **Supervisor‑facing** and organized **per project** (plus a global Roles area):

| Admin area | Route | RBAC module | Engine milestone |
|---|---|---|---|
| Project configuration hub | `admin/projects/[key]` | `itsm.projects.config` | M8 |
| Field & Layout Designer | `…/fields` | `itsm.fields`, `itsm.fields.layouts` | M3 |
| Visual Workflow Builder | `…/workflows/[id]` | `itsm.workflows`, `itsm.workflows.transitions` | M4 |
| SLA Policy Editor | `…/slas/[id]` | `itsm.sla`, `itsm.sla.policies`, `itsm.sla.calendars` | M5 |
| Notification Schemes + Email Templates | `…/notifications` | `itsm.notifications.schemes`, `…templates` | M6 |
| Groups & Routing | `…/groups` | `itsm.groups` | M8 (model M1) |
| Canned Notes | `…/canned-notes` | `itsm.canned_notes` | M7 |
| Ticket Templates | `…/templates` | `itsm.tickets.templates` | M7 |
| Roles & Permissions | `admin/roles` | `itsm.admin.roles` | M0 (built) |

The module tree (dot notation) **is** the IA backbone for permissions; see `ROLES_PERMISSIONS_MATRIX.md` for the full registry.

## 7. URL & API Namespacing
- All API routes are under **`/api/v1/itsm/`**.
- Auth: `/api/v1/itsm/auth/login|refresh|me`.
- OpenAPI schema: `/api/v1/itsm/schema/`; Swagger UI: `/api/v1/itsm/docs/`.
- The frontend `(itsm)` route group is fully standalone (own `ApiClient`, own auth provider), independent of any other app in the host repo.
