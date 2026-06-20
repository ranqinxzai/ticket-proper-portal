# ITSM Platform — Design Documentation

Formal design deliverables for the **ITSM (IT Service Management) Platform MVP‑1** — a JSM‑inspired, agent‑experience‑first Incident + Service Request system being built in `/home/santhosh/ticketingsystem-pilot`.

These docs are grounded in the **real backend code** (`backend/apps/itsm_*`) where it exists (M0 + M1 backend are DONE & validated) and aligned to the **approved implementation plan** where code isn't built yet. Endpoints/models are marked `(built)` or `(planned, M#)` throughout.

## Quick facts
- **Backend:** Django 5 + DRF + PostgreSQL 16, UUID PKs, JWT (`/api/v1/itsm/auth/login|refresh|me`), module RBAC (`module_code` per ViewSet), drf‑spectacular (`/api/v1/itsm/schema/`, Swagger `/api/v1/itsm/docs/`), APScheduler, bleach, explicit `log_event()` audit (no signals). All routes under `/api/v1/itsm/`. Roles: Agent + Supervisor.
- **Frontend:** Next.js 14 App Router, React 18, TS, Tailwind, shadcn/ui, JWT ApiClient, react‑hook‑form + Zod, Zustand, Recharts, @tanstack/react‑table+virtual, Tiptap(+mention), @xyflow/react, @dnd‑kit, react‑grid‑layout. Standalone `(itsm)` route group.

## Document Index

| # | Document | Description |
|---|---|---|
| 1 | [PRD.md](./PRD.md) | Product Requirements: vision, goals, personas (Agent/Supervisor), 13 in‑scope modules, deferred scope, functional + non‑functional requirements, success metrics. |
| 2 | [INFORMATION_ARCHITECTURE.md](./INFORMATION_ARCHITECTURE.md) | Navigation (left nav, top header), the `(itsm)` route tree, entity hierarchy (Project→TicketType→Ticket→Comment/Watcher/Link/Activity), admin IA. |
| 3 | [ROLES_PERMISSIONS_MATRIX.md](./ROLES_PERMISSIONS_MATRIX.md) | Full `itsm.*` module registry, Agent vs Supervisor CRUD matrix, seeded grants, and private‑comment / bulk per‑action overrides. |
| 4 | [ERD.md](./ERD.md) | Every model, fields, FKs, enums, unique constraints, indexes — grouped by app, with a Mermaid ERD. Grounded in real models. |
| 5 | [API_DESIGN.md](./API_DESIGN.md) | REST surface: resources + methods, key ticket actions, auth flow, pagination/filtering/search, error shapes (400/403/409/422). |
| 6 | [FRONTEND_COMPONENT_ARCHITECTURE.md](./FRONTEND_COMPONENT_ARCHITECTURE.md) | Folder structure, component tree, state/data‑fetching strategy, major screens, library choices + rationale. |
| 7 | [BACKEND_SERVICE_ARCHITECTURE.md](./BACKEND_SERVICE_ARCHITECTURE.md) | The 10 Django apps, the services layer, the "single choke‑point + explicit log + no signals" philosophy, scheduler wiring. |
| 8 | [WORKFLOW_ENGINE.md](./WORKFLOW_ENGINE.md) | Transition pipeline (resolve→conditions→validators→apply→post‑functions→persist→post‑commit), registries, auto‑assign, reopen, graph validation, the 2 seeded workflows. |
| 9 | [NOTIFICATION_ENGINE.md](./NOTIFICATION_ENGINE.md) | Event bus, schemes/rules/recipients/templates, transactional outbox + flusher, dedupe/retry, in‑app inbox, channels, defaults. |
| 10 | [SLA_ENGINE.md](./SLA_ENGINE.md) | Metrics, business calendars + holidays, business‑time algorithm, pause/resume, breach sweep + escalations, countdown payload. |
| 11 | [DASHBOARD_FRAMEWORK.md](./DASHBOARD_FRAMEWORK.md) | SavedFilter `query_spec`, Dashboard/Widget model, widget types, drag‑grid, sharing; standard reports list. |
| 12 | [TECH_STACK.md](./TECH_STACK.md) | Full backend + frontend + infra stack table with rationale. |
| 13 | [ROADMAP.md](./ROADMAP.md) | M0–M12 milestone roadmap with current status (M0 + M1 backend DONE). |
| 14 | [MVP_VS_FUTURE.md](./MVP_VS_FUTURE.md) | In‑scope vs deferred (portal, KB, Problem/Change/CMDB, multi‑tenancy, webhooks/Slack, digests, AI) with reserved hooks. |
| 15 | [WIREFRAMES.md](./WIREFRAMES.md) | ASCII wireframes: app shell, queue, ticket detail, create wizard, field/layout designer, workflow builder, SLA editor, notification scheme editor, dashboard builder, reports, login. |
| 16 | [FOLDER_STRUCTURE.md](./FOLDER_STRUCTURE.md) | Annotated backend app layout + frontend folder layout. |
| 17 | [IMPLEMENTATION_SEQUENCE.md](./IMPLEMENTATION_SEQUENCE.md) | Milestone‑by‑milestone build order with dependencies and exit criteria. |

## Reading order
- **New to the product?** PRD → Information Architecture → Roles & Permissions → Tech Stack.
- **Backend engineer?** ERD → Backend Service Architecture → Workflow/SLA/Notification engines → API Design.
- **Frontend engineer?** Information Architecture → Frontend Component Architecture → Wireframes → API Design.
- **Planning / PM?** Roadmap → MVP vs Future → Implementation Sequence.

## Status legend
`(built)` = implemented today (M0/M1). `(planned, M#)` = designed in the plan, lands at that milestone. Backend M0 + M1 are DONE & validated; the frontend `(itsm)` shell and M2+ engines are in progress.
