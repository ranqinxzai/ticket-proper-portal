# Multi-Tenancy (schema-per-org)

The pilot serves many independent organisations ("orgs"/tenants) from one running
instance, with **hard two-way data isolation** — nothing from org A is visible to org B.
Implemented with [`django-tenants`](https://django-tenants.readthedocs.io/): **one
Postgres schema per org**. Routing is by **URL path** (`/t/<org>/…`), not subdomain.

This was added as a *layer over* the existing single-tenant app: the ~17 ITSM apps,
their models, views, querysets, serializers and the 8 helpdesk guard-points are
**unchanged** — they simply run inside whichever org's schema the request selected.

## How a request is scoped

```
GET /api/v1/t/acme/itsm/tickets/
        │
  PathTenantMiddleware (apps/tenants/middleware.py)   ← first middleware
   • set_schema_to_public(); look up Client(schema_name="acme", is_active=True)
   • connection.set_tenant(acme)            → Postgres search_path = acme,public
   • rewrite path_info → /api/v1/itsm/tickets/   (existing URLconf, untouched)
        │
  existing TicketViewSet etc. run verbatim, now seeing only acme's rows
```

Unmatched paths (`/api/v1/admin/…` console, `/admin/` Django admin, `/api/v1/healthz`,
static/media) stay in the `public` schema.

## Schema topology (`core/settings.py`)

- **SHARED (`public`)** — org registry (`apps.tenants`: `Client`+`Domain`), platform-admin
  users (`apps.accounts` — public copy holds ONLY platform super-admins), and the single
  scheduler job store (`django_apscheduler`). No org/business data here.
- **TENANT (per-org schema)** — `apps.accounts` (org users), `apps.core`, all `apps.itsm_*`,
  plus framework tables (auth/contenttypes/sessions/admin).

`apps.accounts` is in BOTH lists (public = platform admins; per-org = that org's users).
Because every business FK stays inside one schema, there are **no cross-schema FKs**.

In **test mode** (`"test" in sys.argv`) the split is flattened (all apps SHARED) so the
existing `TestCase` suite runs in one schema unchanged; isolation is covered by the
integration rehearsal below.

## Security: the JWT tenant claim

Integer PKs collide across schemas, so a token must be bound to its org. Login
(`ItsmTokenObtainPairSerializer.get_token`) stamps `tenant=<schema>` into the JWT;
`apps.tenants.auth.TenantAwareJWTAuthentication` rejects any request whose active schema
≠ the token's `tenant` (cross-org replay → **401**).

The org binding holds for the **whole token lifecycle**, not just the access leg, and at
**all three layers** (added 2026-06-28):

1. **Access token (every request)** — `TenantAwareJWTAuthentication` (above).
2. **Refresh token** — the refresh endpoint is anonymous (token in the body, not the
   Authorization header), so the stock `TokenRefreshView` only checks the signature.
   `apps.tenants.jwt.TenantAwareTokenRefreshView` adds the same `tenant`-claim check, so an
   org-A refresh token presented at `/t/orgB/itsm/auth/refresh/` is rejected (**401**)
   instead of minting a fresh access token. *(It lives in `jwt.py`, not `auth.py`, because
   `auth.py` is imported during DRF settings init and can't pull in
   `rest_framework_simplejwt.views` without a circular import.)*
3. **Auth backends are JWT-only in production** — `REST_FRAMEWORK.DEFAULT_AUTHENTICATION_CLASSES`
   contains **only** `TenantAwareJWTAuthentication` when `DEBUG=False`. Session + Basic auth do
   NOT enforce the org binding, so they're added back only under `DEBUG` (browsable-API
   convenience). Both frontends authenticate exclusively with JWT.

### Frontend: per-org session storage

Schema isolation makes the *server* tenant-safe, but the browser must not blur orgs either.
The ITSM client (`frontend/lib/itsm/client.ts`) namespaces every session value by org —
`itsm_access:<org>`, `itsm_refresh:<org>`, `itsm_user:<org>` (via `orgKey()`), keyed off the
`/t/<org>/` segment. Two orgs opened in the same browser keep fully independent sessions, and
opening org B can **never** surface a leftover org-A login (it lives under a different key).
`itsm_org` stays global — it only records the last active org for the pre-mount fallback in
`getApiOrg()`. (On deploy, any pre-existing session under the old bare keys is simply not
found, so users re-login once — intended.)

## Background jobs

The APScheduler jobs (SLA sweep, notification flush, email poll) run in `public` and loop
every active org via `apps.tenants.runtime.for_each_tenant` (which runs the unchanged job
body inside each schema). The job store stays in `public`.

## Provisioning orgs

`apps.tenants.services.provision_org(name, slug, admin_*)` creates the schema (+ runs
tenant migrations), seeds it (`seed_itsm`), and creates the org's first admin (a superuser
*within that schema* = the org owner). Reached two ways:

- **Web console** (platform super-admins): `/console` → `/api/v1/admin/orgs/` (login, list,
  create, enable/disable, reset-admin-password). Console auth is separate from org auth
  (distinct `console_*` localStorage keys; token `tenant="public"`).
- **CLI**: `python manage.py create_org <slug> --name "…" --admin-username … --admin-password …`
  (and `delete_org`, `create_platform_admin`). Named `create_org`/`delete_org` to avoid
  django-tenants' own `create_tenant`/`delete_tenant`, which skip the seed + admin step.

Migrations: `migrate_schemas --shared` (public) then `migrate_schemas --tenant` (every org)
— wired into the backend `entrypoint.sh`.

## One-time legacy conversion (pre-multitenancy DB → first org)

`python manage.py migrate_legacy_to_tenant --slug demo --name "…"` converts an old
single-tenant DB by **renaming** the existing `public` schema (all data, intact) to the
org schema, then building a fresh `public` for shared infra and registering the org. No
row copying; sequences/constraints/data preserved. It refuses to run if `public` already
has `tenants_client` (i.e. shared infra was built first) — run it BEFORE any
`migrate_schemas` on a legacy DB.

### Live cutover runbook (downtime ~minutes; backup first)

```
# 0. fresh backup
docker compose exec -T ticketpilot-db pg_dump -U postgres -Fc ticketing_pilot > backups/pre-mt-$(date +%F-%H%M).dump
# 1. build new images (does NOT restart running containers)
docker compose build
# 2. stop the backend so nothing migrates the un-converted DB
docker compose stop ticketpilot-backend
# 3. one-off conversion with the NEW image, entrypoint overridden (no auto-migrate)
docker compose run --rm --no-deps --entrypoint sh ticketpilot-backend -c \
  "python manage.py migrate_legacy_to_tenant --slug demo --name 'Demo Organisation' --yes && \
   python manage.py create_platform_admin --username root --password '<SET>' --email ops@…"
# 4. bring the whole stack up on the new images (entrypoint migrate_schemas is now idempotent)
docker compose up -d --build
```
After cutover: existing users log in at `/t/demo/login` with their existing credentials;
platform admins manage orgs at `/console`.

### Rollback

Code: `git checkout main` (work is on `feat/multi-tenant`). DB: restore the dump —
`pg_restore --clean --if-exists -U postgres -d ticketing_pilot <backup>.dump`. The cutover
was rehearsed end-to-end on a clone (`ticketing_mtrehearsal`) before going live.

## What was deliberately NOT changed

The helpdesk scoping (8 guard-points, `accessible_helpdesk_ids`), every `get_queryset`,
ticket numbering, serializers, and all business logic. Helpdesks remain *departments
inside* an org. `SystemRole.org` (the old reserved UUID hook) is superseded by schema
isolation and left NULL.
