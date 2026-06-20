# Product Requirements Document — ITSM Platform (MVP‑1)

**Product:** ITSM Ticketing Platform (JSM‑inspired, agent‑experience first)
**Status:** MVP‑1 — M0 + M1 backend DONE & validated; engines/UI in progress
**Audience:** Engineering, Product, QA
**Location:** `/home/santhosh/ticketingsystem-pilot`

---

## 1. Vision

Deliver a modern, **Jira Service Management–style IT Service Management** platform that lets a support agent run the full incident / service‑request lifecycle — **create → assign → transition → comment → resolve → close** — on top of per‑project configuration (custom fields, layouts, workflows, SLAs, notifications, canned notes, templates, groups, reports, dashboards), all protected by module RBAC.

MVP‑1 is **agent‑experience first**: every screen and API is optimized for the people who *work* tickets. The end‑user / self‑service portal, knowledge base, and the heavier ITIL practices (Problem / Change / CMDB) are deliberately deferred (see `MVP_VS_FUTURE.md`).

The platform is a **fresh, self‑contained build**. It does not port from, depend on, or couple to the host repo's existing `qa` / `project_management` apps. It has its own Django apps, its own API namespace (`/api/v1/itsm/`), and its own Next.js `(itsm)` route shell. A single shared login (`accounts.User`) is acceptable, but ITSM access is governed entirely by its own RBAC.

## 2. Goals & Non‑Goals

### Goals
- **G1 — Usable end‑to‑end vertical slice.** An agent can create a ticket (auto‑numbered with the per‑helpdesk prefix, e.g. `ITINC‑1`), have it auto‑routed/assigned, comment publicly and internally, transition it through a seeded workflow, and resolve/close it — with a full audit trail.
- **G2 — Configurable, not hard‑coded.** Fields, layouts, workflows, SLAs, notification rules, groups, and routing are data‑driven per project, editable by a Supervisor without code changes.
- **G3 — Full‑featured engines.** A visual workflow canvas, a complete SLA engine (business calendars, holidays, pause/resume, escalation), a rich notification engine (rules + templates + durable outbox), and a drag‑drop dashboard builder.
- **G4 — Secure & auditable.** Module RBAC on every endpoint, sanitized rich text, JWT auth, and an append‑only, greppable audit feed written via explicit `log_event()` calls (no signals).
- **G5 — Extensible foundation.** UUID PKs, a shared `BaseModel`, a single choke‑point per cross‑cutting concern, and reserved hooks (webhook/Slack channels, notification digests) so future practices can bolt on without rework.
- **G6 — Multi‑department workspaces (Helpdesks).** The platform hosts many departments (IT, HR, …) on one install; each is a **Helpdesk** (`apps.itsm_helpdesks`). Every project, ticket, group, queue, report, dashboard and SLA tracker is scoped to a helpdesk via explicit **membership** — a user only sees the helpdesks they belong to. Each helpdesk owns its own default Incident + Service Request projects and contributes its `key` as the per‑helpdesk ticket‑number prefix (e.g. `ITINC‑1`, `HRREQ‑1`).

### Non‑Goals (MVP‑1)
- End‑user / self‑service portal, knowledge base, CSAT surveys.
- Problem / Change / Release management, Asset / CMDB.
- Webhook/Slack delivery, notification digests, AI features. (Multi‑department isolation now ships as **Helpdesks** — see G6 — but helpdesk‑scoped RBAC roles, per‑helpdesk SLA/notification/workflow schema, and supervisor cross‑helpdesk roll‑up reporting are deferred; workflows/SLA/notifications stay global and shared this phase.)
- Porting or integrating with the host repo's QA / Project‑Management modules.

## 3. Personas

| Persona | Description | Primary needs |
|---|---|---|
| **Agent** | Front‑line support engineer who works the queue. Default seeded `SystemRole` `agent`. | Fast queue triage, inline edits, public + internal comments, canned notes, transitions, SLA visibility, watch/link tickets, run reports & view dashboards. **No** delete, **no** configuration/admin. |
| **Supervisor** | Team lead / service‑desk manager. Seeded `SystemRole` `supervisor`. | Everything an Agent can do **plus** delete, and full configuration & administration: projects, groups, workflows, fields/layouts, SLAs, notification schemes/templates, roles & permissions. Full access to Helpdesk administration (`/admin/helpdesks`): create helpdesks and manage memberships (module `itsm.admin.helpdesks`; Agents have read‑only). |
| *(deferred)* End User / Requester | Person who raises a request via a portal. | Out of scope for MVP‑1; the `requestor` FK and `source=portal` enum are reserved. |

**Helpdesk membership scopes every persona.** Independent of role, a user only sees the **Helpdesks** they are an active member of (`HelpdeskMembership`, role‑in‑helpdesk `member`/`lead`). The same Agent/Supervisor role may apply across several helpdesks; the active set is computed server‑side and an advisory `?helpdesk=` view‑scope can narrow but never widen it. **Superusers bypass all permission checks and see all active helpdesks.** Roles are seeded by `apps.itsm_rbac.registry.seed_rbac()` and are `is_system=True` (cannot be deleted). A user is bound to exactly one role via `RoleAssignment` (one role per user for v1).

## 4. In‑Scope Modules (14)

These are the agent‑facing capability areas of MVP‑1, each backed by RBAC `module_code`s (see `ROLES_PERMISSIONS_MATRIX.md`).

| # | Module | Backend app | Build status |
|---|---|---|---|
| 1 | **Tickets** (queue, create, detail, comments, watchers, links, activity) | `itsm_tickets` | **DONE (M1)** |
| 2 | **Projects & Ticket Types** | `itsm_projects` | **DONE (M1)** |
| 3 | **Groups / Teams & Routing** | `itsm_groups` | **DONE (M1)** |
| 4 | **Workflows** (statuses, transitions, conditions, post‑functions, builder) | `itsm_workflows` | **DONE (M1; engine M4)** |
| 5 | **RBAC** (modules, roles, permissions, assignments, JWT auth) | `itsm_rbac` | **DONE (M0)** |
| 6 | **Custom Fields & Layout Designer** | `itsm_core` field engine | Planned (M3) |
| 7 | **SLA** (policies, metrics, calendars, holidays, trackers, escalations) | `itsm_sla` | Planned (M5) |
| 8 | **Notifications** (schemes, rules, templates, in‑app inbox, outbox) | `itsm_notifications` | Planned (M6) |
| 9 | **Canned Notes** | `itsm_tickets` | Planned (M7) |
| 10 | **Ticket Templates** | `itsm_tickets` | Planned (M7) |
| 11 | **Reports** (SLA compliance, agent performance, …) | `itsm_reporting` | Planned (M9) |
| 12 | **Dashboards** (saved filters, widgets, drag‑grid) | `itsm_dashboards` | Planned (M10) |
| 13 | **Administration** (roles & permissions, project config hub) | `itsm_rbac` + admin UI | Partly DONE (M0); UI later |
| 14 | **Helpdesks** (departments/workspaces, memberships, per‑helpdesk scoping) | `itsm_helpdesks` | **DONE** |

Shared foundation: **`itsm_core`** (BaseModel, audit, HTML sanitizer, hooks, field engine) — **DONE (M0)**. Cross‑cutting scoping foundation: **`itsm_helpdesks`** (`accessible_helpdesk_ids` and friends) — **DONE**.

## 5. Functional Requirements

### 5.1 Tickets (M1 — built)
- **FR‑T1** Create a ticket within a `(project, ticket_type)`; auto‑assign a unique per‑project number `KEY‑N` via a locked `TicketSequence` (`generate_ticket_number`). `ticket_number` is DB‑unique as a backstop.
- **FR‑T2** Standard ITIL fields are **first‑class indexed columns** on `Ticket`: summary, description (HTML + sanitized text mirror), requestor, assigned_group, assignee, status, priority (critical/high/medium/low), impact, urgency, resolution, due/first‑response/assigned/resolved/closed timestamps, reopen_count, source, workflow snapshot.
- **FR‑T3** Apply create‑time routing: first matching `RoutingRule` sets group + (optionally) assignee; `assigned_at` stamped when an assignee is set.
- **FR‑T4** Comments with `visibility` ∈ {public, private}; body sanitized via `bleach` on save, with a plain‑text mirror. First **public** reply stamps `first_responded_at`. `@mention` records captured.
- **FR‑T5** Watchers (add/remove, unique per `(ticket,user)`), Ticket links (relates_to / blocks / blocked_by / duplicates / duplicated_by / causes / caused_by), attachments (ticket + comment scoped).
- **FR‑T6** Append‑only activity feed (`AuditEvent`) written via explicit `log_event()`; captures previous values where relevant.
- **FR‑T7** Assignment endpoint locks the ticket (`select_for_update`) and logs group/assignee changes.

### 5.2 Workflows (M1 model + seed; M4 full engine)
- **FR‑W1** A workflow is statuses (nodes, with `canvas_x/y` for the builder) + transitions (edges). Three fixed `StatusCategory` keys: todo / in_progress / done.
- **FR‑W2** `workflow_service.transition()` is the **single choke‑point**, fully atomic with `select_for_update`. Ordered pipeline: resolve & assert `from_status` (stale → **409**) → conditions (guards → **403**) → validators (collect field errors → **422**) → apply status → post‑functions in canonical order → persist → post‑commit side‑effects (audit, SLA, notifications) via `transaction.on_commit`.
- **FR‑W2a** Conditions: `role_in`, `group_member`, `is_assignee`, `field_equals` (with `negate`).
- **FR‑W2b** Post‑functions (canonical order enforced): `auto_assign` → `set/clear_assignee` → `set_priority` → `set/clear_resolution` → `stamp_timestamp` → SLA ops (`start/stop/pause/resume_sla`) → `emit_event`.
- **FR‑W3** Auto‑assignment strategies: `round_robin` (locked cursor), `least_loaded`, `group_lead`, `fixed_user`, `keep_current`.
- **FR‑W4** Reopen = a transition out of a Done status (increments `reopen_count`) guarded by a `ReopenRule` (window + comment requirement).
- **FR‑W5** Admin‑time graph validation: exactly one initial status, a create transition, reachability (BFS) from initial, ≥1 Done status, duplicate‑edge warnings.
- **FR‑W6** Two seeded workflows: Incident (`New→Assigned→In Progress→Pending→Resolved→Closed`) and Request (`New→Approved→In Progress→Fulfilled→Closed`), each with reopen/cancel paths.

### 5.3 Custom Fields & Layouts (M3)
- **FR‑F1** Typed field engine bound to `(project, ticket_type)`: one row per `(ticket, field)` with `value_text/number/date/bool/user/json`. Field types: text, multiline, number, date, datetime, dropdown, multiselect, checkbox, radio, user_picker, group_picker.
- **FR‑F2** Layout Designer controls order / hidden / mandatory / visibility per field. The Create form is built from the layout (runtime Zod).

### 5.4 SLA (M5)
- **FR‑S1** Per‑ticket‑per‑metric `SLATracker` is the runtime row the UI reads. Metrics include first‑response and resolution.
- **FR‑S2** Business‑time arithmetic respects timezone, business days/hours, and holidays (DST‑correct via `ZoneInfo`): `add_business_minutes`, `business_minutes_between`.
- **FR‑S3** Pause/resume freezes and recomputes `due_at` from first principles. Breach is computed‑on‑read (authoritative for UI) + a ~1‑min scheduler sweep that flips `breached` and fires idempotent escalations at 75/90/100%.

### 5.5 Notifications (M6)
- **FR‑N1** Single choke‑point `bus.emit(event_type, ticket, context, actor)`, called inside `transaction.on_commit`, never raises into callers.
- **FR‑N2** `NotificationScheme` per project → `NotificationRule`s per event → recipient resolvers → dedupe by user + suppress actor → render template → write `InAppNotification` + enqueue email in a **transactional outbox**; a scheduled flusher delivers at‑least‑once with backoff + `dedupe_key`.

### 5.6 Canned Notes & Templates (M7)
- **FR‑C1** Canned notes inserted into the composer; ticket templates prefill the create form and can be applied to an existing ticket.

### 5.7 Reports & Dashboards (M9 / M10)
- **FR‑R1** Standard reports (SLA compliance, agent performance, volume/trend, …) return chart‑ready JSON + CSV export.
- **FR‑R2** `SavedFilter.query_spec` (JSON → ORM `Q`) drives saved queues and dashboard widgets; dashboards use a drag‑grid widget registry with sharing.

### 5.8 RBAC & Auth (M0 — built)
- **FR‑A1** JWT login at `/api/v1/itsm/auth/login` returns `{access, refresh, user}`; `user` includes a `permissions` map (`{module_code: {read,create,update,delete}}`) for UI gating. `/auth/me` and `/auth/refresh` complete the flow.
- **FR‑A2** Every ViewSet declares a `module_code`; `HasModulePermission` maps HTTP method → CRUD action → `check_permission`. Per‑`@action` `module_code` override gates private comments and bulk ops independently.
- **FR‑A3** Permission resolution walks the dotted module tree (closest ancestor with an explicit grant wins), cached 5 min.

## 6. Non‑Functional Requirements

| Area | Requirement |
|---|---|
| **Security** | JWT (8 h access / 7 d refresh, rotation on). Module RBAC on every endpoint. All rich text sanitized with `bleach` on save (`sanitize_html`). UUID PKs (don't leak row counts in URLs/links). Soft delete preserves data. |
| **Performance** | Hot `Ticket` table carries 8 composite/single indexes (`(project,status)`, `(assignee,status)`, `(assigned_group,status)`, `(project,status,priority)`, `priority`, `due_date`, `resolved_at`, `ticket_number`). List endpoints `select_related` the display FKs. Pagination 25/page (client may raise to 500). SLA countdown returns absolute `due_at` so the client ticks locally — no per‑second server calls. |
| **Extensibility** | UUID PKs + shared `BaseModel`; one choke‑point per concern; config snapshots on the ticket (workflow chosen at create time) so later edits never strand in‑flight tickets. Multi‑department isolation lives in shared scoping primitives (`apps.itsm_helpdesks.services.accessible_helpdesk_ids` → clamps every ticket‑facing query by `project__helpdesk_id__in`); reserved hooks: channel registry (webhook/slack), digest job (off by default). |
| **Auditability** | Append‑only `AuditEvent` via explicit `log_event()` at every write site — **no Django signals** (greppable + lets us snapshot previous values). 22 audit action types. |
| **Reliability** | Cross‑engine side‑effects run in `transaction.on_commit` (a rolled‑back write never notifies). Engine hooks no‑op if the engine app isn't installed yet and swallow errors so a notification/SLA failure never breaks a ticket write. Numbering & round‑robin use `select_for_update`. Notification delivery is a durable outbox with `select_for_update(skip_locked)` + `dedupe_key`. |
| **Observability** | drf‑spectacular OpenAPI at `/api/v1/itsm/schema/` + Swagger at `/api/v1/itsm/docs/`. Hook failures logged to the `itsm` logger. |
| **Operability** | Idempotent `seed_itsm` management command (order‑sensitive, skips not‑yet‑built steps). Schedulers gated behind `RUN_SCHEDULER`. |

## 7. Success Metrics

| Metric | Target (MVP‑1) |
|---|---|
| End‑to‑end agent flow works (create→assign→comment→transition→resolve→close) | 100% via E2E (Playwright) |
| Ticket numbering uniqueness under concurrent creates | 0 collisions |
| Transition correctness (ordering, stale‑button 409, auto‑assign fairness) | Unit‑test green |
| RBAC correctness (Agent vs Supervisor, private‑comment gating) | Unit‑test green |
| SLA business‑time correctness (DST, holiday spanning, >1 day, pause cycles) | Unit‑test green |
| Notification dedupe / no double‑send | Unit‑test green; outbox idempotent |
| Seed idempotency | `seed_itsm` re‑runnable with no duplicates |
| Median queue list response | < 300 ms at seed scale |

## 8. Assumptions & Constraints
- Single organization (one install), but **multiple departments** via **Helpdesks** (`apps.itsm_helpdesks`) — IT, HR, … each a workspace with its own default Incident + Service Request projects and its own ticket‑number prefix. Visibility is governed by explicit `HelpdeskMembership`, not a tenant boundary.
- One ITSM role per user (helpdesk‑scoped RBAC roles are deferred — the same role applies across the user's helpdesks).
- Console email backend in dev; SMTP in prod (`FRONTEND_BASE_URL` drives deep‑links).
- Standalone product; no dependency on the host repo's `qa` / `project_management` apps.

## 9. Related Documents
See `README.md` for the full index. Key companions: `ERD.md`, `API_DESIGN.md`, `ROLES_PERMISSIONS_MATRIX.md`, `WORKFLOW_ENGINE.md`, `SLA_ENGINE.md`, `NOTIFICATION_ENGINE.md`, `ROADMAP.md`, `MVP_VS_FUTURE.md`.
