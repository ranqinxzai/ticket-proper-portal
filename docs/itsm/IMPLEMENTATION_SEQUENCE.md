# Implementation Sequence — ITSM Platform

Milestone‑by‑milestone build order, with **dependencies** and **exit criteria**. The strategy: ship a usable vertical slice (M0→M1), then have each engine progressively replace a hardcoded piece. **The entire M0–M10 backend is now DONE & validated**; only the frontend (M1+ UI) and M11/M12 close‑out remain. Each milestone heading is marked with its backend status.

See `ROADMAP.md` for the milestone table and sizes; this doc is the ordered build plan.

---

## Dependency graph
```
M0 ─▶ M1 ─┬─▶ M2
          ├─▶ M3 ─▶ M4 ─▶ M5 ─▶ M6
          ├─▶ M7
          └─▶ M8
M9 ─▶ M10
M11 (polish, after the feature set)   M12 (docs & skills)
```
Critical path: **M0 → M1 → M3 → M4 → M5 → M6**. M2/M7/M8 fan out from M1. M9 → M10. M11/M12 close out.

---

## M0 — Foundation  ✅ DONE
**Build:** `itsm_core` (BaseModel, AuditEvent + `log_event`, `sanitize_html`/`html_to_text`, hooks), `itsm_rbac` (Module/SystemRole/RoleModulePermission/RoleAssignment, `HasModulePermission`, `ItsmModelViewSet`, `check_permission`, module registry + Agent/Supervisor seed), JWT login/refresh/me, drf‑spectacular wiring, scheduler scaffold, `seed_itsm` skeleton. Frontend: shadcn primitives, JWT `ApiClient` + auth provider, `(itsm)` shell/nav, login.
**Depends on:** host Django/Next.js scaffold.
**Exit criteria:** login returns `{access, refresh, user(+permissions)}`; `/auth/me` works; a guarded ViewSet returns 403 without the grant; `seed_itsm` seeds modules + Agent/Supervisor idempotently; schema at `/api/v1/itsm/schema/`.

## M1 — Vertical slice  ✅ backend DONE
**Build:** `itsm_projects` (Project/TicketType + seed INC/REQ), `itsm_groups` (Group/Membership/round‑robin/RoutingRule + routing service), `itsm_workflows` (graph model + 2 seeded workflows + `engine.transition` + graph validators), `itsm_tickets` (Ticket first‑class columns + 8 indexes, `numbering`, comments public/private, watchers, links, attachments, mentions, `ticket_service`). REST for all of the above + ticket actions (transition/assign/comments/activity/links/watch). Frontend: basic Queue, Ticket Detail (fields + comments + history), static Create wizard.
**Depends on:** M0.
**Exit criteria:** create a ticket → auto `INC‑1`; auto‑route/assign; add public + internal comment (private hidden without the grant); transition New→Assigned→In Progress→Resolved with correct **409/422/403**; activity feed populated via `log_event`; numbering unique under concurrent creates; RBAC Agent vs Supervisor verified.

## M2 — Queues & list power  ✅ backend DONE
**Build:** `SavedFilter` + `query_builder` (`query_spec`→Q, whitelisted), bulk endpoint (`POST /tickets/bulk`, gated `itsm.tickets.bulk`). Frontend: saved queues, filter builder, column picker/group‑by, sticky bulk bar.
**Depends on:** M1.
**Exit criteria:** save/load a queue; filter builder maps to backend; bulk update/assign/transition across a selection respecting per‑action RBAC.

## M3 — Fields & dynamic forms  ✅ backend DONE
**Build:** field engine (`FieldDefinition`/`FieldOption`/`FieldValue` unique `(ticket,field)`/`FieldLayout`/`FieldLayoutItem`) + `field_service` (typed read/write + mandatory validation). Frontend: Layout Designer (dnd‑kit), `DynamicTicketForm` + `FieldControl` registry, runtime Zod from layout.
**Depends on:** M1.
**Exit criteria:** define a custom field bound to `(project, ticket_type)`; it appears on the create form (validated) and the detail panel; multiselect stored in `value_json`.

## M4 — Workflow engine (full)  ✅ backend DONE
**Build:** complete the builder round‑trip — `GET/PUT /workflows/{id}/graph` (atomic node+edge persist), `validate` (built) + `publish` (copy‑on‑publish versioning), transition **screens** wired to the validator stage. (Conditions/validators/post‑functions/ordering already exist in `engine.py`.) Frontend: React Flow builder (StatusNode/TransitionEdge/Inspector), transition dialogs from `available-transitions`.
**Depends on:** M3 (screens reference fields).
**Exit criteria:** build a workflow visually, validate it (1 initial / reachable / ≥1 Done), publish a new version without stranding live tickets; transition screens enforce mandatory fields (422).

## M5 — SLA engine  ✅ backend DONE & validated
**Build:** `itsm_sla` — `business_time` (DST/holiday‑correct, guarded), calendars/holidays, policies/metrics/targets, `SLATracker` + pause/resume (recompute from first principles), breach sweep + escalations (idempotent ledger), countdown payload `GET /tickets/{id}/sla`. Wire `hooks.sla_*` to real engine. Frontend: SLA policy editor, countdown/RAG widgets (tick locally from `due_at`).
**Depends on:** M4 (transition SLA post‑functions: pause/resume/stop).
**Exit criteria:** `business_time` unit tests green (DST, holiday‑spanning, >1 day, start‑in‑gap, 0‑day guard); pause/resume recompute correct across cycles; sweep flips breach + escalates **once**.

## M6 — Notifications  ✅ backend DONE & validated
**Build:** `itsm_notifications` — `bus.emit` (on‑commit, never raises), schemes/rules + recipient resolvers + dedupe/suppress‑actor, email templates (autoescape + bleach + absolute links), `InAppNotification`, transactional outbox + flusher (`skip_locked`, `dedupe_key`, backoff, reaper), inbox endpoints. Wire `hooks.emit_event` to real bus. Frontend: notification bell + inbox popover, scheme + email‑template editor, @mention.
**Depends on:** M4/M5 (events to notify on).
**Exit criteria:** create/assign/comment/transition/SLA events produce in‑app rows + (console) emails; **no double‑send**; actor suppressed; rolled‑back write notifies no one.

## M7 — Canned notes & templates  ✅ backend DONE
**Build:** `CannedNote(+Category)`, `TicketTemplate(+Category)`, `POST /tickets/{id}/apply-template`. Frontend: library editors, composer canned‑note inserter, template prefill in the create wizard.
**Depends on:** M1 (comments/create), benefits from M3 (template field values).
**Exit criteria:** insert a canned note into the composer; create from a template; apply a template to an existing ticket (logged `template_applied`).

## M8 — Groups & project config  ✅ backend DONE
**Build:** group membership management + routing UI; project configuration hub. (Group/Membership/RoutingRule models are already built in M1.)
**Depends on:** M1.
**Exit criteria:** manage members (member/lead), add routing rules, set a project's default workflow/group/calendar/scheme from one hub.

## M9 — Reports  ✅ backend DONE (live query services)
**Build:** `itsm_reporting` — live query services (`services/reports.py`: open-tickets/by-status/by-priority/by-group/agent-performance/sla-compliance/resolution-trends/volume-trends; `services/widget_data.py`) exposed at `reports/` + `reports/<name>/`. (Nightly snapshot tables `TicketDailyStat`/`AgentDailyStat`/`SLAComplianceStat` via `reporting.aggregate_nightly` remain a future optimization — current reports compute live.) Frontend: `ReportShell` + Recharts + table + CSV.
**Depends on:** M1 (data), M5 (SLA compliance report).
**Exit criteria:** SLA‑compliance and agent‑performance reports render and export (live query services built; the nightly snapshot job is the deferred optimization).

## M10 — Dashboard builder  ✅ backend DONE
**Build:** `itsm_dashboards` — `Dashboard`/`Widget`/`DashboardShare` endpoints over `SavedFilter`. Frontend: react‑grid‑layout + widget registry (KPI/pie/bar/trend/SLA‑gauge/ticket‑list).
**Depends on:** M2 (`SavedFilter`/`query_builder`), M9 (report aggregates).
**Exit criteria:** build a dashboard by dragging widgets, each backed by a saved filter; share with a user/role/group.

## M11 — Polish
**Build:** perf/indexes review, idempotent seeds hardened; responsive layouts, skeletons, a11y, ⌘K, error boundaries.
**Depends on:** the feature set.
**Exit criteria:** queue list < 300 ms at seed scale; responsive shell; no unhandled error states; ⌘K navigates.

## M12 — Docs & skills
**Build:** `docs/itsm/*` (these 17 deliverables + index) and `.claude/skills/*` per module (7‑file structure) + module map.
**Exit criteria:** docs accurate to built code and aligned to the plan; skills index complete.

---

## Cross‑milestone invariants (hold at every step)
- Every ticket write goes through `ticket_service` / `workflow_service`; side‑effects on `transaction.on_commit`.
- Audit via explicit `log_event` (no signals).
- New ViewSets declare a `module_code`; private/bulk use per‑action overrides.
- Engine `hooks` no‑op until the engine app ships, so the domain stays usable throughout.
- `seed_itsm` stays idempotent and dependency‑ordered.
