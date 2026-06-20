# One Helpdesk — Project Overview

A modern, JSM-inspired **One Helpdesk** ITSM platform: Incident + Service Request
management on ITIL lines, focused on the **agent experience** for MVP-1
(create → assign → transition → comment → resolve). Multiple departments (IT, HR, …)
share one platform; each is a **Helpdesk** (workspace) with its own projects, ticket-number
prefix, and members. End-user portal / self-service / knowledge base /
Problem-Change-Asset (CMDB) are deferred.

This is a **standalone product** living in `/home/santhosh/ticketingsystem-pilot`. It is
authored fresh: its own Django apps, its own API namespace (`/api/v1/itsm/`), its own
RBAC, and (to come) its own Next.js `(itsm)` route shell. It does **not** port from, depend
on, or couple to the repo's existing `qa` / `project_management` apps — those only share
the host Django project + the `accounts.User` login. ITSM access is governed entirely by
its own module RBAC.

## Tech stack
- **Backend:** Django 5 + DRF, PostgreSQL 16, `djangorestframework-simplejwt` (JWT),
  `drf-spectacular` (OpenAPI), `django-filter`, `bleach` (HTML sanitization),
  `APScheduler` + `django-apscheduler` (scheduled jobs), `Pillow` (attachments).
  **UUID primary keys throughout.**
- **Frontend (planned):** Next.js 14 App Router + React 18 + TypeScript + Tailwind +
  shadcn/ui, react-hook-form + zod, zustand, @tanstack/react-table + react-virtual,
  recharts, @tiptap (+mention), @xyflow/react (workflow canvas), @dnd-kit (layout/palette),
  react-grid-layout (dashboards), cmdk (⌘K), date-fns, sonner.
- **Infra:** existing Docker Compose + Nginx; `RUN_SCHEDULER`, SMTP (prod) / console email
  (dev), `FRONTEND_BASE_URL`.

## The 11 backend apps (`backend/apps/itsm_*`)
| App | Owns | Build state |
|---|---|---|
| `itsm_core` | `BaseModel`, dynamic-field engine (models `models/fields.py` + `services/fields.py` + REST API), HTML sanitizer, `AuditEvent` + `log_event()`, cross-engine hooks | built |
| `itsm_rbac` | `Module`/`SystemRole`/`RoleModulePermission`/`RoleAssignment`, `HasModulePermission`, `check_permission`, JWT login, module/role seed | built |
| `itsm_helpdesks` | `Helpdesk` (department/workspace, `key` = ticket-number prefix), `HelpdeskMembership`; `services.py` scoping primitives (`accessible_helpdesk_ids`, `resolve_helpdesk_scope`, `scope_ticket_queryset`) every ticket query reuses | built |
| `itsm_projects` | `Project` (key/type/default group/workflow), `TicketType`; per-Helpdesk projects; seeds ITINC/ITREQ/HRINC/HRREQ | built |
| `itsm_groups` | `Group`/`GroupMembership`/`RoutingRule`/`GroupAssignmentState`, auto-assign + routing services | built |
| `itsm_workflows` | `Workflow`/`StatusCategory`/`Status`/`Transition`/`TransitionCondition`/`TransitionScreen`(+Field)/`AutoAssignmentRule`/`ReopenRule` + execution engine + graph validator | built |
| `itsm_tickets` | `Ticket`/`TicketSequence`/`Watcher`/`TicketLink`/`TicketAttachment`/`Comment`(+attachments,mentions) + ticket_service + numbering + `CannedNote`/`TicketTemplate`(+categories) + `query_builder` | built |
| `itsm_sla` | business calendars/holidays, SLA policies/metrics/targets, trackers, pause/resume, escalations, breach sweep (`business_time.py`, `services/sla_engine.py`, `scheduler.py`, `seed.py`) | built & validated |
| `itsm_notifications` | notification schemes/rules, email templates, in-app inbox, durable outbox + flusher (`services/bus.py`/`recipients.py`/`templates.py`/`outbox.py`, `scheduler.py`, `seed.py`) | built & validated |
| `itsm_reporting` | live report query services (`services/reports.py`, `services/widget_data.py`) | built & validated |
| `itsm_dashboards` | `SavedFilter` (query_spec→Q), `Dashboard`/`Widget`/`DashboardShare` | built & validated |

(15 *skills* exist: the field engine and canned-notes/templates get their own skill docs even
though their code lives inside `itsm_core` / `itsm_tickets`.)

## Helpdesks: per-Helpdesk projects + row-level scoping
Each **Helpdesk** is a department workspace. `Project` carries a non-null `helpdesk` FK, and a
helpdesk's `key` is the ticket-number prefix, so project keys are prefixed per helpdesk
(`ITINC`/`ITREQ` for IT, `HRINC`/`HRREQ` for HR) — one default Incident + one Request project
per helpdesk. Every **ticket-facing query is clamped to the requester's helpdesk memberships**:
the scope lives in the shared services (not just `TicketViewSet`), is computed by
`itsm_helpdesks.services.accessible_helpdesk_ids(user)` (`None` = superuser / unrestricted),
and the advisory `?helpdesk=<id|key>` query param is always intersected with that membership set
(it narrows, never widens, and never 403s). Groups/workflows/SLA/notifications stay **shared**
(global) and are looked up per project with an `is_default` fallback. See `_CODING_RULES.md` rule 15.

## API & docs
- All routes mounted under **`/api/v1/itsm/`** (see `backend/core/urls.py`).
- Auth: `POST auth/login`, `POST auth/refresh`, `GET auth/me`.
- OpenAPI schema: `GET /api/v1/itsm/schema/`; Swagger UI: `/api/v1/itsm/docs/`.
- Every ViewSet carries a `module_code`; every model uses a UUID PK + `BaseModel` (soft delete).

## Run instructions
```bash
# Backend
cd backend
python manage.py migrate
python manage.py seed_itsm        # idempotent: modules, roles, helpdesks, workflows, groups, projects, memberships
python manage.py runserver 0.0.0.0:8000
# Scheduler (SLA breach sweep + notification outbox flush/reaper) — both engines live:
RUN_SCHEDULER=1 python manage.py runserver 0.0.0.0:8000
# Frontend (when the (itsm) shell lands)
cd frontend && npm run dev
```
`seed_itsm` is idempotent and dependency-ordered across all built milestones (modules, roles,
workflows, groups, projects, SLA calendar/policy, notification scheme/rules/templates). Dev uses
the console email backend (notifications log to stdout).

## Source of truth
1. The approved plan: `/home/santhosh/.claude/plans/build-mvp-1-itsm-purrfect-allen.md`.
2. The real code under `backend/apps/itsm_*`. **Code wins over plan** wherever they differ
   (e.g. RBAC binds the user→role via a `RoleAssignment` OneToOne, not a `system_role` FK).
