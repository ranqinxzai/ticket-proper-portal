# Folder Structure — ITSM Platform

Annotated backend + frontend layout. `(built)` exists today; `(planned)` lands at the noted milestone. Paths are relative to `/home/santhosh/ticketingsystem-pilot`.

---

## 1. Backend (`backend/`)

```
backend/
  core/
    settings.py            # INSTALLED_APPS (10 itsm apps), REST_FRAMEWORK, SIMPLE_JWT,
                           #   SPECTACULAR_SETTINGS, RUN_SCHEDULER, EMAIL_BACKEND, FRONTEND_BASE_URL
    settings_test.py
    urls.py                # mounts every itsm app under /api/v1/itsm/ + schema + docs
  apps/
    accounts/              # host User model (full_name); shared login (not ITSM-owned)
    itsm_core/             # (built) shared foundation
      models/
        base.py            #   UUIDModel, TimeStampedModel, SoftDeleteModel, BaseModel
        audit.py           #   AuditEvent (append-only; 22 action enum)
        __init__.py
      services/
        audit.py           #   log_event()  — the only sanctioned audit write
        html.py            #   sanitize_html(), html_to_text() (bleach)
        hooks.py           #   sla_* + emit_event bridges (lazy, no-op-if-absent, swallow errors)
        __init__.py
      management/commands/
        seed_itsm.py       #   idempotent, order-sensitive platform seed
      migrations/          #   0001_initial, 0002_initial
    itsm_rbac/             # (built) module RBAC + JWT auth
      models.py            #   Module, SystemRole, RoleModulePermission, RoleAssignment
      registry.py          #   MODULES list + seed_rbac() (Agent/Supervisor)
      permissions.py       #   HasModulePermission, ItsmModelViewSet
      services.py          #   check_permission, get_user_role, cache invalidation
      serializers.py       #   incl. ItsmUserSerializer + permission map + JWT serializer
      views.py · urls.py   #   /modules /roles /role-permissions /role-assignments /auth/*
    itsm_projects/         # (built) Project, TicketType (+ seed)
      models.py serializers.py views.py urls.py seed.py
    itsm_groups/           # (built) Group, GroupMembership, GroupAssignmentState, RoutingRule
      models.py services.py serializers.py views.py urls.py seed.py
                           #   services.py = round_robin/least_loaded/routing
    itsm_workflows/        # (built) workflow graph + engine
      models.py            #   StatusCategory, Workflow, Status, Transition, conditions,
                           #     screens, AutoAssignmentRule, ReopenRule
      services/engine.py   #   transition() pipeline + available_transitions
      validators.py        #   validate_workflow_graph (admin-time)
      serializers.py views.py urls.py seed.py
    itsm_tickets/          # (built) the hot domain
      models.py            #   Ticket(+8 indexes), TicketSequence, Watcher, TicketLink,
                           #     attachments, Comment(public/private), MentionRecord
      services/
        ticket_service.py  #   create_ticket, assign, add_comment
        numbering.py       #   generate_ticket_number (locked sequence)
      serializers.py views.py urls.py
    itsm_sla/              # (planned M5) calendars/policies/trackers/escalations
      models/ services/ urls.py   #   urls register sla-policies/metrics/targets/
                                  #     escalation-rules/business-calendars/holidays/sla-trackers
    itsm_notifications/    # (planned M6) bus/outbox/schemes/templates/inbox
      models/ services/ urls.py
    itsm_reporting/        # (planned M9) report query services + snapshot tables
      models/ services/ urls.py   #   urls register reports
    itsm_dashboards/       # (planned M10) SavedFilter/Dashboard/Widget/Share
      models/ services/ urls.py   #   urls register saved-filters/dashboards/widgets
  Dockerfile · requirements (host)
```

### Backend per‑app contract
Each ITSM app provides: `models` (single file or `models/` package), `serializers`, `views` (ViewSets on `ItsmModelViewSet` with a `module_code`), `urls.py` (a `DefaultRouter`), `migrations/`, and optionally `services/`, `seed.py`, and management commands. Engine apps add their scheduler in `apps.py:ready()` behind the `RUN_SCHEDULER` guard.

## 2. Frontend (`frontend/`) — `(itsm)` route group

> Target layout (authored milestone‑by‑milestone). The `(itsm)` group is standalone, with its own JWT client and auth provider.

```
frontend/
  app/
    login/                              # public; obtains JWT
    (itsm)/
      layout.tsx                        # ItsmAuthProvider + ItsmGuard + ItsmShell
      page.tsx                          # default queue
      queues/[queueId]/page.tsx
      tickets/
        page.tsx                        # all-tickets queue
        new/page.tsx                    # 3-step create wizard
        [key]/page.tsx                  # detail (e.g. /tickets/INC-1042)
      projects/[projectKey]/page.tsx
      dashboards/[id]/page.tsx
      dashboards/[id]/edit/page.tsx
      reports/[reportType]/page.tsx
      admin/
        projects/[projectKey]/
          fields/page.tsx               # Field & Layout Designer
          workflows/[id]/page.tsx       # Visual Workflow Builder
          slas/[id]/page.tsx            # SLA Policy Editor
          notifications/page.tsx        # Scheme + email template editor
          groups/page.tsx
          canned-notes/page.tsx
          templates/page.tsx
        roles/page.tsx                  # Roles & Permissions
  lib/
    itsm/
      client.ts                         # JWT ApiClient (fetch, refresh, error mapping)
      auth.tsx                          # ItsmAuthProvider, useItsmAuth, ItsmGuard, can()
      types.ts                          # shared domain types
      filters.ts                        # query_spec <-> UI filter model
      api/                              # per-domain typed modules
        tickets.ts projects.ts groups.ts workflows.ts fields.ts
        sla.ts notifications.ts reports.ts dashboards.ts rbac.ts
    store/                              # Zustand UI stores
  components/
    ui/                                 # shadcn primitives
    shell/                              # AppShell, LeftNav, TopHeader, NotificationBell, CommandMenu
    tickets/                            # Queue/, Detail/, Create/, composer, panels
    admin/
      field-designer/  workflow-builder/  sla-editor/
      notification-editor/  groups/  roles/  canned-notes/  templates/
    dashboards/                         # grid, widget registry, widgets
    reports/                            # ReportShell, charts
    common/                             # RAGPill, UserAvatar, EmptyState, …
  public/
```

## 3. Docs (`docs/itsm/`)
The 17 design deliverables + this folder's `README.md` index (see `README.md`).

## 4. Skills (`.claude/skills/`)
Per‑module skill folders (per the plan): `itsm-core`, `itsm-rbac`, `itsm-projects`, `itsm-groups`, `itsm-workflows`, `itsm-tickets`, `itsm-sla`, `itsm-notifications`, `itsm-fields`, `itsm-canned-notes`, `itsm-templates`, `itsm-reporting`, `itsm-dashboards` — each with the 7‑file structure (SKILL / ARCHITECTURE / API_CONTRACTS / DB_SCHEMA / BUG_LOG / INTERLINKING / USER_FLOWS), plus a `_MODULE_MAP.md` index. (Skills are a separate deliverable from these docs.)

## 5. Naming Conventions
- Backend apps: `itsm_<domain>`; ViewSets carry a `module_code`; routers register kebab‑case resource names (`ticket-types`, `routing-rules`).
- API base: `/api/v1/itsm/`. Auth: `/auth/login|refresh|me`.
- Frontend: route group `(itsm)`; tickets addressed by **key** (`INC-1042`) in URLs; typed API modules under `lib/itsm/api/`.
