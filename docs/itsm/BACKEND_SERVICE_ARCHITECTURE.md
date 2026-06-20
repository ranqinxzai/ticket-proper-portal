# Backend Service Architecture — ITSM Platform

Django 5 + DRF + PostgreSQL 16, UUID PKs, JWT, module RBAC, drf‑spectacular, APScheduler. **10 ITSM Django apps** under `backend/apps/`, each with `models/ serializers/ views/ services/ urls.py` (+ `migrations/`, optional `seed.py` / `rbac_modules`).

---

## 1. The 10 Apps

| App | Owns | Status |
|---|---|---|
| **`itsm_core`** | Shared `BaseModel`; the dynamic‑field engine (planned); HTML sanitizer (`sanitize_html` / `html_to_text`); append‑only `AuditEvent` + `log_event()`; cross‑engine `hooks`. | **built** |
| **`itsm_rbac`** | `Module` / `SystemRole` / `RoleModulePermission` / `RoleAssignment`; `HasModulePermission` + `ItsmModelViewSet`; `check_permission` resolver; module registry + Agent/Supervisor seed; JWT login/refresh/me. | **built** |
| **`itsm_projects`** | `Project` (key, type, default workflow/group), `TicketType`; seeds INC + REQ. | **built** |
| **`itsm_groups`** | `Group`, `GroupMembership`, `GroupAssignmentState`, `RoutingRule`; auto‑assign + routing services. | **built** |
| **`itsm_workflows`** | `Workflow`, `StatusCategory`, `Status`, `Transition`(+conditions/screens), `AutoAssignmentRule`, `ReopenRule`; `services/engine.py` + graph validators; seeds 2 workflows. | **built** |
| **`itsm_tickets`** | `Ticket` (+ first‑class columns), `TicketSequence`, `Watcher`, `TicketLink`, attachments, `Comment` (public/private), `MentionRecord`; `services/ticket_service.py` + `numbering.py`. (`CannedNote`/`TicketTemplate` planned.) | **built** |
| **`itsm_sla`** | Calendars/holidays, policies/metrics/targets, trackers/pause‑intervals, escalations; `services/sla_engine` + `business_time`. | planned (M5) |
| **`itsm_notifications`** | Schemes/rules, email templates, in‑app inbox, durable outbox; `services/bus` + `outbox`. | planned (M6) |
| **`itsm_reporting`** | Live report query services + nightly snapshot tables. | planned (M9) |
| **`itsm_dashboards`** | `SavedFilter` (`query_spec`→Q), `Dashboard`, `Widget`, `DashboardShare`. | planned (M10) |

> RBAC is one of these apps but the PRD also counts it among the 13 *user‑facing* modules; the field engine lives **inside** `itsm_core`. All 10 apps are wired in `INSTALLED_APPS` and mounted under `/api/v1/itsm/` (stub apps currently expose empty routers).

## 2. Services Layer

Each cross‑cutting concern has **one choke‑point function** that everything calls. Built services:

| Service | Location | Responsibility |
|---|---|---|
| **`ticket_service`** | `itsm_tickets/services/ticket_service.py` | `create_ticket`, `assign`, `add_comment` — the only sanctioned ticket write sites; log audit + fan out SLA/notify hooks on commit. |
| **`numbering`** | `itsm_tickets/services/numbering.py` | `generate_ticket_number(project)` — locks `TicketSequence` with `select_for_update`, returns `KEY‑N`. |
| **`workflow_service`** (engine) | `itsm_workflows/services/engine.py` | `transition()`, `available_transitions()`, `evaluate_conditions()` — the status‑change choke‑point. |
| **`routing_service`** | `itsm_groups/services.py` | `resolve_group_and_assignee(ticket)` (create‑time routing), `resolve_assignee(strategy, group, …)`, `round_robin_pick`, `least_loaded_pick`. |
| **`audit` / `log_event`** | `itsm_core/services/audit.py` | the single sanctioned audit write site. |
| **`html`** | `itsm_core/services/html.py` | `sanitize_html`, `html_to_text`. |
| **`hooks`** | `itsm_core/services/hooks.py` | `sla_*`, `emit_event` — lazy, no‑op‑if‑absent, error‑swallowing bridges to engines. |
| **`check_permission`** | `itsm_rbac/services.py` | permission resolution (+ `get_user_role`, cache invalidation). |
| **`seed_itsm`** | `itsm_core/management/commands/seed_itsm.py` | idempotent, order‑sensitive platform seed. |

Planned services (per the plan): **`sla_engine`** (`start/stop/pause/resume/recompute/scan_breaches/business_minutes_between`), **`business_time`** (pure, unit‑tested), **`notifications.bus.emit`** + **`outbox.flush`**, **`field_service`** (typed read/write + mandatory validation), **`query_builder`** (`query_spec`→`Q`), **`aggregation_job`** (nightly snapshots).

## 3. The Core Philosophy: single choke‑point · explicit log · no signals

Three rules govern every write:

1. **One choke‑point per concern.** A ticket is never mutated ad‑hoc in a view. Create/assign/comment go through `ticket_service`; every status change goes through `engine.transition()`. This makes side‑effects, ordering, and locking *one* place to reason about.

2. **Explicit `log_event()` — no Django signals.** The audit feed is written by direct calls at each write site, never by `post_save`. This is deliberate:
   - **Greppable:** `grep log_event` finds every place that writes history.
   - **Previous values:** the call site has the old value to put in the payload (a `post_save` can't).
   - **No hidden fan‑out:** behavior is explicit and testable.

3. **Side‑effects on commit.** Audit, SLA clock ops, and notifications run inside `transaction.on_commit(...)`, so a rolled‑back write **never** notifies anyone or starts a clock. Engine bridges (`hooks`) **no‑op if the engine app isn't installed yet** and **swallow errors** (logged to the `itsm` logger) so an SLA/notification failure can't break a ticket write.

### Worked example — create
```python
@transaction.atomic
def create_ticket(...):
    workflow = project.default_workflow            # snapshot
    initial  = first initial/sorted Status
    ticket = Ticket(ticket_number=generate_ticket_number(project), status=initial, ...)
    if apply_routing and assignee is None:
        ticket.assigned_group, ticket.assignee_id = resolve_group_and_assignee(ticket)
    if ticket.assignee_id: ticket.assigned_at = now()
    ticket.save()
    transaction.on_commit(lambda: (
        log_event(ticket, user, "ticket_created", payload={...}),
        hooks.sla_start_for_ticket(ticket),
        hooks.emit_event("TicketCreated", ticket, actor=user),
        hooks.emit_event("Assigned", ticket, actor=user) if ticket.assignee_id else None,
    ))
    return ticket
```

### Worked example — transition (ordered pipeline)
`engine.transition(ticket, transition, user, fields, comment)` runs **fully atomic** with `select_for_update(ticket)`:
1. **resolve & assert** `from_status == ticket.status` (else `TransitionError(409)`),
2. **conditions** (`role_in` / `group_member` / `is_assignee` / `field_equals`; first fail → `403`),
3. **validators** (mandatory screen fields, all collected → `422`),
4. **apply status** (+ detect reopen, bump `reopen_count`),
5. **post‑functions in canonical order** (`auto_assign` → assignee → priority → resolution → `stamp_timestamp`; SLA/emit ops deferred),
6. **persist** (`save(update_fields=…)`),
7. **post‑commit** (`log_event` status_changed/closed/reopened, `sla_on_status_change`, run deferred SLA ops, `emit_event`).
See `WORKFLOW_ENGINE.md` for the full pipeline.

## 4. DRF Plumbing

- **`ItsmModelViewSet`** (base): `permission_classes = [HasModulePermission]`, a `module_code`, and `perform_destroy` → `soft_delete`. Subclasses set `module_code`, `queryset`, `serializer_class`, `filterset_fields`, `search_fields`, `ordering_fields`.
- **Global REST config:** JWT + session + basic auth; `AllowAny` default (RBAC enforced per‑view via `module_code`); DjangoFilter/Search/Ordering backends; `StandardPagination` (25/page, max 500); drf‑spectacular schema class.
- **JWT:** access 8 h, refresh 7 d, rotation on; `Bearer` header.
- **Routing:** each app's `urls.py` is a `DefaultRouter`; all included under `/api/v1/itsm/` in `core/urls.py`. Stub engine apps expose empty routers today.

## 5. Scheduler Wiring (APScheduler)

- `RUN_SCHEDULER` (env, default off) gates startup; management commands like `migrate`, `seed_itsm`, `loaddata`, `dumpdata`, `createsuperuser` are skipped so jobs never run during admin tasks. `runserver` double‑start is guarded.
- Each engine app's `AppConfig.ready()` starts its scheduler behind that boot guard.
- Jobs share one namespaced `DjangoJobStore` with `max_instances=1, coalesce=True, misfire_grace_time=60`:
  - `sla.breach_sweep` (~1 min) — flip `breached`, fire idempotent escalations.
  - `sla.calendar_recompute_nightly` — safety recompute / cache‑bust.
  - `notifications.outbox_flush` (~30 s) — claim `queued` rows (`select_for_update(skip_locked)`), deliver, backoff.
  - `notifications.outbox_reaper` — reset stuck rows.
  - `reporting.aggregate_nightly` — snapshot tables.

## 6. App Boot & Seeding

- `seed_itsm` runs steps **in dependency order**, each optional (skips an unimplemented engine): RBAC modules & roles → status categories & workflows → calendars & SLA policies → notification schemes & templates → groups → ticket types → projects. Wrapped per‑step in `transaction.atomic`; idempotent on re‑run.
- Email: console backend in dev (notifications visible in the log), SMTP in prod. `FRONTEND_BASE_URL` builds absolute deep‑links.

## 7. Why this shape
- **Testable hot paths:** numbering, transitions, routing each have one entry point → unit tests target the choke‑point.
- **Incremental build:** the `hooks` no‑op pattern means the domain works at every milestone before its engine exists.
- **Operational safety:** soft delete + config snapshots + on‑commit side‑effects + idempotent seeds + scheduler boot guards.
