# Tech Stack — ITSM Platform

The platform is a fresh, self‑contained build inside `/home/santhosh/ticketingsystem-pilot`. The host repo's Docker + Nginx + Django/DRF/Next.js scaffolding is only the host; ITSM has its own apps, API namespace, and Next.js route shell.

---

## 1. Backend

| Concern | Choice | Rationale |
|---|---|---|
| Language / framework | **Django 5 + Django REST Framework** | Mature ORM, migrations, admin; DRF for serializers, routers, viewsets. |
| Database | **PostgreSQL 16** | JSONB (query_spec, post_functions, audit payloads), partial/GIN indexes, strong concurrency for `select_for_update`. |
| Primary keys | **UUID** (throughout) | Stable external IDs; don't leak row counts in URLs / webhooks / email deep‑links. |
| Auth | **`djangorestframework-simplejwt`** (JWT) | Stateless agent app; access 8 h / refresh 7 d, rotation on; `Bearer` header. |
| AuthZ | **Module RBAC** (native) | `Module`/`SystemRole`/`RoleModulePermission` + `HasModulePermission`; per‑ViewSet `module_code`, per‑action override. |
| API docs | **`drf-spectacular`** (OpenAPI) | Schema at `/api/v1/itsm/schema/`, Swagger UI at `/api/v1/itsm/docs/`. |
| Filtering | **`django-filter`** + DRF Search/Ordering | Declarative `filterset_fields`, `?search=`, `?ordering=`. |
| HTML safety | **`bleach`** | Sanitize every rich‑text body on save (`sanitize_html`) + plain mirror (`html_to_text`). |
| Scheduled jobs | **APScheduler + `django-apscheduler`** | SLA breach sweep, notification outbox flush/reaper, email inbound poll + failed‑retry, nightly reporting; one `DjangoJobStore`, gated by `RUN_SCHEDULER`. |
| Attachments | **Pillow** | Image attachment handling. |
| Email channel | **`cryptography`** (Fernet) + stdlib **`imaplib`/`poplib`/`email`** | Bidirectional email: inbound IMAP/POP polling (stdlib) → ticket/comment; credentials encrypted at rest with Fernet (`EncryptedField`, key from `ITSM_CREDENTIAL_KEY`/`SECRET_KEY`); **XOAUTH2** for Gmail / Microsoft 365 (no extra SDK). See `EMAIL_CHANNEL.md`. |
| Audit | explicit `log_event()` (**no signals**) | Greppable, captures previous values, no hidden fan‑out. |

### Key backend settings (real)
- `AUTH_USER_MODEL = "accounts.User"` (shared login; `full_name` field).
- `DEFAULT_PAGINATION_CLASS = StandardPagination` (page‑number, `PAGE_SIZE=25`, `max_page_size=500`).
- `SIMPLE_JWT`: 8 h access, 7 d refresh, `ROTATE_REFRESH_TOKENS=True`, `Bearer`, `USER_ID_FIELD/CLAIM=id/user_id`.
- `SPECTACULAR_SETTINGS`: title "ITSM Platform API", `COMPONENT_SPLIT_REQUEST=True`.
- `RUN_SCHEDULER` (env, default off); schedulers skip `migrate/seed_itsm/loaddata/dumpdata/createsuperuser`.
- `EMAIL_BACKEND` = console (dev) → SMTP (prod); `FRONTEND_BASE_URL` for deep‑links.
- Email channel: `ITSM_CREDENTIAL_KEY` (Fernet), `EMAIL_DOMAIN`/`EMAIL_REPLY_TO_LOCALPART` (plus‑addressing), `EMAIL_POLL_INTERVAL_SECONDS`/`EMAIL_RETRY_INBOUND_MINUTES`, `EMAIL_MAX_MESSAGE_BYTES`/`EMAIL_MAX_INBOUND_ATTEMPTS`, `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `MICROSOFT_OAUTH_CLIENT_ID/SECRET/TENANT`, `EMAIL_OAUTH_REDIRECT_URI` (see `EMAIL_CHANNEL.md`).

## 2. Frontend

| Concern | Choice | Rationale |
|---|---|---|
| Framework | **Next.js 14 (App Router) + React 18** | Standalone `(itsm)` route group, nested layouts, fast nav. |
| Language | **TypeScript** | Typed API modules + domain models. |
| Styling | **Tailwind CSS** | Utility‑first, consistent design system. |
| Component kit | **shadcn/ui** | Owned, accessible primitives (copy‑in), themable. |
| Forms | **react-hook-form + Zod** | Performant forms; runtime Zod from field layout for dynamic forms. |
| Server state | **@tanstack/react-query** | Caching, pagination, optimistic inline edits. |
| UI state | **Zustand** | Lightweight ephemeral UI (filters, selection, composer, layout). |
| Tables | **@tanstack/react-table + @tanstack/react-virtual** | Headless, virtualized ticket queues. |
| Charts | **Recharts** | Reports + dashboard widgets. |
| Rich text | **Tiptap** (+ mention) | Comments, descriptions, email templates; clean HTML (server still sanitizes). |
| Workflow canvas | **@xyflow/react** (React Flow) | Status nodes / transition edges (`canvas_x/y`). |
| Layout designer | **@dnd-kit** | Accessible drag‑and‑drop for field layouts. |
| Dashboard grid | **react-grid-layout** | Draggable/resizable widget grid. |
| Command palette | **cmdk** | ⌘K global search/navigation. |
| Dates | **date-fns + react-day-picker** | Ranges, business‑hours editing. |
| Toasts | **sonner** | Action feedback. |

## 3. Infrastructure
- Existing **Docker Compose + Nginx** (host). Add env: `RUN_SCHEDULER`, SMTP (prod) / console email (dev), `FRONTEND_BASE_URL`.
- OpenAPI/Swagger served by the backend; the frontend consumes via the typed `lib/itsm/api/*` modules.

## 4. Boundaries
- ITSM does **not** depend on or couple to the host repo's `qa` / `project_management` apps. Separate Django apps, separate `/api/v1/itsm/` namespace, separate Next.js `(itsm)` shell.
- Single shared `accounts.User` is the only shared surface; ITSM access is governed entirely by its own RBAC.
