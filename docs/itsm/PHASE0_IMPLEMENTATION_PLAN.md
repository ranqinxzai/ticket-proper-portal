# Phase 0 implementation plan — the five top gaps

_Prepared 2026-10-14. Companion to `ROADMAP_2026-2027.md` §2. Every file path below was
checked against the working tree on that date. Sizes: S ≤ 3 days, M ≤ 2 weeks._

| # | Gap | Size | Migration? | Prod impact |
|---|-----|------|-----------|-------------|
| 1 | Attachments publicly downloadable | M | no (path change only for new uploads) | nginx + backend + frontend redeploy |
| 2 | Auth hardening (throttle, lockout, token revoke, password policy) | S–M | yes: `token_blacklist`, `axes` ×4 schemas | backend + nginx redeploy; users re-login once |
| 3 | Release discipline + CI + e2e repair | S–M | no | none at runtime |
| 4 | Bulk actions UI, @mentions, live detail + stale-write guard | M | no | backend + frontend redeploy |
| 5 | Observability + scheduler resilience + ops cron | S–M | no (reuses `django_apscheduler` tables) | backend/scheduler redeploy, compose edit |

Recommended order: **3 → 1 → 2 → 5 → 4.** Item 3 first so items 1, 2, 4, 5 each ship as a
tagged, CI-tested release. Item 1 before 2 because it is the only real data-exposure.
Item 4 last because it is the largest and purely additive.

---

## 1. Lock down `/media/`

### Problem (verified)
- `nginx/default.prod.conf:48` — `location /media/ { alias …; }` serves every upload to
  anyone with the URL. No auth, no tenant check.
- `backend/core/urls.py:46` also mounts `static(settings.MEDIA_URL, …)` unconditionally.
- Upload paths carry no tenant: `itsm_attachments/ticket/<ticket_uuid>/<name>` and
  `itsm_attachments/comment/<ticket_uuid>/<name>` (`itsm_tickets/models.py:210,250`).
- Serializers return the raw `file` URL (`TicketAttachmentSerializer`,
  `CommentAttachmentSerializer`, `PortalAttachmentSerializer` in `portal.py:55`), and inline
  images are embedded **by that URL** inside `Comment.body_html` (sanitizer allows
  `img[src]`, `itsm_core/services/html.py:26`). The frontend uses `a.file` directly for
  `href` and `<img src>` (`ticket-detail.tsx:492,943,1786,1918`).
- Browser-native loads (`<img>`, `<a download>`) cannot send the Bearer JWT that lives in
  localStorage, so a plain "require auth on /media/" would break every image and link.

### Approach: signed, expiring URLs + nginx `internal` + `X-Accel-Redirect`
One choke point signs, nginx never serves media directly.

**Backend**
1. `apps/itsm_core/services/media.py` (new):
   - `sign_media_path(path, ttl=timedelta(hours=1)) -> str` using
     `django.core.signing.TimestampSigner(salt="media")`; returns
     `/api/v1/t/<schema>/itsm/files/<path>?s=<sig>`.
   - `verify_media_sig(path, sig, max_age)`.
   - `rewrite_media_urls(html) -> html`: regex over `src="/media/…"` and `href="/media/…"`
     replacing with signed URLs. Called **on read** only.
   - `strip_media_sigs(html) -> html`: inverse, called in `sanitize_html` so stored bodies
     keep canonical `/media/...` paths (no secrets in the DB, re-signable forever).
2. `apps/itsm_core/views.py`: `ProtectedMediaView(APIView)` at
   `files/<path:path>/`, `permission_classes=[AllowAny]`, `authentication_classes=[]`
   (the signature is the credential). Verifies sig + expiry, confirms the path belongs to
   the active schema (prefix check, see 4 below; legacy un-prefixed paths are looked up by
   `file=` in `TicketAttachment`/`CommentAttachment` to confirm they exist in **this**
   schema), then returns `HttpResponse()` with `X-Accel-Redirect: /_protected_media/<path>`,
   `Content-Type`, `Content-Disposition: inline|attachment; filename=original_name`.
   Under `DEBUG` fall back to `FileResponse` so local dev works without nginx.
3. Serializers: keep the field name `file` (zero frontend churn) but source it from
   `sign_media_path(obj.file.name)`. Apply in `TicketAttachmentSerializer`,
   `CommentAttachmentSerializer`, `PortalAttachmentSerializer`, and
   `CommentSerializer.body_html` (+ `TicketDetailSerializer.description_html`) via
   `rewrite_media_urls`. The upload response already returns the serializer, so the editor
   embeds a signed URL; `sanitize_html` strips it back to canonical on save.
4. Tenant prefix for new uploads: `ticket_attachment_path` →
   `f"{connection.schema_name}/itsm_attachments/ticket/{ticket_id}/{filename}"` (same for
   comment + branding). No migration: `FileField` stores the path. Optional one-off
   `scripts/move_media_into_tenant_prefix.py` for old files (idempotent, updates `file`).
5. `core/urls.py`: wrap the `static(MEDIA_URL…)` mount in `if settings.DEBUG:`.
6. `core/settings.py`: `MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", BASE_DIR / "media"))`
   (also fixes the read-only-mount test gotcha).
7. Branding logo: it is shown on the **login page before auth**. Keep it public on purpose:
   serve `/media/<schema>/branding/` from a dedicated public nginx location (logos are not
   sensitive); everything else is `internal`.
8. Email: check `itsm_notifications/services/email_layout.py` / templates — if any email
   body embeds comment HTML, run `rewrite_media_urls(html, ttl=7 days)` at render time;
   otherwise nothing to do (grep found no `/media/` in outbound code).

**nginx** (`nginx/default.prod.conf`)
```nginx
location /media/        { return 404; }                    # nothing public by default
location ~ ^/media/[^/]+/branding/ { alias /var/www/ticket/media/; expires 7d; }  # logos (see 7)
location /_protected_media/ { internal; alias /var/www/ticket/media/; }
```
`/api/` already proxies to Django; the `files/<path>` route rides on it.

**Frontend** — no code change for `href`/`src` (still `a.file`). Only: image URLs now
expire, so a ticket left open > 1 h shows broken thumbnails until the next `load()`; item 4's
live poll re-signs them. Add `onError` → refetch on `<img>` in the attachments list (S).

**Tests** (add to `itsm_tickets/tests.py` + new `itsm_core/tests_media.py`)
- Unsigned, expired, tampered sig → 403/404; valid → `X-Accel-Redirect` header.
- Org-A signature replayed at `/t/orgB/.../files/` → 404 (schema check).
- `sanitize_html` round-trip: signed `src` in → canonical `/media/` path stored → signed on read.
- Existing `test_upload_to_inaccessible_helpdesk_is_403` stays green.

**Rollout**: build backend+frontend → `up -d` → **`docker restart ticketprod-nginx`**
(static upstream gotcha) → verify: old raw `/media/...` URL → 404; attachment opens from the
UI; inline image renders; portal attachment downloads; login page logo renders.

---

## 2. Auth hardening

### Problem (verified)
- `REST_FRAMEWORK` has no throttle classes; nginx has no `limit_req`.
- `SIMPLE_JWT`: 8 h access, `BLACKLIST_AFTER_ROTATION=False`, `token_blacklist` app not
  installed → logout, password change, and admin "deactivate" leave tokens valid for up to 7 d.
- `ChangePasswordView` docstring admits "the JWT the caller is holding stays valid".
- Password validators: only Django's minimum length (`settings.py:169`).
- No lockout on repeated failures. `DEBUG` defaults to `True` in code.

### Changes
**a. Throttling (DRF)**
```python
REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"] = ["rest_framework.throttling.UserRateThrottle"]
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {
    "user": "600/min",      # generous: queue pulse 15 s + bell 60 s + drilldowns
    "auth": "10/min",       # login, refresh, sso/exchange, platform login
    "password": "5/min",    # change-password, (future) forgot-password
    "portal-intake": "30/min",
}
```
`ScopedRateThrottle` with `throttle_scope` on `ItsmLoginView`, `TenantAwareTokenRefreshView`,
`MicrosoftSsoExchangeView`, `PlatformLoginView`, `ChangePasswordView`,
`PortalRequestIntakeViewSet`. Note: with the LocMem cache each gunicorn worker counts
separately (3× looser). Acceptable now; Redis in Q1 makes it exact.

**b. Login lockout** — `django-axes` (6.x), `AxesDatabaseHandler`, in **TENANT_APPS** (usernames
are per schema), `AXES_FAILURE_LIMIT=5`, `AXES_COOLOFF_TIME=timedelta(minutes=15)`,
`AXES_LOCKOUT_PARAMETERS=[["username", "ip_address"]]`, `AxesMiddleware` after
`PathTenantMiddleware`. SimpleJWT's serializer calls `authenticate(request=…)` so axes sees
the attempts. Add the axes backend **before** `CaseInsensitiveModelBackend`. Return a clear
423/403 message in `ItsmTokenObtainPairSerializer` (same pattern as the SSO-only message).

**c. Token revocation** — add `rest_framework_simplejwt.token_blacklist` to **both** SHARED and
TENANT lists (its FK is to `accounts.User`, which is in both). `BLACKLIST_AFTER_ROTATION=True`,
`ACCESS_TOKEN_LIFETIME=45 min` (refresh is transparent in `lib/itsm/client.ts` single-flight).
New endpoints: `POST auth/logout/ {refresh}` (blacklist) and a helper
`revoke_all_tokens(user)` used by `ChangePasswordView`, `MemberViewSet.reset_password`,
`MemberViewSet.set_active(False)`. Frontend `auth.tsx:logout()` posts to the endpoint before
clearing storage. Platform console gets the same on `apps/tenants/urls.py`.

**d. Password policy** — `AUTH_PASSWORD_VALIDATORS`: MinimumLength(10), CommonPassword,
NumericPassword, UserAttributeSimilarity. Applies to change-password, `create_user`,
`reset_password`, `create_org`. Leave existing passwords alone (no forced rotation).

**e. nginx** (`nginx/default.prod.conf`)
```nginx
set_real_ip_from 172.16.0.0/12;  real_ip_header X-Forwarded-For;  # edge → real client IP
limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;
location ~ ^/api/v1/(t/[^/]+/)?(itsm|admin)/auth/(login|refresh|sso/exchange)/ {
    limit_req zone=auth burst=10 nodelay;  proxy_pass http://prod_backend;  …headers…
}
```
Without `set_real_ip_from` the zone would key on the edge container's IP and throttle everyone.

**f. Fail-closed settings** — `SECRET_KEY` raises if unset unless `"test" in sys.argv`;
`DEBUG` default `False`. Prod env already sets both; this only protects future installs.

**Tests**: 6 bad logins → locked for the 7th even with the right password; logout → refresh
401; change-password → old refresh 401; throttle 429 on 11th login/min; cross-tenant refresh
still 401 (existing `apps/tenants` behaviour).

**Rollout**: migrations ×4 schemas via `entrypoint.sh` (automatic). Users with 8 h tokens
keep working until expiry, then refresh normally. Tell admins: "5 wrong passwords = 15 min lock."

MFA (TOTP) stays in Q4 as per roadmap; Entra conditional access covers SSO tenants today.

---

## 3. Release discipline, CI, e2e repair

### Problem (verified)
- ~20 uncommitted files incl. migration `itsm_core/0012`, the frozen-header xlsx + sticky
  queue/report headers and the density toggle (all DEPLOYED to prod on 2026-10-15 from the
  dirty tree), two one-off gridcrest scripts, skill/doc edits.
- No `.github/`. No `npm test`. `core/settings_test.py` is SQLite → broken under
  django-tenants. Playwright config targets the dead pilot URL; specs use pre-`/t/[org]`
  routes, un-namespaced token keys, and a removed "Request Catalog" link.
- Deploy = memory-driven (`build` → `up -d` → `restart ticketprod-nginx`).

### Changes
**a. Checkpoint and tag**
1. Commit the working tree on `main` as `chore: checkpoint 2026-10-14 (xlsx freeze, sticky
   header, resolution notes 0012, gridcrest one-offs)`. One-off scripts go under
   `scripts/oneoff/` and are documented in `docs/BUG_LOG.md`.
2. Deploy it fully (backup → build → up -d → restart nginx → smoke) and tag `v2026.10.0`.
   From then on **prod = a tag**, never a dirty tree.

**b. `deploy/release.sh`** (new, ~60 lines): refuses on dirty tree; `scripts/backup-db.sh`
with `CONTAINER=ticketprod-db DB_NAME=ticketing_system BACKUP_DIR=…/backups`; `docker compose
-f docker-compose.prod.yml build` + tag images `ticketprod-{backend,frontend}:<git-sha>`;
`up -d`; `docker restart ticketprod-nginx`; smoke (`/t/onemed/login` 200, `/api/v1/healthz`
ok, `/api/v1/itsm/schema/` 200); `git tag vYYYY.MM.N`; append to `deploy/RELEASES.md`.
`deploy/rollback.sh <sha>` re-points `latest` at the previous image and runs `up -d`
(schema rollback is manual, by design).

**c. CI** — `.github/workflows/ci.yml`, three jobs:
- `backend`: `services: postgres:16-alpine`; `pip install -r requirements.txt`; env
  `SECRET_KEY`, `DB_*`, `MEDIA_ROOT=/tmp/media`; `python manage.py makemigrations --check
  --dry-run`; `python manage.py test apps -v1 --parallel`. Delete `settings_test.py`.
- `frontend`: `npm ci`; `npx tsc --noEmit`; `npm run lint`; `npm run build` with
  `NEXT_PUBLIC_API_BASE=/api/v1`.
- `e2e` (manual `workflow_dispatch` + nightly): `docker compose -f docker-compose.ci.yml up`
  (db+backend+frontend), `create_org e2e …` + `seed_itsm`, `npx playwright test`.
Enable branch protection on `main`: PR + green CI required.

**d. Playwright repair** — `package.json`: add `@playwright/test`, `@axe-core/playwright`
to devDependencies and `"test:e2e": "playwright test"`. `playwright.config.ts`: `baseURL`
from `PW_BASE_URL` with default `http://localhost:3000`, add `webServer` for local.
Specs: `/t/e2e/login`, URL regexes `/\/t\/e2e\/agent/`, API `/api/v1/t/e2e/itsm/auth/login/`,
storage keys `itsm_access:e2e`; replace the catalog test with "requester opens KB". Add the
missing happy path: create ticket → transition → public comment → internal note (covers
item 4 regressions too). Keep `a11y.spec.ts`, fix its routes the same way.

**Verification**: CI green on a no-op PR; `release.sh` dry run on a scratch tag; e2e passes
locally against compose.

---

## 4. Bulk actions UI, @mentions, live detail + stale-write guard

### 4a. Bulk actions (M)
**Backend** (`itsm_tickets/views.py:_bulk`) already supports `assign | priority | watch |
unwatch | delete` over `ids` or `saved_filter_id`, helpdesk/project-clamped, permission
`itsm.tickets.bulk`. Add:
- `op: "transition"`, `value: {transition_id, comment?}` → per ticket, call the workflow
  engine; collect `skipped: [{id, reason}]` for tickets where the transition is unavailable
  or a validator fails (don't abort the batch, matching the existing assign behaviour).
- Return `{count, skipped}` for every op; cap `ids` at 200.
- Audit: each op already goes through `ticket_service` except `priority`
  (`Ticket.objects.filter(pk).update(...)` bypasses `log_event`) → route it through
  `ticket_service.update_ticket(ticket, user=user, priority=value)`.

**Frontend** (`components/tickets/ticket-queue.tsx`, 915 lines)
- Checkbox column (header = select page), `selectedIds` state keyed on the current page;
  clear on filter/page change.
- `BulkActionBar` (new `components/tickets/bulk-action-bar.tsx`): sticky bottom bar with
  "N selected · Assign · Priority · Transition · Watch · Delete". Reuse
  `group-member-picker.tsx` for assign; transition list = intersection of
  `available-transitions` for the selected tickets (fetch per ticket, cap 50, show common ones).
- `ticketsApi.bulk(payload)` in `lib/itsm/types.ts`/api module; on success toast
  "Updated 12, skipped 2 (view)" and silent refetch via the existing `pulse` poll.
- Gate the checkbox column on `hasPerm("itsm.tickets.bulk")`.

### 4b. @mentions (M)
- Install `@tiptap/extension-mention` + `@tiptap/suggestion` (pin to the installed 2.27.x).
- `components/ui/rich-text-editor.tsx`: add `Mention` with a suggestion popover; items from
  `GET members/?search=<q>&helpdesk=<id>` (`MemberViewSet` only filters `is_active` today; add `helpdesk` using
  `helpdesk_member_ids`, mirroring the server-side allow-list in `views.py:768-773`).
  Render as `<span data-type="mention" data-id="<uuid>">@Full Name</span>`.
- On submit, collect `data-id`s from the editor doc → `mention_user_ids` (the comments POST
  already accepts and filters it; `add_comment` creates `MentionRecord` and emits `Mentioned`).
- `itsm_core/services/html.py`: allow `span: ["data-type", "data-id", "class"]`.
- Seed check: ensure the default `NotificationScheme` has a `Mentioned` rule → recipient
  `mentioned`, channels in_app + email (`itsm_notifications/services/recipients.py:49`
  already resolves it). Add a data migration if any live scheme lacks it.
- Agent-side: style `[data-type=mention]` as a chip; clicking opens the user's filter in the
  queue (`?q=assignee:<id>`).

### 4c. Live ticket detail + stale-write guard (S–M)
- Backend: `GET tickets/{id}/pulse/` → `{version: "<updated_at ts>:<latest comment id>:<latest audit id>"}` (cheap, three indexed lookups).
- Frontend `ticket-detail.tsx`: `useLivePoll({ pulse, key: ticketId, intervalMs: 15000,
  onChange })`. `onChange`: if nothing is being edited (`editingSummary`, inline field drafts,
  composer non-empty) → silent `reload()`; else show a slim banner "Ticket changed by
  <name> · Refresh" and don't clobber drafts. Side effect: re-signs expiring media URLs (item 1).
- Stale-write guard: client sends header `X-Ticket-Version: <ticket.updated_at>` on PATCH,
  `set-fields`, `assign`, `transition`. Backend helper `require_fresh(ticket, request)` in
  `TicketViewSet` → if header present and differs → `409 {"detail": "Ticket changed since you
  loaded it.", "current": TicketDetailSerializer}`. Client on 409 (`ItsmApiError.status===409`):
  apply `current`, keep the user's draft in the field, toast "Reloaded — please re-apply".
- Verified: `ticket_service.add_comment` never saves the Ticket row, so a concurrent comment
  does not bump `updated_at` and will not 409 a field edit. Only field edits, assign and
  transition change the version, which is exactly what the guard should protect.

**Tests**: bulk transition skips unavailable + reports; priority bulk now audited;
mention outside helpdesk dropped; 409 on stale version, 200 when header matches or absent;
e2e: select 2 rows → assign → both show the assignee.

---

## 5. Observability, scheduler resilience, ops cron

### Problem (verified)
- No `LOGGING` config; gunicorn access log only. No error tracking.
- `ticketprod-scheduler` has **no healthcheck** in `docker-compose.prod.yml`; a hung
  APScheduler thread means SLA breaches, outbox flushes and email polls silently stop.
- `healthz` returns `{"status":"ok"}` without touching the DB.
- Backup + cert-renewal cron were never installed (`crontab -l` empty; see
  `ohd-prod-deployment` notes). `backup-db.sh` defaults still point at the old
  `ticket-db`/`/home/santhosh/ticketingsystem/backups`.

### Changes
**a. Logging** — `LOGGING` dict: JSON formatter (`python-json-logger`) → stdout; loggers
`itsm`, `django.request` (WARNING), `apscheduler` (WARNING), `axes`. Request-ID middleware
reading nginx `$request_id` (add `proxy_set_header X-Request-ID $request_id;`) and attaching
it + `tenant=connection.schema_name` to every log record via a logging filter.

**b. Error tracking** — `sentry-sdk[django]` (or self-hosted GlitchTip if data residency
matters): `SENTRY_DSN` env, `traces_sample_rate=0.05`, `send_default_pii=False`,
`before_send` adds `tenant` tag; in `for_each_tenant` wrap with `sentry_sdk.push_scope()`
so job failures carry the org. `hooks._safe` already logs via `logger.exception` → captured.

**c. Scheduler heartbeat without new tables** — `django_apscheduler` already records every run
in `DjangoJobExecution` (public schema). Add:
- `apps/itsm_core/services/ops.py: job_health()` → per job id (`sla.breach_sweep`,
  `notifications.outbox_flush`, `email.poll`, …) the last execution time/status and
  `stale = age > 3 × interval`.
- `GET /api/v1/healthz?deep=1` → `{db: ok, scheduler: {...}, status: ok|degraded}` with HTTP
  503 on degraded (the shallow form stays for the container healthcheck).
- `manage.py check_scheduler` command → exit 1 if any job stale; wire as the
  `ticketprod-scheduler` `healthcheck` in compose (`interval: 60s`, `retries: 5`). Docker
  marks it unhealthy; add the tiny `willfarrell/autoheal` sidecar (or a host cron
  `docker restart` on unhealthy) so it self-recovers.
- Dead-man switch: `HEALTHCHECKS_URL_<JOB>` env → `requests.get(url)` after each successful
  sweep (healthchecks.io free tier). Zero infra, alerts on silence.
- `for_each_tenant`: log per-tenant duration; `scan_breaches` already idempotent.

**d. Ops cron (install, finally)** — `deploy/crontab.txt` documented and installed on the host:
```
15 2 * * *  CONTAINER=ticketprod-db DB_NAME=ticketing_system BACKUP_DIR=/home/santhosh/apps/project/ticketingsystem-prod/backups /…/scripts/backup-db.sh >> /var/log/ticketprod-backup.log 2>&1
30 3 * * 1  /…/deploy/renew-certs.sh >> /var/log/ticketprod-certs.log 2>&1
```
Fix `backup-db.sh` defaults to the prod names. Off-box copy of backups (rclone to a bucket)
is a one-liner addition once a bucket exists.

**e. Cache** — leave LocMem for now; Redis lands in Q1 and tightens throttles/lockouts
(item 2) and enables SSE (Q2). Note it in the compose file as a TODO so it is not forgotten.

**Verification**: kill the scheduler thread (`docker exec … kill -STOP 1` for 4 min) →
container goes unhealthy → autoheal restarts it → `healthz?deep=1` back to ok; trigger a
deliberate exception in a job → appears in Sentry with `tenant` tag; `crontab -l` shows both
jobs; a backup file appears next morning.

---

## Sequencing (calendar)

| Week | Work |
|------|------|
| 1 | Item 3a–3b (checkpoint, deploy, tag, release script); item 5d (cron) |
| 2 | Item 3c–3d (CI + Playwright repair); item 1 backend + tests |
| 3 | Item 1 nginx/frontend + rollout; item 2a–2d |
| 4 | Item 2e–2f + rollout; item 5a–5c |
| 5–6 | Item 4a bulk, 4c live/guard |
| 7 | Item 4b mentions; e2e additions; release `v2026.11.x` |

Each item ships as its own tagged release through `deploy/release.sh`, with a pre-deploy
backup, and is announced in a short release note (same format as
`release-notes/onedesk-release-notes-2026-07-17.html`).

## Risks and mitigations
- **Signed URL expiry (item 1)** breaks long-open tabs → mitigated by item 4c live poll and
  `<img onError>` refetch; TTL 1 h for UI, 7 d for emails.
- **Lockout false positives (item 2)** on shared office NAT → lock on `username+ip`, not ip
  alone; admins can unlock via `axes_reset` or a `MemberViewSet.unlock` action.
- **Shorter access token (item 2)** increases refresh traffic → excluded from the `user`
  throttle scope; single-flight refresh already in `client.ts`.
- **Bulk transition (item 4a)** on mixed workflows → only transitions common to all selected
  tickets are offered; others are reported as skipped.
- **Deploy ordering**: item 1 must ship backend and frontend together with the nginx restart;
  item 2's migrations run automatically in `entrypoint.sh` across all schemas.
