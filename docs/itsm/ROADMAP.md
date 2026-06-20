# Roadmap — ITSM Platform (M0–M12)

A vertical slice ships first; each engine then progressively replaces a hardcoded piece. Every milestone is a working, demoable increment. Sizes: S / M / L.

**Current status: the M0–M10 backend is DONE and validated, and the frontend CORE is built** (JWT auth + shell + login, ticket queue with bulk ops, 2-pane ticket detail with transitions/comments/SLA, 3-step create wizard). Remaining frontend work is the heavier admin builders (visual workflow canvas, layout designer, SLA/notification editors, drag-grid dashboard builder), plus M11/M12 close-out. Docs (`docs/itsm/*`) and skills (`.claude/skills/*`) are written.

---

## Milestone Table

| M | Milestone | Backend | Frontend | Size | Status |
|---|---|---|---|---|---|
| **M0** | Foundation | `itsm_rbac` (+ role binding on User), JWT + spectacular wiring, `itsm_core` base + sanitizer + audit + hooks, scheduler scaffold, seed skeleton | shadcn primitives, `lib/itsm/client.ts` (JWT) + `auth.tsx`, `(itsm)` shell/nav, login | M | **DONE** |
| **M1** | **Vertical slice** create→assign→transition→resolve | `itsm_projects` + `itsm_groups` + `itsm_tickets` core (numbering, Comment public/private, AuditEvent), `itsm_workflows` model + linear seeded workflow + transition engine | Queue (basic), Ticket Detail (fields + comments + history), Create wizard (static) | L | **Backend DONE; FE in progress** |
| **M2** | Queues & list power | `SavedFilter` + `query_builder`, bulk endpoint | Saved queues, filter builder, column/group, bulk bar | M | Backend DONE; FE upcoming |
| **M3** | Fields & dynamic forms | field engine + layouts + `field_service` | Layout Designer (dnd‑kit), `DynamicTicketForm`/`FieldControl`, runtime Zod | L | Backend DONE; FE upcoming |
| **M4** | Workflow engine (full) | `itsm_workflows` full (conditions/validators/post‑funcs already present; add builder persist + versioning + publish) | React Flow builder, transition screens, `availableTransitions` | L | Backend DONE; FE upcoming |
| **M5** | SLA engine | `itsm_sla` (business_time, trackers, pause/resume, sweep, escalations) | SLA policy editor, countdown/RAG widgets | L | Backend DONE & validated; FE upcoming |
| **M6** | Notifications | `itsm_notifications` (bus, outbox, flusher, schemes, templates) | Notification bell/inbox, scheme + email editor, @mention | M | Backend DONE & validated; FE upcoming |
| **M7** | Canned notes & templates | `CannedNote` / `TicketTemplate` + apply‑template | Library editors, composer inserter, template prefill | S‑M | Backend DONE; FE upcoming |
| **M8** | Groups & project config | `itsm_groups` (membership, routing, round‑robin — present) + project config hub | Groups mgmt, project config hub | S‑M | Backend DONE; FE upcoming |
| **M9** | Reports | report query services | ReportShell + Recharts + CSV | M | Backend DONE; FE upcoming |
| **M10** | Dashboard builder | dashboards/widgets/share endpoints | react‑grid‑layout + widget registry | L | Backend DONE; FE upcoming |
| **M11** | Polish | perf/indexes, idempotent seeds | responsive, skeletons, a11y, ⌘K, error boundaries | M | Upcoming |
| **M12** | Docs & skills | — | Write `docs/itsm/*` + `.claude/skills/*`, index | M | In progress (these docs) |
| **M13** | **Email Channel** | `itsm_email` (IMAP/POP poll → ticket/comment via `ticket_service`, Google/MS OAuth2 XOAUTH2 + basic, Fernet creds, threaded outbox via `email_thread_headers`, guards, inbound log + retry, `email-bot` seed, RBAC modules) | `(itsm)/admin/email` (channels + rules) + `…/admin/email/logs` (log + retry) | M | **DONE** |

## Critical Path
```
M0 → M1 (usable product)
M2, M3 fan out from M1
M4 needs M3 (fields/screens)        M5 needs M4 (transition SLA ops)
M6 needs M4/M5 events               M9 → M10
M7, M8 slot opportunistically after M1/M3
```

## Frontend build state
**The agent-experience core is built** as a standalone `(itsm)` Next.js route group (compiles clean, `next build` succeeds): `lib/itsm/` (JWT client with auto-refresh, typed API, auth provider/guard), `components/itsm/` (shell + nav, notification bell w/ inbox, Tiptap editor, comment section w/ public/internal + canned notes, SLA panel w/ live countdown, transition dialog handling 409/422, activity feed), and pages `itsm-login`, `(itsm)/queues` (filters + bulk bar), `(itsm)/tickets/[key]` (2-pane detail), `(itsm)/tickets/new` (3-step wizard with dynamic field layouts). Admin/dashboards/reports are permission-gated scaffolds. Heavier builders (workflow canvas, layout designer, SLA/notification editors, dashboard grid) remain.

## Backend build state
**All M0–M10 backend apps are built and validated** (`itsm_core` incl. the field engine, `itsm_rbac`, `itsm_projects`, `itsm_groups`, `itsm_workflows`, `itsm_tickets` incl. canned notes/templates + `query_builder`, `itsm_sla`, `itsm_notifications`, `itsm_reporting`, `itsm_dashboards`). Migrations exist for each, `seed_itsm` runs idempotently end-to-end, and the SLA + notification schedulers boot under `RUN_SCHEDULER`. The remaining work is the frontend (M1+ UI) and M11/M12 polish/docs. The detail below documents the M0/M1 baseline.

## What "DONE & validated" means for M0/M1
- **M0:** `itsm_core` (BaseModel, AuditEvent + `log_event`, `sanitize_html`/`html_to_text`, cross‑engine hooks) and `itsm_rbac` (Module/SystemRole/RoleModulePermission/RoleAssignment, `HasModulePermission`, `check_permission`, JWT login/refresh/me, module registry + Agent/Supervisor seed) are implemented and wired in `INSTALLED_APPS` + `/api/v1/itsm/`.
- **M1 backend:** `itsm_projects` (Project/TicketType + seed), `itsm_groups` (Group/Membership/RoutingRule/round‑robin + routing service), `itsm_workflows` (full graph model + seed of 2 workflows + transition engine + graph validators), `itsm_tickets` (Ticket first‑class columns + 8 indexes, numbering, comments public/private, watchers, links, attachments, mentions, ticket_service). REST endpoints live for projects, ticket‑types, groups, memberships, routing‑rules, workflows/statuses/transitions, tickets (+ transition/assign/comments/activity/links/watch).
- **Validation:** the `seed_itsm` command runs idempotently in dependency order; the migration set for the built apps exists (e.g. `itsm_tickets/migrations/0001_initial.py`).

## Verification gates per milestone
- **M1:** numbering uniqueness under concurrency; transition ordering + 409/422/403; RBAC Agent vs Supervisor + private‑comment gating; seed idempotency.
- **M5:** `business_time` (DST, holiday spanning, >1 day, start‑in‑gap, 0‑business‑day guard); pause/resume recompute; idempotent breach sweep.
- **M6:** notification dedupe / no double‑send; recipient resolution; outbox at‑least‑once.
- **E2E (M11/M12):** the full Playwright path (create INC‑1 → assign → comment public + internal → canned note → transition to Resolved → verify SLA RAG/breach → verify in‑app + console email → bulk update → build a widget → run SLA report).
