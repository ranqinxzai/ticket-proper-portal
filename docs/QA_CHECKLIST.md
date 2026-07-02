# QA Checklist — Ticketing System

Use this on every change. Adapted from the OneMed EHR QA bible. **The pilot is now
multi-tenant (schema-per-org, see the Multi-Tenancy section below + `docs/MULTI_TENANCY.md`).**

## Before Any Code Change

- [ ] Read the relevant `docs/SKILL_*.md` for the module you're touching
- [ ] Read `docs/BUG_LOG.md` to avoid repeating known bugs
- [ ] Identify which apps + frontend pages the change affects

## Multi-Tenancy (schema-per-org) — read `docs/MULTI_TENANCY.md`

Each organisation = one Postgres schema (via `django-tenants`). Routing is by URL
path `/t/<org>/…` (API: `/api/v1/t/<org>/…`). A thin layer does the work; the
existing models/views/queries are UNCHANGED and run inside the org's schema.

- [ ] **Isolation is automatic, not manual** — never add a `tenant_id` filter; data
  isolation comes from the active schema (`apps.tenants.middleware.PathTenantMiddleware`).
  New ITSM models just go in a TENANT app; they're created per-org by `migrate_schemas`.
- [ ] **SHARED vs TENANT** — only the org registry (`apps.tenants`), platform-admin
  users (public `accounts`), and the scheduler job store (`django_apscheduler`) live in
  `public`. Everything business-related is TENANT. If you add an app, classify it in
  `core/settings.py` `SHARED_APPS`/`TENANT_APPS`.
- [ ] **No new global background job that reads tenant tables** without wrapping it in
  `apps.tenants.runtime.for_each_tenant` (the scheduler runs in `public`).
- [ ] **JWT carries `tenant`** — `TenantAwareJWTAuthentication` rejects a token whose org
  ≠ the path's org (cross-org replay → 401). Don't bypass it.
- [ ] **`seed_itsm` runs per-org** (inside each schema) and stays idempotent.
- [ ] **New management command** that touches tenant data must be added to
  `SCHEDULER_BLOCKED_COMMANDS` and either run via `tenant_command --schema=<org>` or wrap
  its body in `schema_context`.
- [ ] **Tests**: in test mode all apps are flattened to one schema (`settings.py`
  `if "test" in sys.argv`), so existing `TestCase`s run unchanged. Real isolation is
  verified by the integration rehearsal (see `docs/MULTI_TENANCY.md`), not unit tests.
- [ ] **Org provisioning** — orgs are created from the platform console (`/console`) or
  `python manage.py create_org <slug> …`; both call `apps.tenants.services.provision_org`.
  Never use django-tenants' own `create_tenant`/`delete_tenant` (they skip the seed +
  first-admin step) — use `create_org`/`delete_org`.

## After Any Backend Change

- [ ] Soft delete used where applicable (no hard delete on user-visible content like comments)
- [ ] `permission_classes` set on every ViewSet (default `AllowAny` is for dev only — production routes must opt in to `HasAppAccess.for_app(...)`)
- [ ] Serializer split into List / Detail / Create where it makes sense
- [ ] No `print()` — use Django logging
- [ ] No `\n` inside f-strings (Python 3.12 SyntaxError)
- [ ] Number / order generation wrapped in `transaction.atomic` and `select_for_update` if concurrent
- [ ] API response shape matches what the frontend `lib/pm.ts` (or equivalent) expects
- [ ] If you added a write site, you also called `log_activity(...)` from `apps.project_management.activity` (PM module only)

## After Any Frontend Change

- [ ] `"use client"` on any page using state / hooks / event handlers
- [ ] `useParams<{ id: string; boardId: string }>()` for dynamic segments
- [ ] All API calls go through `lib/api.ts` (`api.get / post / patch / del / upload`) — never raw `fetch`
- [ ] Errors surfaced via `toast.error(...)` from sonner (now installed) — not `alert()` and not silent
- [ ] Loading states (`<Loader2 className="animate-spin" />` or skeleton blocks)
- [ ] No broken imports or unused variables
- [ ] TypeScript types match API response (`PmItem.comment_count`, `PmComment.body_html`, …)

### Live / silent-refresh polling (lists & dashboards)

- [ ] Use the shared `useLivePoll` hook (`lib/itsm/use-live-poll.ts`) — do **not** hand-roll another `setInterval` poller.
- [ ] The interval/background refetch path **never flips the loading spinner** (`loading` only on user-driven fetch — filter/sort/page/initial); a background refresh must be silent (no flicker).
- [ ] Poll a **cheap change-token** (`…/pulse/` → `{version, count}`), not a full list every tick; only refetch the real data when `version` changes.
- [ ] Polling **pauses when the tab is hidden** and catches up on refocus (the hook does this — don't defeat it with `refetchIntervalInBackground`-style always-on polling).
- [ ] **Don't clobber an in-progress action:** apply silently only when the user is idle at the top of the list; otherwise stage behind a "Refresh" pill (hybrid apply). A monotonic `fetchSeq`/seq guard drops a slow fetch superseded by a newer one.
- [ ] Re-seed the poll baseline when the scope (filters/page) changes — a filter change must not fire a spurious refresh.
- [ ] No SSE/WebSockets held inside Django — the app runs **gunicorn 3 sync workers**; a long-lived stream pins a worker each and starves the pool (use polling, or an external hub like Mercure).

## React Component Stability (CRITICAL — prevents focus loss)

- [ ] **Never** define a function component inside another component's body — every parent re-render creates a new component reference, React unmounts + remounts the subtree, and any focused `<Input>` / `<Textarea>` / Tiptap editor loses focus + IME state. Hoist to module scope, wrap with `React.memo`, or inline as a JSX-valued `const`.
- Symptoms: "cursor disappears after one character", "I have to re-click to type", "letters appear inverted / jumbled" (IME composition replayed on a fresh DOM node).

## Security Checks

- [ ] No XSS — any rich-text body rendered with `dangerouslySetInnerHTML` MUST come from a server endpoint that already sanitised it via `bleach` (PM comments do this).
- [ ] No SQL injection — only ORM access; no raw SQL with string interpolation.
- [ ] Auth required on every PM endpoint that mutates data (`HasAppAccess.for_app("pm")`).
- [ ] No `console.log()` of user data in production code.

## UI / UX Checks

- [ ] Buttons are clickable + show a busy state while the request is in flight
- [ ] Forms validate before submit and show errors inline
- [ ] Empty states render when a list is empty
- [ ] Modals / sheets close on Esc + click-outside
- [ ] Drawer keyboard focus is trapped (Radix Sheet handles this for free)
- [ ] Pagination visible when count > page size

## Module-Specific Checklists

### ITIL — Incident Impact Assessment, Priority Matrix & Resolution Details (added 2026-07-02)

Makes Incidents ITIL-standard. See `itsm-tickets` / `itsm-fields` / `itsm-projects` / `itsm-workflows`
SKILL updates. Scope = **Incident projects only** (`project_type == "incident"`).

- [ ] **Impact Assessment section shows on Incident only.** Open a `<KEY>INC` ticket → the layout has an
  **Impact Assessment** section (Impact, Urgency, Priority, Business Impact, Users Affected, Service
  Downtime, Major Incident). A `<KEY>REQ` (or non-incident custom) project has **no** Impact Assessment
  / Resolution Details section.
- [ ] **Agent-only + non-mandatory.** Every Impact-Assessment / Resolution field is hidden from the
  Service Portal (`portal_visible=False`) and non-mandatory. The end-user portal request form never shows
  or accepts them; on Incidents Priority is agent-only too (it stays portal-settable on Requests).
- [ ] **Priority auto-calc (overridable).** Setting Impact + Urgency auto-fills Priority live on the
  create form and on save (inline PATCH of impact/urgency recomputes server-side). A deliberate Priority
  edit is respected (not clobbered) until Impact/Urgency change again.
- [ ] **Priority Matrix editable.** Project settings → **Priority Matrix** tab (Incident only) → change a
  cell → new mapping drives the computed value. `validate_priority_matrix` rejects bad codes and fills
  holes from the ITIL default.
- [ ] **Resolution capture on Resolve.** Running **Resolve** opens the slide-over with Resolution Code /
  Root Cause / Workaround Provided / Resolution Notes (+ the resolution note). Submit → values persist on
  the ticket's Resolution Details section; a screen field marked mandatory (Workflow config) blocks
  resolve with **422** until filled. Reopen clears the resolution fields.
- [ ] **Existing tenants.** After `migrate_schemas --tenant` a second org's Incident projects show the new
  fields (data migrations `itsm_core/0006`, `itsm_workflows/0004` run per schema). `seed_itsm` stays
  idempotent (re-run adds nothing, preserves admin layout overrides).
- [ ] **Backend/Frontend gates.** Service-only writes (`ticket_service` / engine), `log_event` on the
  derived `priority_changed`; new resolve-sheet controls are module-top-level (focus stability);
  `makemigrations --check` clean, `tsc --noEmit` clean, backend tests green (`ITIL*` classes).

### Combined "All Tickets" cross-project queue (added 2026-07-01)

The workspace-level combined queue (`CombinedTicketQueue`, tab `…/w/<hd>/all`) lists every project the
agent can access in the helpdesk. See `itsm-tickets` / `itsm-fields` / `itsm-dashboards` SKILL updates.

- [ ] **Scope holds (no leak).** The list is `GET /tickets/?helpdesk=<key>` (no `?project`). As an agent
  in only some of a helpdesk's projects, the combined list shows tickets from **only** the assigned
  projects; a ticket created (as superuser) in a non-member project never appears. No cross-helpdesk
  ticket appears. (Scope is `accessible_helpdesk_ids` ∩ advisory `?helpdesk` ∩ `accessible_project_ids`
  — never add a manual filter.)
- [ ] **Custom columns are the union, blank where absent.** Add a custom-field column defined on only one
  project → rows from other projects show a blank cell, not an error. Dropdown/user columns show the
  **option label / user name** (not the stored value / id).
- [ ] **`?cf=` is batched (no N+1) + capped.** The list attaches `custom_values` only when `?cf=` is
  present; values come from ONE `FieldValue` query (`field_service.custom_column_values`); at most
  `CF_COLUMN_LIMIT` (12) columns are honoured.
- [ ] **Filters:** Status uses **Status category** (global) — specific per-project statuses are unioned;
  filtering by a custom field (`cf:<key>`) matches across projects. A same-key/different-type field is
  dropped from the union (not shown twice / ambiguously).
- [ ] **Project column + routing.** The Project column identifies each row's origin; clicking a row opens
  **that project's** detail (`…/p/<projectKey>/<number>?from=all`); the detail's **Back** returns to
  All Tickets (not a single project queue).
- [ ] **Prefs (v1 localStorage).** Column layout, selected custom columns, and default view persist under
  `itsm:allqueue:<helpdeskId>:*` and survive reload; "Save view" creates a **cross-project** `SavedFilter`
  (`project=null`).
- [ ] **Invariants intact.** Sticky toolbar/pager, live silent refresh, and whole-row click behave exactly
  as the single-project queue (the body is the shared `QueueView`); all cell renderers are
  module-top-level (focus stability).
- [ ] **`tsc --noEmit` clean**; `apps.itsm_tickets` suite green (incl. `CombinedQueueApiTests`);
  `makemigrations --check` clean (v1 adds no migration).

### Multi-tenancy — Cross-org session isolation (added 2026-06-28)

Verifies a user of one org can never see another org's data — at the DB, the token lifecycle,
and the browser. See `docs/MULTI_TENANCY.md` → "Security: the JWT tenant claim".

- [ ] **Leftover session can't leak across orgs (the original report).** In ONE browser: log
  into org A (`/t/<A>/login`), then open `/t/<B>/` (org B) in the same tab. You land on B's
  **login**, NOT B's data with A's identity. Check DevTools → Application → Local Storage:
  keys are namespaced `itsm_access:<A>` / `itsm_user:<A>` — there is no bare `itsm_access`.
- [ ] **Two orgs side by side.** Log into org A in tab 1 and org B in tab 2 (same browser);
  each tab stays on its own org, no bleed-through, and signing out of one (`tokenStore.clear`)
  leaves the other's session intact.
- [ ] **Access-token replay is 401.** A request to `/api/v1/t/<B>/itsm/...` carrying org A's
  `Bearer` token returns **401** ("issued for a different organisation"), not B's data.
- [ ] **Refresh-token replay is 401.** `POST /api/v1/t/<B>/itsm/auth/refresh/` with org A's
  refresh token returns **401** (via `TenantAwareTokenRefreshView`) — it does NOT mint a new
  access token. (`auth/refresh/` resolves to `apps.tenants.jwt.TenantAwareTokenRefreshView`.)
- [ ] **Prod auth is JWT-only.** With `DEBUG=False`, `api_settings.DEFAULT_AUTHENTICATION_CLASSES`
  is exactly `[TenantAwareJWTAuthentication]` (no Session/Basic). Under `DEBUG=True` the
  browsable API still works (Session+Basic present).
- [ ] **No circular import.** `python manage.py check` is clean — the tenant-aware refresh view
  stays in `apps/tenants/jwt.py` (NOT `auth.py`, which is loaded during DRF settings init).
- [ ] **`tsc --noEmit` clean** after the client.ts change; existing login/logout/refresh flows
  for a single org are unaffected (one re-login after deploy is expected — old bare keys).

### RBAC — Built-in Admin role (added 2026-06-28)

A fourth seeded system role **`admin`** ("Admin") with **full CRUD on every module** — the top-level
owner role (mirrors Supervisor's grants). Added to `seed_rbac()` + backfilled by data migration
`itsm_rbac/0002_seed_admin_role`.

- [ ] **Seed is re-runnable** — `seed_rbac()` returns `{"roles": 4}`; running it twice produces no
  duplicate roles/grants and leaves Admin with `is_system=True` + full CRUD on **every** module
  (`admin` grant count == `Module` count, all four bits true).
- [ ] **Admin == full access** — a non-superuser assigned the `admin` role passes `check_permission`
  for every module/action (read/create/update/delete), including the self-governing `itsm.admin.*`
  tree; the frontend treats it as `isSupervisor` (`SUPERVISOR_ROLES` in `lib/itsm/auth.tsx`).
- [ ] **Migration is idempotent + per-tenant** — `migrate_schemas --tenant itsm_rbac 0002_seed_admin_role`
  applies cleanly in **each** org schema (verify in `onemed`, `acme`, `gridcrest`, not just `public`);
  re-running (or re-deploying — the entrypoint re-runs `migrate_schemas` on boot) is a no-op. On a
  freshly-provisioned schema (modules seeded *after* migrate) the migration only creates the role and
  `seed_rbac` grants it later — no error from the empty `Module` table.
- [ ] **Stray custom `admin` normalised** — a tenant that already had a hand-made custom role with code
  `admin` ends up with `is_system=True` + the standard name/description + full CRUD (the migration
  `update_or_create`s the role; an already-applied schema is reconciled by the next `seed_rbac`).
- [ ] **Reverse is safe** — the migration's reverse drops the role + grants **only if no user is
  assigned** (the `RoleAssignment.role` FK is PROTECT); otherwise it leaves the role in place.
- [ ] `manage.py check` clean; `makemigrations --check` reports no changes for `itsm_rbac` (data-only,
  no model change).

### RBAC — Custom user attributes (added 2026-06-30)

Org-defined dynamic user attributes (Tenant Settings → **User Attributes**). Models in `itsm_rbac`
(`UserAttributeDefinition`/`Option`/`Value`, migration `0006`, TENANT app); gated by
`itsm.admin.roles`. Backend tests: `apps.itsm_rbac.tests_user_attrs` (11). See the itsm-rbac skill.

- [ ] **Define each type** — Settings → User Attributes: add a text / number / date / checkbox /
  dropdown / multi-select attribute; the name auto-slugs to `key`. Dropdown/multiselect rows expose an
  **Options** panel (add/remove choices). Toggling **Required** / **Show column** / **Active** PATCHes
  the definition. Delete is **soft** (`is_deleted=True`; row leaves the list, stored values gone from the API).
- [ ] **Create-user form** — the Add-user dialog renders a control per active attribute (checkbox =
  yes/no, dropdown = single select, multi-select = checkbox list, date = date picker). A **Required**
  attribute blocks submit client-side AND server-side (`create_user` → 400 `{attributes:{key:[…]}}`,
  no orphan user). A required **dropdown with no options** does NOT block (can't be satisfied).
- [ ] **Values persist + round-trip** — created user's `attributes` map comes back on the roster;
  `multiselect` returns a list, `number` a float, `date` an ISO string, `checkbox` a bool.
- [ ] **Edit existing user** — the row **Attributes** action opens a dialog seeded from the user's
  values; Save calls `members/{id}/set_attributes/` (full map; omitted key unchanged, `""`/`[]`
  clears). Clearing a **required** attribute is rejected (400).
- [ ] **Columns** — attributes with `show_in_table` show as roster columns by default; the **Columns**
  popover toggles any attribute on/off, persisted per-org in `localStorage["itsm_user_attr_cols:<org>"]`
  (an agent's choice doesn't change the admin default or other users).
- [ ] **Filters** — the filter bar filters the roster server-side (`?attr_<key>=value`, AND-ed across
  attributes): dropdown/multiselect = exact/membership, text = case-insensitive contains, number =
  equals, date = same-day, checkbox = yes/no. `members/filter_fields/` lists only **active** attributes
  (+ their options).
- [ ] **No N+1** — the roster prefetches `itsm_attribute_values` + their definition; one list request
  doesn't fan out per user.
- [ ] **Gating** — a user without `itsm.admin.roles` create/update can read but not mutate (editor is
  read-only); a forged POST/PATCH to `user-attributes` / `set_attributes` → 403.
- [ ] **Multi-tenant** — `migrate_schemas --tenant` applies `0006` to **every** org schema (onemed,
  acme, gridcrest), not just `public`; attributes defined in one org are absent in another.
- [ ] `manage.py check` clean; `makemigrations --check` clean (`0006`); `tsc --noEmit` clean; `next build`
  compiles `/agent/admin/user-attributes`.

### Email Channel (inbound→ticket, outbound threading) — added 2026-06-25

- [ ] **The scheduler actually runs.** Any change to inbound polling / SLA sweep / notification outbox is
  inert unless a process sets `RUN_SCHEDULER=1`. In the pilot that is the dedicated `ticketpilot-scheduler`
  compose service (`manage.py run_scheduler`); the gunicorn web workers must keep `RUN_SCHEDULER` OFF
  (3 workers ⇒ 3 schedulers). After deploy, verify `public.django_apscheduler_djangojob` has rows
  (`docker exec ticketpilot-db psql -U postgres -d ticketing_pilot -tAc "select id from public.django_apscheduler_djangojob;"`).
- [ ] **Per-tenant fan-out.** Channels live per-org schema. Any job/command reading `EmailChannel` must wrap
  in `apps.tenants.runtime.for_each_tenant` (the scheduler) or `schema_context` / `--schema` (the
  `poll_email_once` command). A bare query in `public` finds zero channels.
- [ ] **Inbound threading order (subject-first, 2026-06-28).** `resolve_thread` scans the **subject
  ticket number first** — bracketed `[KEY-N]` OR **bare `KEY-N`** (`_token_re` = `\b(KEY-\d+)\b`;
  users type the bare number) — thread there + skip headers on a match, then the **header map**, then
  the **plus-address token**. A subject miss must FALL THROUGH (never short-circuit to `new`) so agent
  replies / subject-edited replies still thread via the header map.
- [ ] **Inbound trust.** The **subject** path is intentionally UNGATED (product decision 2026-06-28 — a
  valid `[KEY-N]` threads on any match; see itsm-email BUG_LOG for the accepted tradeoff). The
  **plus-address** token is still gated — `threading._sender_owns_ticket` (requestor or watcher) must
  pass before it threads. The header map (recorded Message-ID) is exempt.
- [ ] **Credential key before secrets.** `ITSM_CREDENTIAL_KEY` (44-char Fernet) must be set and BACKED UP
  before any mailbox password / OAuth token is stored. If blank it derives from `SECRET_KEY`, so rotating
  `SECRET_KEY` later silently bricks every stored credential (`crypto.decrypt` returns `""` on InvalidToken).
- [ ] **Connect flow (basic IMAP/SMTP).** In the tenant Settings → Email UI: New mailbox → Connection tab
  (IMAP host/port/SSL/user/pass) → "Test connection" green; Outbound tab (SMTP host/port/security) →
  "Test SMTP" green; "Poll now" creates a ticket from a test email's subject. Reply with `[KEY-N]` in the
  subject from the requestor → threads as a public comment.
- [ ] **OAuth (Google/MS365) — per-org apps.** Each org registers its OWN provider app; client id/secret/
  tenant are entered in the UI and stored on the `EmailChannel` (secret encrypted, write-only). The
  redirect URI is org-specific: `{PUBLIC_BASE_URL}/api/v1/t/<org>/itsm/email/oauth/callback/` — it MUST be
  registered verbatim in that org's app, and `PUBLIC_BASE_URL`/`FRONTEND_BASE_URL` must be the real HTTPS
  host. Connect flow: enter creds → Save → Connect → consent → lands back with `?email_oauth=success` and
  the "Connected" badge. If you change the callback path or base URL, every org must re-register the URI.

### Email Notification — helpdesk-level From address (added 2026-06-28)

A per-helpdesk **From name + From email** for outbound notifications, set at **Settings → Project
Configuration → Email Notification** (`notification_from_name`/`notification_from_email` on `Helpdesk`,
migration `0003`, module `itsm.admin.helpdesks`). Resolved at send time in `outbox.flush`.

- [ ] **Precedence** — From = mailbox `channel.from_header` (when the project has an outbound
  `EmailChannel`) → helpdesk `notification_from_header` → global `DEFAULT_FROM_EMAIL`. A configured
  mailbox **always wins** (the helpdesk value only replaces the global default when there's no mailbox).
  (Covered by `apps.itsm_email.tests.HelpdeskNotificationFromTests`.)
- [ ] **Property** — `Helpdesk.notification_from_header` formats `"Name <addr>"` (name falls back to the
  helpdesk name); returns `""` when the address is blank, so a name-only value is a no-op (global default).
- [ ] **Reply-To unchanged** — overriding the From does NOT change Reply-To/threading
  (`threading.build_outbound_headers` still sets Reply-To = the mailbox address).
- [ ] **API** — `PATCH /helpdesks/{id}/` accepts both fields (`HelpdeskWriteSerializer`); `GET` returns
  them (`HelpdeskSerializer`); an invalid email → 400. The slim `auth/me` helpdesk payload is unchanged
  (the settings form fetches the full record via `helpdesksApi.get`).
- [ ] **UI gating** — a non-supervisor (`!itsm.admin.helpdesks:update`) sees the `ReadOnlyBanner` +
  disabled inputs; a forged PATCH still 403s server-side. `tsc --noEmit` clean; `next build` compiles
  the new `settings/email-notification` route.
- [ ] `makemigrations --check` clean (`0003_helpdesk_notification_from`); `manage.py check` clean.

### Project Management — Comments + Activity Log on Items (added 2026-05-10)

- [ ] **Server sanitises rich text** — POST a comment whose body contains `<script>alert(1)</script>` and confirm it is stripped from `body_html` before save. Repeat with `<img src=x onerror=alert(1)>` — `onerror` attribute is removed.
- [ ] **`comment_count` matches reality** — `Item` serializer's `comment_count` equals `ItemComment.objects.filter(item=..., is_deleted=False).count()` for that item.
- [ ] **Icon flips without reload** — after posting the first comment from the drawer, the comment-bubble icon on the row immediately switches from outline to filled-violet with `1` (no full board reload).
- [ ] **No-op cell edits don't pollute the feed** — PATCH `/items/{id}/cells/{column_id}/` with the same value the cell already holds → confirm no new `ItemActivity` row.
- [ ] **Cell-change diff is captured** — change a `status` cell from `todo` → `done`. The `ItemActivity` row carries `action=cell_changed`, `payload.old.value="todo"`, `payload.new.value="done"`, `payload.column_name="Status"`.
- [ ] **Attachment add/remove logged** — uploading or deleting any attachment (cell-attachment OR comment-attachment) writes one `ItemActivity` row.
- [ ] **Soft-deleted comment** — DELETE `/api/v1/pm/comments/<id>/` flips `is_deleted=True` (does NOT row-delete) and writes a `comment_deleted` activity. Body is blanked so soft-deleted comments don't leak via `?is_deleted=true` queries.
- [ ] **Deleted user fallback** — when an `actor` or `author` is hard-deleted from `accounts.User`, `actor_name` / `author_name` resolves to "(deleted user)" — no NPE in the activity feed.
- [ ] **Drawer geometry** — Sheet width is `40vw` clamped to `[480px, 720px]`. Closes on Esc and on click-outside.
- [ ] **Tiptap toolbar** — bold / italic / strike / bullet-list / ordered-list / link / heading buttons toggle on selection. Markdown shortcuts (`**bold**`, `# heading`) work via StarterKit.
- [ ] **Paste image** — pasting an image into the composer attaches it as a `CommentAttachment`, NOT inlined as base64 in `body_html`.
- [ ] **Files tab union** — calls `GET /api/v1/pm/items/<id>/files/`, response includes both `source="cell"` and `source="comment"` rows, each with a `source_label` (column name or "Comment by …"). Sorted newest-first.
- [ ] **Activity entry rendering** — `cell_changed` rows show old → new chips that match the column's status / priority colours. Other entries fall back to plain text via the server-rendered `summary` field.
- [ ] **Edit-own gating** — edit + delete buttons on a comment only render when `comment.author === currentUser.id`. Non-author payload edits return 403 from the backend.
- [ ] **Bleach allowlist** — `<script>`, `<iframe>`, `onload`/`onerror` attributes, `javascript:` URLs are all stripped. Allowed: `p, br, strong, em, u, s, code, pre, ul, ol, li, h1..h4, blockquote, a (href, rel, target), img (src, alt)`.
- [ ] **Permission gating** — a user without `pm` in their `app_access` gets `403` on every `/api/v1/pm/...` endpoint.
- [ ] **No regression** — existing `CellAttachment` upload (PATCH `/api/v1/pm/attachments/`), virtualised scroll on `BoardView`, primary-text-cell → `Item.name` mirroring all still work.

### Project Management — Column Filters (added 2026-05-10)

- [ ] **Filter icon visible** on every filterable column header. Outline on hover for inactive, persistent violet (with fill-violet-200 fill) when a filter is set. `file` columns have NO filter icon (no operator makes sense).
- [ ] **Multi-select for status / dropdown / priority** — picking two `Status` options (e.g. `To Do` + `Working on it`) shows items whose status is either. Empty selection clears the filter.
- [ ] **Person filter** — populates from `GET /api/v1/users/?page_size=200`. Search box narrows the list by `full_name` or `username`. Multi-select.
- [ ] **Date filter is inclusive on `to`** — selecting `to=2026-05-10` includes items dated `2026-05-10 23:59`, not just `2026-05-10 00:00`.
- [ ] **Text / long_text "contains" is case-insensitive** — filtering `contains="urgent"` matches "Urgent fix" and "URGENT call".
- [ ] **Number range** — `min` only, `max` only, and both bounds all work; non-numeric cells are excluded.
- [ ] **Checkbox filter** is exact: `Checked` only matches `value_bool=True`, `Unchecked` only matches `value_bool=False`. NULL cells (never set) are excluded from both.
- [ ] **Filter chips render above the header bar** with the column name + a human-readable summary (e.g. `Status: To Do, Working on it`, `Priority: High +2` for >2 values). `x` button on the chip clears just that filter; "Clear all" clears every filter.
- [ ] **Group counts reflect filtered set** — group header shows "Dr · 3 items" when 3 of the original 5 are visible.
- [ ] **Empty groups hidden while filtering** — a group with zero matching items disappears from the table (returns when filters are cleared).
- [ ] **Inline `+ Add item` row hidden while filtering** — preventing the confusion of typing into a row that would immediately vanish when the filter excludes the new item.
- [ ] **Filters are pure-client and don't persist** — refreshing the page resets to no filter; URL doesn't change. (Acceptable v1; URL persistence is a future iteration.)
- [ ] **Combined filters AND together** — applying `Status=Done` + `Priority=High` shows only items that match BOTH (intersection, not union).
- [ ] **Filter setting one column doesn't drop another's filter** — adding a Status filter while a Priority filter is already active leaves both intact.
- [ ] **Comments + Activity icon column is unaffected** — the comment-bubble column has no filter icon and is never hidden by filtering. Filtering by Status doesn't change which item shows the bubble.

### Project Management — Group Summary Row (added 2026-05-10)

- [ ] **Summary row appears at the foot of every non-collapsed, non-empty group**, between the last item and the inline `+ Add item` row.
- [ ] **Empty groups don't render a summary row** — a group with zero matching items shows just the (hidden via filter) header or no row at all.
- [ ] **Filter ⇒ summary shrinks** — apply a Status=`Done` filter; summary distribution recomputes from the filtered subset, not the full group.
- [ ] **Status / Priority / Dropdown** — colour bar widths are proportional to count. Two equal-count options render as 50/50 segments. Options with zero count don't render a segment.
- [ ] **Status "% complete" caption** — when any option's `id` or `label` matches `/done|complete|closed|finish/i`, the tooltip header shows "<X>% complete" in emerald. Default seed values (`Done`) trigger this.
- [ ] **Blank cells get a grey segment** when at least one item in the group has no value for that status/dropdown/priority column.
- [ ] **Checkbox column** — green progress bar from 0–100%, percentage text right-aligned next to the bar.
- [ ] **Number column** — `Σ <sum> · x̄ <avg>` inline; tooltip adds Sum / Average / Min / Max plus filled-vs-total. Decimals respect `column.settings.decimals`; `prefix` / `suffix` (e.g. `$`, `kg`) are applied.
- [ ] **Person column** — shows `<N> people` + tiny coloured dots (max 4 visible, rest as `+N`) + "<M> blank" when any item has no assignee.
- [ ] **Date column** — shows earliest – latest range. If every value falls on the same day, only that date renders. Rose "<N> overdue" badge appears when at least one date is in the past.
- [ ] **Text / Long text** — "X / Y filled" count (long_text always; text only when NOT the primary cell, since primary mirrors `Item.name`).
- [ ] **File column** — "<N> files" total. Tooltip shows total files + items-with-files.
- [ ] **Hover tooltip works on every summary cell** — including blank `Empty` cells (which render `—`). Tooltips are positioned `top` and don't escape the viewport.
- [ ] **Collapsed groups** don't render a summary row (the body is hidden, summary is too).
- [ ] **`+ Add item` row still appears below the summary** when no filter is active. With a filter active, both the summary AND the add-item row hide consistently (summary stays; add-item hides — already in `flatRows` logic).
- [ ] **Primary text column shows blank** — no `0 / N filled` noise on the Item-name column.
- [ ] **Performance** — adding 200 items to a group renders the summary in <16ms (no jank). All summary computations are O(N · cols) per render and only run for `visibleItems`.

### Project Management — Freeze + Resize + Overflow Tooltips (added 2026-05-10)

#### Excel-style freeze (horizontal scroll)

- [ ] **Action menu (…), comment column, and primary `Item` column stay visible** while the rest of the columns scroll horizontally. Verifiable on a board with ≥ 5 dynamic columns: scrolling the table to the right does not move the leftmost three cells.
- [ ] **Frozen primary column matches the column header's name** — even after scrolling, the primary column header reads "Item" (or whatever the primary is named) and the cell content lines up underneath.
- [ ] **2-px box-shadow on the primary column's right edge** appears once the user has scrolled right (CSS box-shadow is always rendered; in practice it's only visible against the scrolling content).
- [ ] **Body row hover (`bg-muted/20`) still works on the frozen cells** — `group-hover:bg-muted/20` on action / comment / primary cells stays in sync with the hovered row.
- [ ] **Group header content stays visible** during horizontal scroll (chevron + group name + count + kebab menu wrapped in a `sticky left:0` inner div).
- [ ] **Summary row's `Σ`, comment slot, and primary slot freeze** along with the rest of the row.
- [ ] **`+ Add item` row's input is anchored** in the primary column's slot when scrolled right (no more flex-1 stretched input that disappears off-screen).
- [ ] **No stacking-context bugs** — the sticky header still overlays sticky body cells (top-left intersection looks correct). The filter popover, kebab dropdown, and resize handle all open ABOVE the sticky cells.
- [ ] **Existing virtualised scroll** (200 items per page) still performs without jank when scrolling horizontally then vertically.

#### Column resize

- [ ] **Every column header has a draggable 6-px handle** on its right edge. Cursor turns to `col-resize` on hover; handle highlights violet on hover and deeper violet while dragging.
- [ ] **Live resize during drag** — table re-renders cell widths in real time (no jump on pointerup).
- [ ] **Min width 80px** — dragging far left clamps to 80px; cell never collapses to zero.
- [ ] **Persist on pointerup** — `PATCH /api/v1/pm/columns/<id>/` is called with `{ width }`. Refreshing the page preserves the new width.
- [ ] **Primary column is resizable** — drag works on the (frozen) primary header. Width updates the sticky cell + all body rows in lockstep.
- [ ] **Resize doesn't trigger filter popover or kebab menu** (handle stops propagation on pointerdown / click).
- [ ] **Resize while filter is active** — works without breaking the filter chip bar or the active filter icon.
- [ ] **Resize doesn't break the virtualizer** — vertical scroll is still smooth after a column resize.
- [ ] **Backend tolerates the PATCH** — `pm.updateColumn` sends `{ width: <number> }` and the server accepts it (`ColumnSerializer.fields` includes `width`, no readonly).

#### Overflow tooltips

- [ ] **Hover any truncated cell** in the visible viewport shows a native browser tooltip with the full value. Cells covered: text, long_text, number, status (label), dropdown (label), priority (label), date (formatted), person (full_name or username). Checkbox + file cells have nothing to tooltip (no overflow).
- [ ] **Empty cells don't show a `—` tooltip** — the title attribute is omitted when the value is empty (browser shows no tooltip on hover, not "—").
- [ ] **Status / Priority pill tooltips work** — even though the pill is a colored background button, the title attribute on the button surfaces the option label on hover.
- [ ] **Tooltip respects edits** — after editing a text cell to a long value, hovering the cell shows the updated value.

### Project Management — General

- [ ] Every new ViewSet has `permission_classes = PM_PERMS`
- [ ] `Column.is_primary=True` rows cannot be deleted (HTTP 400)
- [ ] `apply_cell_value` + `serialize_cell` from `serializers.py` are the only place cell values are read/written — do not duplicate the type-dispatch logic
- [ ] When you change `Item.name` you also update the primary text cell value (already wired in `views.py:223-247`)

### One Helpdesk — Helpdesk scoping (added 2026-06-20)

The "One Helpdesk" (formerly ITSM) product now hosts multiple departments (IT, HR, …) on one platform, each a **Helpdesk**. A user only sees tickets in helpdesks they're an active member of. Row-level scoping lives in the **shared services** (`apps.itsm_helpdesks.services.accessible_helpdesk_ids`), not only in `TicketViewSet.get_queryset` — every entry below leaks today without its guard, so test each surface independently. The sentinel `None` from `accessible_helpdesk_ids` means **unrestricted** (superuser); a member of no active helpdesk gets `[]` (sees nothing).

**The 8 guard points** (each maps to one shared-service touchpoint):

- [ ] **Guard 1 — saved-filter / widget / bulk-by-filter results** — `query_builder.build_q` / `filtered_tickets` AND `project__helpdesk_id__in`. Run a saved filter whose `query_spec` would match tickets in another helpdesk → those rows are absent. (Covered by `test_saved_filter_results_are_clamped`.)
- [ ] **Guard 2 — bulk by explicit ids** — `POST` a bulk op (`TicketViewSet._bulk`) with a list of ticket ids that includes one from a helpdesk you're not a member of → the foreign id is silently clamped out (`project__helpdesk_id__in`), never mutated. (Covered by `test_bulk_by_ids_cannot_touch_other_helpdesk`.)
- [ ] **Guard 3 — list + detail + derived actions** — list endpoint omits other helpdesks' tickets; `GET /tickets/<foreign-id>/` and every id-derived action (transition / assign / comments) return **404** (not 403 — the row is simply not in `get_queryset`). (Covered by `test_list_excludes_other_helpdesk`, `test_detail_cross_helpdesk_is_404`.)
- [ ] **Guard 4 — create / links / apply_template reject inaccessible targets** — `POST /tickets/` into a project in a helpdesk you can't access → **403**. Same for adding a link to a foreign ticket and applying a foreign template. (Covered by `test_create_in_other_helpdesk_is_403`.)
- [ ] **Guard 5 — reports** — `itsm_reporting` `reports._base` / `sla_compliance` take `helpdesk_ids`; `ReportViewSet.retrieve` validates `?project=` belongs to an accessible helpdesk and keeps the clamp on the `TypeError` retry path. A report with no `?project` is scoped to the caller's accessible set by default. (Covered by `test_reports_reject_foreign_project`, `test_reports_default_base_is_scoped`.)
- [ ] **Guard 6 — dashboards** — `SavedFilter.results`, `WidgetViewSet.data`, and `widget_data.resolve` all thread `accessible_helpdesk_ids` → no widget shows counts/rows from a non-member helpdesk.
- [ ] **Guard 7 — SLA trackers** — `SLATrackerViewSet.get_queryset` filters `ticket__project__helpdesk_id__in` → the SLA list/at-risk surface never exposes a foreign ticket's clock.
- [ ] **Guard 8 — comment @mentions** — `POST` a comment whose `@mention` ids include a user who is NOT a member of that ticket's helpdesk → those ids are dropped (mention set is restricted to the ticket's helpdesk members), so no cross-helpdesk notification leaks.

**Transport / clamp & identity:**

- [ ] **Forged `?helpdesk=` can't widen scope** — `?helpdesk=<id|key>` is advisory only; `resolve_helpdesk_scope` intersects it with the server-computed accessible set. Passing a helpdesk id/key you're not a member of returns YOUR scope (or empty), never that helpdesk's tickets, and never a 403. (Covered by `test_helpdesk_param_cannot_widen_scope`.)
- [ ] **Superuser sees all** — a superuser (sentinel `None`) sees tickets across every active helpdesk; `auth/me`.helpdesks lists all active helpdesks. (Covered by `test_superuser_sees_all_helpdesks`, `test_me_lists_only_member_helpdesks`.)
- [ ] **Agent with no membership sees nothing** — a role-assigned agent enrolled in zero active helpdesks gets an empty queue everywhere (list, reports, dashboards, SLA), no errors. (Covered by `test_agent_without_membership_sees_nothing`.)
- [ ] **Per-helpdesk ticket-number prefix** — a ticket created in the IT Incident project is numbered `ITINC-1` (helpdesk `key` + project, not global `INC-1`); HR Request → `HRREQ-1`. Numbering stays unique per project. (Covered by `test_ticket_number_uses_helpdesk_prefix`.)
- [ ] **`auth/me` + login token carry `helpdesks`** — `ItsmUserSerializer.helpdesks` returns `[{id,key,name,icon,color}]` for the caller's active memberships (all active helpdesks for a superuser); appears in both `auth/me` and the login token payload, so the frontend AppSwitcher only lists reachable helpdesks.

**Greenfield seed verification:**

- [ ] **`seed_itsm` is re-runnable** — running it twice produces no duplicate helpdesks, projects, groups, or memberships (idempotent). Default helpdesks **IT** + **HR** seeded; per-helpdesk projects `ITINC` / `ITREQ` / `HRINC` / `HRREQ` exist; one namespaced Service Desk group per helpdesk (e.g. `it-service-desk` / "IT Helpdesk Service Desk") plus the 4 shared global teams.
- [ ] **Old global INC/REQ are gone** — after migrating a previously-seeded DB, the legacy global `INC` / `REQ` projects no longer exist (dropped by `itsm_projects` migration `0002_drop_legacy_global_projects`); every project now has a non-null `helpdesk` FK. On a fresh DB, `0002` simply no-ops.
- [ ] **Workflows / SLA / notifications stay global** — they're looked up by project with an `is_default` fallback that still fires for per-helpdesk projects (no per-helpdesk schema this phase).

**Backend test status:** `apps.itsm_helpdesks.tests.HelpdeskScopingTests` adds **12** isolation tests covering the points above; with the existing suites the ITSM backend is **44 tests pass**.

#### Agent-app access gate — no helpdesk ⇒ no agent view (frontend, added 2026-06-28)

Membership now gates the **agent app shell itself**, not just the data. The gate is
`hasHelpdeskAccess(user)` (`lib/itsm/nav.ts`) enforced in `AgentGuard` (`lib/itsm/auth.tsx`):
superuser OR ≥1 active helpdesk membership. This is a **UI gate** — the backend already returns
empty/scoped data for a zero-helpdesk user (see "Agent with no membership sees nothing" above).

- [ ] **Roled, zero-helpdesk user is blocked** — create an Agent (or Lead/Admin) with **no** helpdesk, sign in → the **"No helpdesk assigned — contact your administrator"** screen renders (no menu, no app-switcher, no Home cards, no workspace); only **Sign out** works.
- [ ] **Assign a helpdesk → access restored** — add the user to a helpdesk (Helpdesks sheet), refresh / re-login → agent Home loads and shows **only** that helpdesk; switcher lists only it.
- [ ] **Remove the last helpdesk → blocked again** — strip the user's only membership → next `auth/me` refresh returns to the blocking screen.
- [ ] **Superuser & requestor regressions** — superuser → full agent app (all helpdesks); pure `requestor` → still redirected to the Service Portal (not the blocking screen).
- [ ] **Direct workspace URL is still blocked** — navigating a zero-helpdesk user straight to `/t/<org>/agent/w/<key>` hits the guard (and `WorkspaceProvider` independently resolves `helpdesk=null`).
- [ ] **Non-superuser admin needs a helpdesk** — a non-superuser `admin` with no helpdesk cannot reach `/agent/admin/*`; the superuser is the bootstrap who assigns helpdesks.
- [ ] **Create-dialog soft hint** — selecting a non-requestor role with no helpdesk ticked shows the amber "won't be able to open the agent app" hint, but **does not block** creation (assignment stays optional).

### Settings / Admin (added 2026-06-20)

The per-helpdesk **Settings** hub (`agent/w/[helpdeskKey]/settings`): left-rail nav + card-grid landing over **HelpDesk Configuration** (Helpdesk Config, Business Calendars, Assigned Groups) and **Project Configuration** (list + create custom; per-project Overview/Fields/Workflow/Layout/Approval). Every write is gated by its module both in the UI (`hasPerm`) and on the server.

**Helpdesk Config** (`settings/helpdesk`, module `itsm.admin.helpdesks`)
- [ ] Editing name/icon/colour/status saves via `PATCH /helpdesks/{id}/`; the consolidated header reflects it immediately (provider `refresh()` re-fetches `/auth/me`).
- [ ] **Prefix change is allowed** (not blocked) but shows a confirm dialog; after save the route `router.replace`s to the new `/agent/w/<NEWKEY>/settings/helpdesk` and **existing tickets keep their numbers** (`ITINC-1` unchanged — no renumber).
- [ ] Agent (read-only on `itsm.admin.helpdesks`) sees the view-only banner + disabled inputs; a forged `PATCH` still 403s server-side.

**Business Calendars** (`settings/calendar`, module `itsm.sla.calendars`)
- [ ] Calendar list + create (`POST /business-calendars/`); timezone is a static FE list (no `/timezones` API); "Make default" flips `is_default` and the list re-fetches.
- [ ] Business hours: toggling a weekday creates/deletes a `business-hours` row; **a second interval on the same weekday is accepted** (split shift, no unique-constraint 400); editing times PATCHes; `end_time <= start_time` → **400** surfaced as a toast.
- [ ] Holidays: add (date + name + `recurring_annually`) and delete; duplicate `(calendar, date)` → 400.
- [ ] Editing hours changes SLA due-date computation (`business_time.add_business_minutes`); a project pinned to this calendar (Overview tab) uses it for **new** tickets only (in-flight trackers keep their snapshot).
- [ ] Calendars are shared/global (banner says so); editing one affects every project pinned to it.

**Assigned Groups** (`settings/groups`, module `itsm.groups`)
- [ ] List shows this helpdesk's groups **plus** shared/global teams (flagged "Shared", not editable here); `?helpdesk=` excludes other helpdesks' groups.
- [ ] Create sets `helpdesk` to the current one + auto-slugged `key`; non-member create → **403**; creating a global (null-helpdesk) group as a non-superuser → 403. (Create form is core-only — the toast says to reopen the group to add team.)
- [ ] **Edit owns team management** (added 2026-06-23): the Edit sheet has a **Team** section with a **Leads** multi-select (chips) and an **Agents** list, both via the `/users/?search=` combobox → `add_member`/`remove_member`. **These write immediately** (not on Save); Save persists only name/key/type/description. No `lead` is sent on core Save (it would clobber the primary).
- [ ] **Multiple leads + primary** — adding a lead writes a `role_in_group="lead"` membership; `leads[0]` is the **primary** (badge) mirrored into `Group.lead` (the single FK the group-lead auto-assign strategy uses). "Set primary" reorders; removing/demoting the primary promotes the next lead (or clears `lead` to null when none remain). "Make lead" promotes an agent; adding a lead as an agent (or vice-versa) moves them between sections (no duplicate membership).
- [ ] **Members button only for Shared/read-only rows** — owned groups a supervisor can manage show **Edit/Delete** (team lives in Edit); shared/global teams and read-only viewers (`!canManage`) still get the standalone **Members** sheet. Delete soft-deletes the group (row disappears, 204).

**Project Configuration** (`settings/projects`, modules `itsm.projects` / `.config` / `itsm.fields(.layouts)` / `itsm.workflows` / `itsm.approvals.admin`)
- [ ] List shows active **and** inactive projects (from `allProjects`); "Create custom project" forces `project_type="custom"` (Incident/Request can't be duplicated — a 400 from the unique constraint is surfaced if attempted).
- [ ] **Overview** edits name/key(warn)/desc/status/icon/colour/default group/default workflow/**business calendar**/lead. (The ticket-categories editor was removed 2026-06-22 — see the dated section below.)
- [ ] **Fields** — create/delete `FieldDefinition`s; option types (dropdown/multiselect/radio) manage options; global fields are read-only here. **Layout** — add fields to the default layout, reorder (▲▼), toggle required/hidden, edit section.
- [ ] **Workflow** — needs a default workflow on the project; statuses + transitions CRUD; "Validate" calls `workflows/{id}/validate/` and renders `errors`/`warnings`.
- [ ] **Exclude a state from SLA (Hold)** — the add-status form has an **Exclude from SLA** checkbox and each status row has a ⚙ **Status settings** dialog toggling `Status.pauses_sla` (`PATCH /statuses/{id}/`); excluded rows show an amber **`SLA paused`** badge. A ticket entering an excluded status **pauses ALL running SLA clocks** (First Response + Resolution) and **resumes** them on leaving (due dates pushed out) — verify on `GET /tickets/{id}/sla/` (`state:"paused"`). The `StatusSettingsDialog` is module-top-level + keyed (focus-stability rule). No double-count when the status is also in a metric's `pause_statuses` or has a `pause_sla` post-function (state-guarded). Covered by `itsm_sla.tests.SlaPauseFlagTests` + `itsm_workflows.tests.StatusPausesSlaSerializerTests`.
- [ ] **Approval** — project-scoped `ApprovalWorkflow` CRUD (`?project=` filter) + stages (level/approver type/target/rule/min_approvals); wire it onto a state from the **Workflow** tab's per-transition Configure dialog (see the per-transition approval section below).
- [ ] Cross-helpdesk: a supervisor of IT cannot read/write HR's calendar hours, HR-only groups, or HR projects/fields/workflows via Settings (server re-clamps the advisory `?helpdesk=`).

**Migration / build**
- [ ] `makemigrations --check --dry-run` clean except the two intended FKs (`itsm_projects.0002_project_calendar`, `itsm_approvals.0002_approvalworkflow_project`); `manage.py check` passes; `seed_itsm` still re-runnable.
- [ ] Frontend `next build` compiles all six `settings/**` routes; `tsc --noEmit` clean.

### Workflows — Per-transition approval config (added 2026-06-28)

The per-transition **Configure** dialog (Project Settings → Workflow) wires an approval rule onto a state. See `itsm-workflows` skill.
- [ ] **Start approval** Select lists project-scoped `ApprovalWorkflow`s; choosing one **merges** a `request_approval` post-function (`config.workflow_id`) without dropping existing post-functions (e.g. `auto_assign` on "Start Fulfilment"); "— None —" removes it. Empty list shows the "create one in the Approval tab" hint.
- [ ] **Require approval** checkbox toggles the `approval_granted` `TransitionCondition` via the write-only `requires_approval` field; PATCH without the flag leaves conditions untouched (an unrelated note edit must not wipe the gate).
- [ ] **End-to-end**: Start approval on the entry transition + Require approval on the exit transition ⇒ the exit transition is hidden from `available_transitions` while an `ApprovalRequest` is pending, and reappears once granted. Badges **`starts approval`** / **`needs approval`** render on the rows.
- [ ] **No migration** (`makemigrations --check` clean); `requires_approval` is serializer-only. Re-running `seed_itsm` is expected to overwrite a manual `request_approval` on a **seeded** transition (documented caveat); the gate condition survives.
- [ ] Tests: `python manage.py test apps.itsm_workflows` (`RequiresApprovalToggleTests`, `ApprovalGateEngineTests`).

### One Helpdesk — Agent shell & header (frontend, added 2026-06-20)

The agent app uses ONE context-aware header per route state (`components/shell/agent-shell.tsx`). When touching the agent shell / home / workspace header:

- [ ] **One bar, never two.** On `/agent` (+ `/agent/approvals`, `/agent/reports`) only the minimal bar renders (BrandMark + profile). On `/agent/w/[key]/*` `AgentShell` renders NO bar; the single consolidated `WorkspaceHeader` (inside `WorkspaceProvider`) renders instead. Verify no stacked/duplicate header on workspace routes.
- [ ] **Branding = "One Helpdesk".** No "ServiceDesk" / "Service Desk" left in shell, login, metadata, or the home heading (which reads **"Select Helpdesk"**). `grep -ri "servicedesk" frontend/app frontend/components` is clean (except intentional references).
- [ ] **Logo is optional & safe.** `brand-mark.tsx` uses a plain `<img src="/logo.webp" onError>` that falls back to a LifeBuoy mark — the UI must render with `frontend/public/logo.webp` absent. (Drop the real asset there to show the company logo.)
- [ ] **Icons from the registry.** Helpdesk/project icons render via `<ItsmIcon name={…} />` (`lib/itsm/icon-map.tsx`), reading the seeded kebab lucide names; an unknown/blank name falls back, never crashes. New seeded names are added to the registry.
- [ ] **App-switcher** lists the caller's accessible helpdesks + a Home entry, marks the current one, and navigates by route param (no localStorage).
- [ ] **Create menu** lists the helpdesk's projects → each opens that project's `/new` form; disabled when the helpdesk has no projects.
- [ ] **Approvals badge** count comes from `approvalsApi.myPending()` (fail-silent, ~60s refresh) and the icon links to `/agent/approvals`. **Config** icon → the workspace settings route. **Profile** menu carries the theme switch + sign-out.
- [ ] **React component stability** — every header sub-component (`ItsmIcon`, `BrandMark`, `AppSwitcher`, `CreateMenu`, `ApprovalsBell`, `WorkspaceHeader`) is module-top-level, never defined inside another component's body.
- [ ] **No `*/` inside a JS/TS block comment** (e.g. a `apps/itsm_*/seed.py` glob) — it closes the comment early and breaks the file (`TS1160`). `npx tsc --noEmit` is clean.
- [ ] **Split login** — `app/(auth)/login` is two-pane: `LoginHero` (`components/auth/login-hero.tsx`) on the left at `lg`+, form on the right (`clamp(360px,38%,520px)`), full-width below `lg`. Hero renders with no asset (gradient) and layers an optional `public/login-hero.{webp,png,jpg}` if present. Form keeps `BrandMark`, the `Username`/`Password` labels, the **Sign in** button, and a `ThemeToggle` (the theme e2e selects its "Dark" radio on `/login`).
- [ ] **E2E** — `frontend/e2e/happy-path.spec.ts` asserts the **"Select Helpdesk"** heading and the IT → Incident queue flow.

### Fields/Layout — Standard catalog, layout-driven form, two-pane regions (added 2026-06-21)

The standard field set is seeded as system `FieldDefinition`s + a default `FieldLayout`; the agent
create form is layout-driven; the Layout designer assigns each field to a **Main**/**Sidebar** column
and a **Full**/**Half** width.

**Catalog + seeding**
- [ ] `seed_itsm` is re-runnable — 9 global `is_system` fields (summary/description/priority/mode/
  requestor/assigned_group/assignee/source/attachments) + one per-project `category` cascade; each
  project has a default `FieldLayout` with all 10 items; re-running creates no duplicates.
- [ ] **Fields tab lists project + global system fields** — `?project=` returns both (global ones via
  `get_queryset` OR `project IS NULL`, NOT an exact filterset match). Mode options editable;
  Priority/Source (`config.maps_to`) read-only; Category opens the cascade tree editor.
- [ ] **Per-field settings** — Basic (Required, Tooltip, Hint) + collapsed-by-default Advanced (Regex
  + message for text types, conditional Show/Read-only rule). Intrinsic props persist to
  `FieldDefinition.config`; Required/rule to the default-layout item.

**Layout regions / width**
- [ ] Designer groups items into **Main (left)** and **Sidebar (right)**; per item Column + Width +
  Section + Required + Hidden + reorder (within region). Width disabled when region=Sidebar.
- [ ] **Rich-text is locked** to Main + Full (controls disabled; server coerces even if a forged PATCH
  sends sidebar/half). Sidebar items always save `width=full`.
- [ ] Migration `0004` backfills existing layouts: priority/mode/requestor/assigned_group/assignee/
  source → `sidebar`; everything else → `main`. New projects get the same split from the seed.

**Layout-driven create form**
- [ ] Form renders **two panes** — Main (half/full-width grid) + Sidebar (stacked); when no sidebar
  fields exist it renders a single Main column. RTE/Description spans full width in Main.
- [ ] Honours order, sections, Required (skipped when an option field has no options yet — e.g.
  unconfigured Category — so creation isn't blocked), Hidden (Source hidden → auto `source=agent`),
  and the conditional rule (a "show when status=…" field is hidden at create since status has no
  value yet).
- [ ] **Create returns 201** with column-backed fields (summary/description/priority/requestor/
  assigned_group/assignee) at top level and value-backed (mode/category/custom) in `custom_fields`;
  requestor/assignee accept the **integer** user PK (CharField, not UUID); attachments upload after
  the ticket exists via `ticketAttachmentsApi.upload`.
- [ ] **React stability** — `FieldControl`, `UserPickerField`, `CascadeField`, `AttachmentField`,
  `LayoutItemRow`, `CascadeOptionsEditor`, `FieldSettingsDialog` are all module-top-level (none defined
  inside another component's body — prevents input focus loss).
- [ ] `tsc --noEmit` clean; `next build` compiles; `makemigrations --check` clean (0003 fields, 0004
  regions).

### Fields/Layout — Per-field Service Portal visibility (`portal_visible`, added 2026-06-25)

A new `FieldLayoutItem.portal_visible` (default `True`, migration `0005`) controls whether a field
shows on the **end-user Service Portal** request form, **independently** of `is_hidden` (which hides
from both agent + portal). The Layout designer gained a **Portal** toggle per field card. Replaces the
old hardcoded portal exclusion (picker types + assignment/source `maps_to`), which is now encoded in
the migration backfill so existing portals are byte-identical after migrating.

- [ ] **Backfill preserves behaviour** — after `migrate_schemas`, every existing layout item that is a
  `user_picker`/`group_picker` OR whose field `config.maps_to ∈ {assignee, assigned_group, requestor,
  source}` has `portal_visible=False`; every other item stays `True`. The portal create form shows the
  **same** fields it did before the change (summary/description/category/attachments/priority/mode; NOT
  requestor/assignee/group/source). **Multi-tenant: the migration runs per tenant schema** — verify the
  backfill landed in EACH org schema (`onemed`, `acme`), not just `public`.
- [ ] **Designer toggle** — Settings → project → **Layout**: each field card footer has Width /
  Required / Hidden / **Portal**. Toggling Portal PATCHes `field-layout-items/{id}` (`itsm.fields.layouts`,
  Supervisor write; a read-only agent's switch is disabled + a forged PATCH 403s). It is independent of
  Hidden (a field can be Hidden=off, Portal=off → agent sees it, requestor doesn't).
- [ ] **Server clamp** — `GET /portal/request-intake/layout/?project=` returns only `portal_visible`
  items (assignment/source/pickers absent by default); flipping a custom field's Portal off removes it
  from the payload; flipping a picker's Portal on adds it (opt-in works).
- [ ] **Security unchanged** — the portal `create` still force-ignores assignment/source `maps_to`
  (`_ALLOWED_MAPS_TO`) even if `portal_visible=True` were set on one; a requestor can never set
  assignee/group/requestor/source. (Covered by the existing portal create guard.)
- [ ] **No deadlock** — a field marked **Required + Portal-off** (`is_mandatory=True`,
  `portal_visible=False`) must NOT block portal submission: it isn't rendered to the requestor, and the
  create path validates with `validate_required(..., portal_only=True)` which skips it. (Covered by
  `test_mandatory_portal_hidden_field_does_not_block_create`.) Agents still validate the full set.
- [ ] **No-layout fallback** — a project with no `FieldLayout` still renders the synthetic
  Summary+Description form (both `portal_visible:true`).
- [ ] `apps.itsm_tickets`/`apps.itsm_core` suites pass (incl. `PortalLayoutVisibilityApiTests` — seeded
  defaults hide assignment/pickers; toggle opts a field in/out); `makemigrations --check` clean (0005);
  `manage.py check` clean; `tsc --noEmit` clean; `next build` compiles.

### Service Portal — Track-request detail shows `portal_visible` fields (added 2026-06-25)

`PortalTicketViewSet.retrieve` returns the ticket + its **portal_visible** field layout +
`field_values`, rendered read-only in the project's layout (main/sidebar) by
`components/portal/portal-field-display.tsx`, above the public-comment conversation.
- [ ] **Portal-visible only** — `GET /portal/requests/<number>/` `layout.items` + `field_values`
  contain only `portal_visible` items; a field toggled `portal_visible=False` is absent from both.
  (Covered by `PortalRequestDetailApiTests`.)
- [ ] **Standard columns** — a portal-visible standard field (`priority`, `summary`, …) carries the
  ticket's value (read off the column via `maps_to`, not a FieldValue).
- [ ] **No id leak** — a `user_picker` value renders as a **name** (resolved server-side), never a
  bare id. Internal `maps_to` (assignee/group/requestor/source) never appears.
- [ ] **No metadata leak** — the `fields` array ships only the definitions referenced by
  portal-visible layout items; a non-portal-visible field's name/type/options is absent from
  `fields` (not just `field_values`). (Covered by `test_non_portal_visible_field_hidden`.)
- [ ] **Ownership + comments unchanged** — others' tickets 404; the `comments` action stays
  public-only. No-layout project → minimal view (header + description + conversation), no empty grid.
- [ ] **Description not double-rendered** — summary stays the title; description renders once (top
  block); `PortalFieldDisplay` skips `summary` + description-mapped items (`SKIP_MAPS_TO`).
- [ ] React stability — `formatValue`/`groupBySection`/`Field`/`PortalFieldDisplay` are module-scope.

### Canned Responses — scope (workspace/project/personal) + badges (added 2026-06-25)

`CannedNote` gains `scope` + label FKs (`helpdesk`/`project`, migration `0004`). Management page at
`agent/canned-responses` (`components/canned-notes/*`); composer inserter shipped 2026-06-28 (below).
- [ ] **`is_shared` is server-derived** — `read_only` on the serializer, set from `scope` in
  `validate()`. A forged `is_shared` in the POST body is ignored.
- [ ] **Project scope derives helpdesk** server-side (`project.helpdesk`); project scope without a
  project → 400. Personal → both FKs null + `is_shared=False`. Workspace allows a null helpdesk.
- [ ] **Visibility = `is_shared OR owner=me`** — every agent sees every shared (workspace|project)
  note regardless of membership; another agent's personal note is absent (and 404s on delete).
  (Covered by `CannedNoteScopeApiTests`.)
- [ ] **Delete is supervisor-only** — agent DELETE → 403; supervisor → 204 (soft delete).
- [ ] **FKs `SET_NULL`** — deleting a helpdesk/project doesn't delete shared notes (badge generic).
- [ ] React stability — `scope-badge`/`canned-note-dialog`/`canned-notes-admin` are separate
  module-scope components; the `RichTextEditor` isn't remounted on scope change.
- [ ] `makemigrations --check` clean (0004); `manage.py check` clean; `tsc --noEmit` clean.

### Canned Responses — composer inserter (added 2026-06-28)

The ticket-detail comment composer (`components/tickets/ticket-detail.tsx`) gains a **"Canned
response"** button (`components/canned-notes/canned-response-picker.tsx`) that inserts a snippet's
sanitised HTML at the editor cursor. Insertion uses a new imperative handle on the shared editor:
`RichTextEditor` is a `forwardRef` exposing `RichTextEditorHandle { insertContent, focus }`.
- [ ] **Button gating** — the picker renders only when `hasPerm("itsm.canned_notes","read")` AND a
  current `helpdesk` exists; a role without the module never sees it.
- [ ] **Searchable dropdown** — opening fetches `cannedNotesApi.list({ helpdesk })`; the search box
  filters client-side over title/shortcut/body_text; results group by `category_name` (fallback
  "Uncategorized"); `Loader2` while loading; empty/no-match states render.
- [ ] **Insert at cursor** — picking a snippet inserts its `body_html` at the caret WITHOUT wiping an
  existing draft, in both **Public Comment** and **Internal Note** modes; a `toast.success` confirms.
  The snippet round-trips through the server `sanitize_html` again on comment submit (defence in depth).
- [ ] **Usage tracked** — `cannedNotesApi.use(id)` fires on insert (`usage_count` increments); a `use/`
  failure is swallowed and never blocks the insert.
- [ ] **Helpdesk isolation** — only the current helpdesk's shared notes (+ org-wide shared + own
  personal) appear; server `get_queryset` re-clamps, so a forged helpdesk can't widen the list.
- [ ] **React stability** — `CannedResponsePicker` is module-top-level; `RichTextEditor`'s `forwardRef`
  conversion doesn't remount it (other callers omit the optional `ref` and are unaffected).
- [ ] `tsc --noEmit` clean; `next build` compiles.

### Tickets — Inline field editing on the detail view (added 2026-06-21)

The agent ticket detail (`/agent/w/<hd>/p/<proj>/<id>`) is editable in place. Standard
column-backed fields save via `PATCH /tickets/<id>/` → `ticket_service.update_ticket` (the
single write site: audit log + `Assigned` hook + HTML sanitise); custom value-backed fields
save via `POST /tickets/<id>/set-fields/`. Status stays workflow-driven.

**Permission gating**
- [ ] An **Agent** or **Supervisor** (both have `itsm.tickets:update`) sees editable controls;
  a user without it sees the original read-only view (`hasPerm("itsm.tickets","update")` in the
  UI **and** a server-side 403 on a forged PATCH).
- [ ] A **Requestor** has no `itsm.tickets` grant → the agent PATCH/set-fields endpoints 403;
  the end-user portal stays conversation-only (no field editing there by design).
- [ ] **Helpdesk scope** — PATCHing a ticket in a helpdesk you're not a member of returns
  **404** (row not in `get_queryset`), never a silent cross-helpdesk write. (Covered by
  `test_cross_helpdesk_patch_is_404`.)

**Standard (column-backed) fields**
- [ ] **Priority** select (Critical/High/Medium/Low) auto-saves; an invalid value is rejected
  **400** server-side (`PRIORITY_CHOICES`). Activity feed gains a `priority_changed` row.
- [ ] **Assignee / Requestor** async user pickers (search via `/users/?search=`); selecting a
  user saves the **integer** User PK; "Clear" sends null. Assignee set stamps `assigned_at`
  and re-emits `Assigned` (notification). Unknown user id → **400**.
- [ ] **Group** select lists the helpdesk's groups + shared/global teams; "Unassigned" clears.
- [ ] **Summary** edits inline from the header (Enter saves, Esc cancels); an empty/whitespace
  summary is rejected **400** and the title is unchanged.
- [ ] **Description** edits via an Edit toggle (textarea); on save the body is **sanitised**
  (`<script>` / `onerror` stripped) and `description_text` is regenerated. (Covered by
  `test_patch_description_is_sanitised`.)
- [ ] **Type / Workflow / Created / Source** stay read-only (structural / system-set); status
  changes still go through the **transition buttons**, not a free dropdown.

**Custom (value-backed) fields**
- [ ] Editable controls render by type: dropdown/radio (select), checkbox, date/datetime,
  number, multiline, multiselect (checkbox list), cascade (dependent selects), group_picker.
  Each saves through `set-fields` and round-trips the same value shape the create form writes.
- [ ] **user_picker** custom fields stay read-only inline (not yet supported) — no empty/broken
  control renders.

**Behaviour / stability**
- [ ] Each edit shows a "Saved." toast, disables only the field being saved (`savingKey`), and
  refreshes the **activity feed** (the change appears) without a full reload of
  transitions/comments. A failed save toasts the API error and reverts.
- [ ] **React component stability** — every editable control (`PrioritySelect`, `GroupSelect`,
  `InlineUserPicker`, `DescriptionEditor`, `CommitInput`, `CommitTextarea`, `MultiSelectEdit`,
  `CascadeEdit`, `CustomFieldEdit`) is module-top-level (none defined inside `TicketDetailView`
  / `FieldView` — prevents input focus loss).
- [ ] `tsc --noEmit` clean; `next build` compiles; `makemigrations --check` clean (no model
  change); `apps.itsm_tickets` suite passes (`TicketInlineEditApiTests`).

### One Helpdesk — Helpdesk admin (create / disable / reorder, added 2026-06-21)

Central admin at `/agent/admin/helpdesks`, reached from the Home-bar gear (`components/admin/helpdesks-admin.tsx`).

- [ ] **Gear gating** — the Home-bar gear shows only for managers (`itsm.admin.helpdesks:update/create` or `isSupervisor`); plain agents never see it, and direct-navigating to the page gives them a read-only list + `ReadOnlyBanner`.
- [ ] **Manager sees disabled** — the admin list returns ALL helpdesks incl. `inactive`/`archived` (manager `get_queryset` is unclamped); a plain agent's list stays membership-scoped to active ones. (Backend: `apps.itsm_helpdesks.tests.HelpdeskAdminTests.test_manager_sees_inactive_agent_does_not`.)
- [ ] **Create appends** — a new helpdesk gets `order = max+1` (lands at the end of Home), not 0. `created_by` is stamped server-side; key validation (`^[A-Z][A-Z0-9]{1,4}$`) surfaces inline via `FieldRow`.
- [ ] **Disable is reversible + scoped** — toggling the `Switch` PATCHes `status` active↔inactive; a disabled helpdesk drops off every agent's Home + ticket scope (`accessible_helpdesk_ids` filters `status='active'`); re-enabling restores it. After the toggle the page calls `refreshUser()`.
- [ ] **Reorder persists globally** — drag (`@dnd-kit`) → `helpdesksApi.reorder(ids)` (`POST helpdesks/reorder`, atomic) sets `order=index`; `build_helpdesk_membership` then orders by `order,name`. The admin's Home updates after `refreshUser()`; other agents on their next `auth/me`. On API failure the local order **reverts** + toasts.
- [ ] **React component stability** — `HelpdesksAdmin`, `SortableHelpdeskRow`, `HelpdeskCreateDialog` are module-top-level (the dnd row is NOT defined inside the list component's body).
- [ ] **Migration** — `0002_helpdesk_order` adds `order` (+ backfill by name) and flips `Meta.ordering`; `makemigrations --check` is clean.

### One Helpdesk — Full-width responsive agent surface (added 2026-06-21)

The agent **working surface** now uses the full viewport width with adaptive gutters; only
forms/config/reading surfaces keep a max-width cap. Both agent `<main>`s dropped `max-w-7xl`:
`workspace-chrome.tsx` → `w-full px-3 py-6 sm:px-6 lg:px-8` (queue/dashboard/detail/project pages);
`agent-shell.tsx` → `w-full px-4 py-6 sm:px-6 lg:px-8` (Home/approvals/reports). Header gutters were
aligned to the body (`workspace-header.tsx` `px-3 sm:px-6 lg:px-8`; `agent-shell.tsx` header
`px-4 sm:px-6 lg:px-8`).

- [ ] **Queue fills the width** — at `/agent/w/IT/p/ITINC` on a ≥1440px screen the table spans the
  viewport (no centred ~1280px column, no large empty side gutters). The flexible **Summary** column
  absorbs the extra space; long summaries clamp to one line (`line-clamp-1`) with the full text in a
  `title` hover tooltip.
- [ ] **Header ↔ body align** — the AppSwitcher (left) and the Create/bells cluster (right) line up
  with the page body's left/right edges at `sm` and `lg` (gutters match: `sm:px-6`, `lg:px-8`). No
  stagger between the full-bleed header and a centred body (the defect in the report screenshot).
- [ ] **Responsive / adaptive** — resizing reflows smoothly; the shadcn table wrapper
  (`relative w-full overflow-auto`) gives the queue horizontal scroll on mobile with **no body-level
  horizontal overflow** (`globals.css` keeps `overflow-x-clip` on html/body so the sticky header
  survives). The dense workspace header keeps its `overflow-x-auto` tab strip on small phones.
- [ ] **Adaptive at ultra-wide** — Home helpdesk cards scale `sm:2 → xl:3 → 2xl:4` columns; Reports
  bar lists cap at `max-w-2xl` so the bars stay meaningful at 4K (otherwise they stretch unbounded).
- [ ] **Constrained surfaces unchanged (by design)** — Settings (`settings/layout.tsx` `max-w-6xl`,
  centred), Helpdesk admin (`max-w-4xl`) and the end-user **portal** (`portal-shell.tsx` `max-w-5xl`)
  keep their caps so config/reading line length stays legible. Full-width is scoped to the agent
  **queue/dashboard/detail** (and now the **create form** — see the 2026-06-22 section below). Do NOT add the
  workspace gutter to `settings/layout.tsx` (its `px-1` sits *inside* the already-padded chrome —
  bumping it double-pads).
- [ ] **Build/typecheck** — `tsc --noEmit` clean; `next build` compiles. Run a **clean** build (remove
  `.next` first): a stale cache yields a spurious `PageNotFoundError: Cannot find module for page:
  /agent/reports` (or `/agent/approvals`) at the "Collecting page data" stage that is NOT caused by
  this change — `✓ Compiled successfully` still prints above it.

### Tickets — Compact queue toolbar (2 rows) (added 2026-06-21)

The queue header above the table was collapsed from ~4 stacked rows to **2**: project title from
`page.tsx` moved into the queue toolbar; the search box was lifted out of `FilterBar` into row 1; and
`FilterBar`'s two internal rows were flattened into one.

- [ ] **Two rows max** — at `/agent/w/IT/p/ITINC` on a desktop width the toolbar is **row 1** (title
  left · search + **New ticket** right) + **row 2** (All-tickets view selector · filter chips · **More
  filters** · **Save view** · **Clear all**, all left-grouped). In the default view (5 chips, no values)
  it is exactly 2 rows. Under heavy filtering (many active/extra chips on a narrow width) row 2 wraps as
  a unit — it must NOT strand **Save view**/**Clear all** alone on a 3rd line (regression fixed by
  dropping `ml-auto`).
- [ ] **Search still works** — typing filters the list (debounced) and stays URL-synced (`?search=`);
  it now lives in the queue toolbar, not `FilterBar` (whose `search`/`onSearchChange` props were
  removed — verify no stale prop references).
- [ ] **Filters unchanged** — view selector, each chip (Status/Assignee/Priority/Type/Created), **More
  filters** (`FieldPicker`), **Save view** (disabled with no conditions) and **Clear all** (only when a
  filter is active) all behave exactly as before; chip popovers open and apply.
- [ ] **View selector looks distinct from filter chips** (2026-06-23) — the **Open**/**All tickets**
  view dropdown is a **filled** button (`variant="secondary"`) with a leading `LayoutList` icon and a
  bold label, clearly different from the **outline** field-filter chips beside it. A thin **vertical
  divider** separates the view selector from the chip cluster, so row 2 reads as two groups: **[view] |
  [field filters · More filters · Save view · Clear all]**. The divider stays attached to the view
  selector when the row wraps; it must NOT introduce a 3rd toolbar row in the default view.
- [ ] **Title not duplicated** — `page.tsx` no longer renders its own `<h2>`; the only project title is
  the one in the toolbar (no double heading).
- [ ] `tsc --noEmit` clean; clean `next build` compiles.

### Email Channel — mailbox → tickets, outbound via mailbox SMTP (added 2026-06-22)

`apps/itsm_email` (restored from archive + extended). Inbound IMAP/POP polling creates tickets/comments
through `ticket_service`; the project's mailbox SMTP sends the acknowledgement + agent public replies,
threaded. Config lives in **Settings → Email Channel → Mailboxes / Email Log**
(`agent/w/[hd]/settings/email[/logs]`). RBAC: `itsm.email.channels` (Supervisor write; Agent read-only),
`itsm.email.logs` (Agent read; retry is Supervisor-only). Secrets Fernet-encrypted, write-only.

**Create vs. comment vs. ignore (JSM parity)**
- [ ] **New sender → ticket** — a fresh email creates `INC-N` (`source="email"`), subject→summary,
  body→description (sanitised), sender auto-created as a **non-login requestor with no RoleAssignment**.
- [ ] **Reply → public comment** — a reply matched **subject-first** (subject ticket number `[INC-N]`
  **or bare `INC-N`** → then `In-Reply-To`/`References` header map → then `Reply-To` plus-token) lands as
  a public comment on the same ticket; quotes/signature stripped. The subject number threads on any match
  (ungated); plus-token still requires sender ownership.
- [ ] **Ignored** — auto-reply (`Auto-Submitted`/`Precedence: bulk`/OOO/bounce/list), self-loop,
  mail-loop, blocklisted sender, too old, and oversize message are each logged on `InboundEmail` with
  the right `ignore_reason` (`auto_reply`/`loop`/`blocklist`/`age`/`size_cap`) — never silently dropped.
- [ ] **Idempotent** — re-feeding the same `Message-ID` (POP3 redelivery / retry) never double-creates
  (unique `(channel, message_id)`); IMAP `\Seen` is set only after the durable write.

**Mappings (all visible in the Field Mapping tab)**
- [ ] **Priority** — `X-Priority`/`Importance`/`X-MSMail-Priority`/`Priority` map to ticket priority via
  the editable `priority_map`; no signal → `default_priority`. `X-Priority: 1` → critical by default.
- [ ] **Attachments** — saved to the ticket/comment; a single part over `max_attachment_bytes` is
  **skipped** (not saved) and listed in a **private agent note**, and the ticket is still created.
- [ ] **CC → watchers** when `cc_watchers`; **field_mappings** block is present in the GET payload.

**Outbound (mailbox SMTP + threading)**
- [ ] **Acknowledgement** — creating an email-sourced ticket sends the seeded `TicketCreated`→requestor
  mail **From the channel address** with `Reply-To` = the **configured mailbox address** (NOT a
  `support+token`; a reply must reach the real inbox) + `Message-ID` (transport hook swaps connection +
  From; verifiable with `EMAIL_BACKEND=console`).
- [ ] **Agent reply** — a public comment emails the requestor from the mailbox, threaded; the customer's
  reply (Flow C) lands back as a public comment — full loop.
- [ ] **Graceful fallback** — no channel / OAuth refresh failure → outbox falls back to the global
  `DEFAULT_FROM_EMAIL` backend (mail still sent, logged); **no-channel mail is byte-identical** to before.
- [ ] **Test actions** — `test-connection` (inbound) and `test-smtp` (outbound, basic + XOAUTH2) return
  `{ok, detail}` (HTTP 200) without ingesting/sending.

**Auth & security**
- [ ] **Basic + OAuth2** — Gmail/O365 OAuth uses XOAUTH2 for IMAP **and** SMTP (`SMTP.Send` scope for
  Microsoft); token auto-refreshes. Secrets (`password`/`smtp_password`/tokens) never echoed on read.
- [ ] **RBAC** — Agent gets a read-only mailbox list + Email Log; forged channel write or log `retry`
  → 403. Supervisor full CRUD.

**Build/migration**
- [ ] `apps.itsm_email` suite (**35 tests**) + `apps.itsm_tickets` + `apps.itsm_notifications` pass;
  `makemigrations --check` clean (only the intended `itsm_email/0001`); `seed_itsm` re-runnable
  (creates `email-bot`). Frontend `tsc --noEmit` clean; `next build` compiles `settings/email[/logs]`.

### Tickets — Configurable queue columns + SLA bars (added 2026-06-21)

The queue table is now driven by a shared column registry (`components/tickets/queue-columns.tsx`).
Default layout = the old columns **plus** Requestor, Group, Response SLA, Resolution SLA. Supervisors
set a per-project default (**Columns** tab → `Project.queue_columns`); agents override their own layout
from the queue's **Columns** popover (persisted server-side in `QueueColumnPreference`).

- [ ] **Default columns** — a fresh project's queue shows ID, Summary, Status, Priority, Requestor,
  Assignee, Group, Response SLA, Resolution SLA, Created (in that order).
- [ ] **Project default** — Settings → project → **Columns**: toggle/reorder, Save; the queue reflects
  it for everyone. **Reset to default** restores the built-in set. Summary cannot be unchecked.
- [ ] **Per-agent override** — queue **Columns** popover: toggling/reordering persists immediately
  (`POST /queue-columns/`), survives reload and a different browser/device, and **Reset** clears the
  override (falls back to the project default). One agent's layout never affects another's.
- [ ] **SLA bars** — Response & Resolution cells show a RAG progress bar + "Xh left/over" (or
  Paused/Met/Breached); breached shows red + bold; tickets with no SLA policy show "—". Labels refresh
  ~每minute. Sorting by a non-sortable column (Requestor/Group/SLA*/by-user) is simply not offered.
- [ ] **No N+1** — list endpoint prefetches `sla_trackers__metric`; opening the queue issues a constant
  number of queries regardless of row count. The `sla` RAG is wall-clock (no per-row calendar reads).
- [ ] `tsc --noEmit` clean; clean `next build` compiles; `makemigrations` clean.

### SLA — Stopped clocks show outcome, not a live countdown (added 2026-06-23)

A first-response clock is **stopped** when the agent posts the first public reply
(`add_comment` → `sla_stop("first_response")`) or the status reaches a **done** category (changed
2026-06-23, ITINC-606 — moving to in_progress no longer counts as a response); the resolution
clock stops when the status reaches a **done** category. `stop()` freezes `stopped_at` and ends the clock
`met` (`now ≤ due_at`) or `breached` (`now > due_at`). A late reply ends **breached** and stays breached —
responding does NOT un-breach a missed SLA (correct ITSM). The renderers must show that a stopped clock is
*finished*, never a live "overdue" that looks unanswered.

- [ ] **Detail panel — running clock** (`sla-panel.tsx`): a still-running metric shows the live label —
  "Xh Ym left" (green/amber) or "Xh Ym overdue" (red) when past due but not yet stopped; "Paused" when paused.
- [ ] **Detail panel — stopped clock shows outcome:** reply to a ticket whose first-response SLA is already
  past due → the **Time to First Response** line flips from "Xh overdue" to **"Breached"** (red), not a
  growing countdown. A reply *within* target → **"Met"** (green). A resolved ticket shows resolution as
  **"Met"**/"Breached", not "Xh left". (Driven by `statusLabel(e)` keying off `e.state`, not
  `remaining_minutes`.) Repro ticket: ITINC-605.
- [ ] **Queue bar parity** (`queue-columns.tsx` `SlaBar`): the Response/Resolution cells show "Met"/"Breached"
  for a **stopped** clock (its `done` set includes `met`, `breached`, `stopped`) and the live "Xh left/over"
  only for a `running` clock. A breached-*running* clock (overdue, not yet stopped) still shows the live "over".
- [ ] **Engine unchanged** — `GET /tickets/{id}/sla/` (`countdown_payload`) and the list `sla` payload still
  return `state` + `breached`; `first_responded_at` is stamped only by the **first public** reply (a private
  note does not stop the first-response clock). `tsc --noEmit` clean; clean `next build` compiles.

### Tickets — Rich-text comment composer + inline images & file attachments (added 2026-06-24)

The agent detail-view comment composer (`components/tickets/ticket-detail.tsx`) is now a **rich-text
editor** (was a plain `<textarea>`) with **inline images** (embedded in the body) and **file
attachments** (listed below the reply). Backend: the dormant `CommentAttachment` model is wired up
(migration `0003`; `comment` nullable + new `ticket` FK + `kind` file|image), a new
`CommentAttachmentViewSet` (`/comment-attachments/`), and `add_comment(attachment_ids=…)` association.

- [ ] **Composer is the RTE** — the reply box shows the shared Tiptap toolbar (bold/italic/lists/link/…)
  plus an **Insert image** button and an **Attach files** button. The Public Comment / Internal Note
  toggle still renders for agents; switching to Internal still tints the box amber (now via the RTE's
  `className`) and relabels the submit button.
- [ ] **Inline image uploads, never base64** — paste / drop / pick an image → it uploads to
  `POST /comment-attachments/` (`kind=image`) and is embedded as `<img src="<absolute /media URL>">`.
  Posting the comment keeps the image (bleach allows `<img>` http/https). A pasted **base64** `data:` URI
  would be stripped by `sanitize_html`, which is exactly why we upload + embed a URL (don't "fix" by
  allowing `data:`). Verified by `CommentAttachmentApiTests.test_inline_image_html_survives_sanitise`.
- [ ] **Absolute URLs** — both the inline `<img src>` and the file-list `<a href>` resolve in **dev**
  (FE `:3000` ≠ API `:8000`): the upload response + the `comments` action serializer pass
  `context={"request": …}` so `file` is absolute. A relative `/media/…` would 404 against the FE origin.
- [ ] **File attachments** — **Attach files** stages files as chips (with remove ✕); on submit they
  associate to the reply (`kind=file`) and render as download links **under** the comment body (not
  inline). A reply with **only** a file (empty body) is allowed; an empty reply with no files is not.
- [ ] **Upload-before-submit + association** — an upload returns a row with `comment=null`
  (ticket-scoped); `add_comment` stamps `comment` from `attachment_ids`, **clamped to the same ticket +
  unattached rows**. A forged id from another ticket/comment is **not** associated (verified:
  `test_attachment_from_another_ticket_is_not_associated`). Inline images deleted from the body before
  submit are dropped from `attachment_ids` (FE filters by URL still present in `body_html`).
- [ ] **Guards** — >10 MB → 400; `kind=image` with a non-`image/*` content-type → 400
  (`test_image_kind_requires_image_content_type`); uploading to a ticket in a helpdesk you're not a
  member of → **403** (`test_upload_to_inaccessible_helpdesk_is_403`); reads clamped to accessible
  helpdesks. Module `itsm.tickets.comments` (an Agent inherits create from `itsm.tickets`).
- [ ] **Shared RTE unchanged elsewhere** — Description + custom rich-text fields have **no**
  `onImageUpload` → no Insert-image button and paste/drop don't upload (image-free, as before). The
  `@tiptap/extension-image` is still registered everywhere so any stored `<img>` round-trips.
- [ ] **React component stability** — `RichTextEditor`'s paste/drop handlers read the editor + upload fn
  via refs (created once, never stale); the composer controls live in `TicketDetailView` but the RTE and
  its sub-toolbar are module-top-level (no focus loss).
- [ ] **Tests/build** — `apps.itsm_tickets` suite passes (now **61**, incl. `CommentAttachmentApiTests`);
  `makemigrations --check` clean; `tsc --noEmit` clean; clean `next build` compiles.

### Workflows — Transition note prompt (slide-over on state movement) (added 2026-06-24)

A transition can be configured to open a slide-over asking for a note on movement
(`Transition.note_prompt`/`note_required`/`note_heading`/`note_visibility`, migration
`itsm_workflows/0002`). The note is posted as a **comment** (public/internal) via the existing
`tickets/{id}/transition/` `comment`/`comment_visibility` flow — never the `resolution` field.

- [ ] **Config UI** — Settings → project → **Workflow**: each transition row has a **Configure**
  (sliders) button → dialog with **Prompt for a note** toggle, **Note Heading**, **Note Type**
  (Public Comment / Internal Note) and **Mandatory/Optional**. Save persists via
  `PATCH /transitions/{id}/`; a configured row shows a `note: <heading>` badge. Gated by `canEdit`
  (`itsm.workflows:update`); a read-only agent sees no Configure button and a forged PATCH 403s.
- [ ] **Seeded product defaults** — a freshly-seeded workflow has **Resolve** (Incident) / **Fulfil**
  (Request) prompting a **mandatory public** "Resolution Note", and **Put on Hold** prompting a
  mandatory public "Reason to hold". `seed_itsm` is re-runnable (note fields are in `defaults`, so a
  re-seed restores them — consistent with `post_functions`).
- [ ] **Slide-over on movement** — clicking a transition button with a prompt opens the `Sheet`
  (titled with the heading) instead of moving immediately; a transition **without** a prompt still
  moves at once. The sheet uses the shared `RichTextEditor` (image-free) and tints amber for an
  Internal note.
- [ ] **Mandatory blocks empty** — for a mandatory note the **submit is disabled until the note is
  non-empty**; Cancel/close aborts the move (status unchanged). Backend defense-in-depth: a forged
  `transition` POST with no `comment` returns **422** (`engine._validate`, error key `comment`).
- [ ] **Optional note** — a non-mandatory prompt allows submit with an empty note → the ticket moves
  with no comment posted; with text → the comment is posted.
- [ ] **Note lands correctly** — on submit the ticket moves AND a comment appears whose body is the
  **heading in bold** followed by the note, with **public/internal** matching the configured Note Type
  (an Internal note shows the amber "Internal" badge and isn't sent to the requestor). A public note on
  the first reply still stamps `first_responded_at`; an internal one does not (cross-check SLA).
- [ ] **Tests/build** — `apps.itsm_tickets.tests.WorkflowTransitionTests` passes (7, incl.
  seeded-Resolve-prompts + mandatory-note blocks/allows); existing Resolve-path tests in
  `itsm_tickets`/`itsm_sla` pass a `comment`. `makemigrations --check` clean (`itsm_workflows/0002`);
  `manage.py check` clean; `tsc --noEmit` clean; `next build` compiles the workflow settings + detail
  routes. *(Note: 3 pre-existing `itsm_sla.FirstResponseStopTests` `SLATracker.DoesNotExist` errors are
  unrelated to this change.)*

### Tickets — Public Comment / Internal Note composer toggle (added 2026-06-23)

The agent detail-view comment composer (`components/tickets/ticket-detail.tsx`) can now post a **Public
Comment** (default) or an **Internal Note** (private). The backend `Comment.visibility`, `add_comment`,
and the comments endpoint already supported this; only the composer UI was missing. Private notes are
gated by `itsm.tickets.comments_private`.

- [ ] **Default is Public Comment** — opening a ticket and posting a reply with no further action creates
  a **public** comment (`visibility="public"`); the selector shows **Public Comment** highlighted on load.
- [ ] **Toggle visible to agents** — an Agent/Supervisor (has `itsm.tickets.comments_private`) sees a
  two-button segmented control (**Public Comment** / **Internal Note**). Switching to **Internal Note**
  tints the textarea amber, changes the placeholder ("…only agents can see this…"), the submit label
  ("Add internal note"), and the success toast.
- [ ] **Internal note round-trips** — posting an Internal Note creates a `visibility="private"` comment
  that renders with the existing amber **"Internal"** badge; it is **not** sent to the requestor and does
  **not** stamp `first_responded_at` (only the first *public* reply does — cross-check the SLA section).
- [ ] **Composer hidden without the grant** — a user lacking `itsm.tickets.comments_private` read (e.g. a
  Requestor, or a custom role with an explicit deny) sees only the public composer, no toggle.
- [ ] **Forged private is rejected** — `POST /tickets/{id}/comments/` with `visibility="private"` from a
  caller without `comments_private` read → **403** (not silently downgraded); a public POST from the same
  caller still returns **201**. (Covered by `CommentVisibilityApiTests.test_forged_private_without_grant_is_403`.)
- [ ] **Tests/build** — `apps.itsm_tickets` suite passes (now **53**, incl. `CommentVisibilityApiTests`);
  `tsc --noEmit` clean; clean `next build` compiles.

### Tickets — Comments / Activity tabs + audit fields (added 2026-06-21)

Detail view: Comments and Activity are tabs at the bottom of the main column; the meta rail shows the
full audit trail.

- [ ] **Tabs** — `/agent/w/<hd>/p/<proj>/<id>` shows a **Comments** / **Activity** tab strip (JIRA-style)
  at the bottom-left; counts appear in the labels; switching preserves the composer; empty states render.
- [ ] **Audit rail** — sidebar shows Created, **Created by**, **Last updated**, **Updated by**. After any
  inline edit, Last updated/Updated by reflect the editor (`Ticket.updated_by` set by `update_ticket`).
- [ ] **Component stability** — the tab/editor controls are module-top-level (no focus loss on re-render).

### Tickets — Activity feed shows *what* changed (old → new) (added 2026-06-23, ITINC-606)

The detail-view **Activity** tab now renders **actor · verb · detail · when** — previously it dropped the
audit payload and showed only who/when. Backend write sites store **human-readable labels at change time**;
the frontend (`ticket-detail.tsx` `activityVerb`/`activityDetail`/`activityValue`/`PRIORITY_LABEL`) renders
the before/after from `AuditEvent.payload`. No model/migration change.

- [ ] **Standard-field edits show before→after** — change Priority (Medium → High), Assignee, Requestor,
  Group, and Summary on a ticket; each Activity row shows the change (e.g. "changed priority **Medium →
  High**", "changed assignee **— → Bob Builder**", "edited the summary **New title**"), not a bare
  "updated a field".
- [ ] **Custom-field edits name the field + value** — editing a custom field renders "changed **{Field
  Name}** {old} → {new}" (verb pulls `payload.name`; value via `activityValue` — bools→Yes/No, arrays
  joined, empty→"—"). This works retroactively (the field engine always logged `{old,new,name}`).
- [ ] **Status change** — a transition row shows "changed status **{From} → {To}**" (status **names**, from
  the workflow-engine payload `from`/`to`).
- [ ] **Labels are captured at change time** — backend `assigned`/`requestor_changed`/`group_changed`
  payloads carry `old_label`/`new_label` (display names via `_user_label`/`_group_label`), so renaming the
  user/group later does **not** rewrite history. Verified by `TicketInlineEditApiTests`
  (`test_assignee_change_logs_human_label`, `test_group_change_logs_human_label`,
  `test_summary_change_logs_old_and_new`).
- [ ] **Graceful back-compat** — Activity rows logged **before** this change (no `*_label`) render the verb
  only for assignee/requestor/group (never a misleading "Unassigned → Unassigned"); the feed never errors
  on a missing/odd payload (`activityDetail` returns null → verb-only row).
- [ ] **Verb coverage** — SLA/attachment/watcher/link/template actions have friendly verbs (no raw
  `sla_started`); unknown actions fall back to a de-underscored label. `comment_added` shows "internal note"
  for a private comment, nothing extra for a public one.
- [ ] **Tests/build** — `apps.itsm_tickets` suite passes (now **56**); `tsc --noEmit` clean; clean
  `next build` compiles; `makemigrations --check` clean (no model change).

### Tickets — Strict group-scoped assignee (added 2026-06-21)

A ticket's assignee must be an active member of its assigned group.

- [ ] **Picker is group-scoped** — the assignee control (detail + create form) lists only the assigned
  group's active members, **leads first**; a stale assignee shows "(not in group)"; with no group set it
  shows "Set a group first" and assignment is blocked.
- [ ] **Backend enforcement** — `PATCH /tickets/{id}/` with an assignee who isn't in the group → 400
  (`test_patch_assignee_not_in_group_is_400`); same for the create form and the `assign` action; bulk
  assign silently skips violating tickets. Clearing the assignee (null) always works.
- [ ] **Members management** — group members sheet adds a member as **member or lead**, and a row's
  **Make lead / Make member** toggles the role (`add_member` upserts). Lead badge renders.
- [ ] **No internal breakage** — routing auto-assign, SLA escalation reassign, portal/catalog create and
  seeds still work (the low-level `create_ticket`/`assign` services stay permissive).

### Settings — SLA configuration (added 2026-06-21)

Project settings → **SLA** tab manages the project's SLA policy (First Response + Resolution, per-priority).

- [ ] **Set up** — a project with no policy shows "Set up SLA policy"; clicking creates the policy + both
  metrics + default per-priority targets, then renders the editor. Agents without `itsm.sla.policies`
  see read-only.
- [ ] **Per-priority targets** — each metric shows Critical/High/Medium/Low minute inputs with a humanised
  hint (e.g. 240 → "4h"); Save upserts/deletes `SLATarget` rows; a blank clears that priority's target.
- [ ] **Calendar** — the policy calendar selector persists; project calendar still wins at runtime.
- [ ] **Engine wiring** — creating a ticket in the project spawns Response + Resolution `SLATracker`s with
  due dates from the per-priority budget; the queue SLA bars and detail SLA panel reflect them.
- [ ] `makemigrations` clean; `tsc --noEmit` + `next build` clean.

### Settings — Ticket-categories editor removed from Overview (added 2026-06-22)

The low-value **Ticket categories** management section was removed from the project Settings → **Overview**
tab (it CRUDed `TicketType`). `TicketType` is otherwise unchanged — categories are still seeded per project
and consumed read-only by the ticket flow — so this is a UI-only removal, not a model teardown.

- [ ] **Section gone** — Settings → project → **Overview** no longer renders the "Ticket categories"
  heading, the category list, the per-row Default/Delete actions, or the "New category name" add row.
  The form above it (name/key/desc/status/group/workflow/calendar/icon/colour + **Save changes**) is
  unchanged and still saves.
- [ ] **Categories still work everywhere else** — the create-form **Type** selector still lists the
  project's categories (Incident/Hardware/Network/Application for an incident project) and the choice
  still drives the resolved field layout; the queue **Type** filter and the detail **Type** row still
  resolve. All read the embedded `project.ticket_types` (no `/ticket-types` GET from the UI anymore).
- [ ] **Dead code removed** — `components/settings/ticket-types-editor.tsx` deleted; `ticketTypesApi`
  (api.ts) and `CreateTicketTypeInput` (types.ts) removed; no remaining import of any of them
  (`grep` is clean). `TicketType` type + backend model/serializer/seed/`TicketTypeViewSet` stay.
- [ ] **Build/typecheck** — `tsc --noEmit` clean; clean `next build` compiles.

### Tickets — Full-width create form (added 2026-06-22)

The agent ticket **create form** (`components/tickets/ticket-create-form.tsx`) now fills the full-width
working surface instead of the old `max-w-5xl` cap (it looked stranded on the left of a wide screen). The
two-pane layout mirrors the **detail view**: `grid lg:grid-cols-[minmax(0,1fr)_320px]` — the Main column
flexes to fill the width; the Sidebar is fixed at 320px (NOT 1/3 of the viewport, which is what the old
`lg:grid-cols-3` + `lg:col-span-2` produced once uncapped).

- [ ] **Form fills the width** — at `/agent/w/IT/p/ITINC/new` on a ≥1440px screen the form spans the
  viewport (no centred ~1024px column stranded on the left). The Main column (Summary/Description/
  Category/Attachments) absorbs the extra space; full-width fields (Description/richtext) span the Main
  column, half-width fields stay 2-up (`sm:grid-cols-2`).
- [ ] **Sidebar is fixed 320px** — the DETAILS / PEOPLE sidebar (`hasSidebar`) stays a comfortable 320px,
  not stretched to a third of an ultra-wide screen. Matches the detail view's
  `lg:grid-cols-[minmax(0,1fr)_320px]`.
- [ ] **No-sidebar layouts unchanged** — a project layout with no sidebar fields still renders a single
  centred `max-w-2xl` Main column (a lone single-column form must NOT stretch edge-to-edge).
- [ ] **Build/typecheck** — `tsc --noEmit` clean; `next build` compiles.
  *(2026-06-23: the standalone **Type** dropdown was removed from this form — see the section below.)*

### Tickets — Create form matches the layout config (Type removed) (added 2026-06-23)

The standalone **Type** selector was removed from the agent create form
(`components/tickets/ticket-create-form.tsx`) — it was a config↔create mismatch (Type is neither on the
Layout designer nor manageable in project config since the 2026-06-22 categories-editor removal). New
tickets silently use the project's default ticket type.

- [ ] **No Type control on create** — at `/agent/w/IT/p/ITINC/new` there is **no "Type" dropdown** above
  the form panes. The first visible thing is the layout's first section (e.g. Summary), not a type picker.
- [ ] **Create still types the ticket** — creating a ticket sets `ticket_type` to the project's
  **default** type (`is_default`, else the first); the new ticket's detail **Type** row and the queue
  **Type** filter still show/resolve it. Layout resolution is unchanged (`layoutsApi.resolve` is called
  with the default type, which falls back to the project-default `FieldLayout`).
- [ ] **Create page == layout config** — the fields/sections rendered on `…/new` match the project's
  **Layout** tab (`settings/projects/<KEY>?tab=layout`), modulo hidden fields (e.g. `source`, `is_hidden`,
  which the designer shows greyed for un-hiding but the form omits) and the conditional `visibility_rule`.
- [ ] **No dead refs** — `setTicketType` is gone; `grep setTicketType components app` is clean;
  `tsc --noEmit` clean; clean `next build` compiles the `…/p/[projectKey]/new` route.

### Tickets — Wider detail/create sidebar + select overflow guard (added 2026-06-23)

The detail-view and create-form right sidebar widened **320px → 360px**
(`lg:grid-cols-[minmax(0,1fr)_360px]` in `ticket-detail.tsx` + `ticket-create-form.tsx`). On the **detail
view** the sidebar rows are inline `flex justify-between`, so long native `<select>`s (Assigned Group,
Assigned Technician) were auto-growing past the card border; they're now capped to truncate inside it.

- [ ] **Sidebar is 360px** — at `/agent/w/IT/p/ITINC/<id>` and `…/new` (≥1024px) the right rail is a bit
  wider; the Main column flexes to absorb the rest. Supersedes the 320px figure in the create-form section.
- [ ] **No overflow** — on the detail view, the **Assigned Group** ("IT Helpdesk Service Desk") and
  **Assigned Technician** selects sit fully inside the PEOPLE card; their right edge no longer crosses the
  border. A longer-than-fits value truncates (native select ellipsis) rather than spilling out.
- [ ] **How it's done** — detail `<dd>` rows + the `Row` helper carry `min-w-0`; `selectCls` carries
  `max-w-full`; `GroupMemberPicker`'s `w-44` carries `max-w-full`. The **create form** is unchanged here
  (its sidebar fields are stacked with `w-full` selects — no inline overflow to guard).
- [ ] **Build/typecheck** — `tsc --noEmit` clean; `next build` compiles (CSS-class-only change).

### Settings — Filters tab + queue default views (added 2026-06-22)

New project Settings → **Filters** tab (`components/settings/filters-editor.tsx`, module `itsm.projects`)
+ queue default-view resolution. Two new `Project` columns (`default_view_key`, `disabled_view_keys`,
migration `0004`) + new per-user `itsm_dashboards.QueueViewPreference` (route `/queue-view/`, migration
`0004`). Product default view = **Open tickets** (`PRODUCT_DEFAULT_VIEW_KEY="open"`).

- [ ] **Fresh visit lands on the default** — opening `/agent/w/IT/p/ITINC` with a clean URL (no
  `?view`/`?q`) shows **Open tickets** out of the box (product default), with **no flash of "All
  tickets"** first (the `ready` gate holds the first fetch until resolved).
- [ ] **Deep links untouched** — navigating to `…/p/ITINC?view=all` (or a `?q=` spec) loads exactly that;
  default resolution is skipped.
- [ ] **System view enable/disable** — Filters tab → uncheck e.g. "Recently updated" → Save defaults →
  it disappears from the queue's view dropdown for everyone on the project. **"All tickets" cannot be
  disabled** (checkbox is disabled, shows "Always on"); a forged PATCH with `disabled_view_keys:["all"]`
  is stripped server-side (`validate_disabled_view_keys`) — also drops unknown keys + dups.
- [ ] **Custom filter builder** — Filters tab → "New filter" opens the same chip builder used on the
  queue (Status/Assignee/Priority/Type/Created + More filters); save creates a project-shared
  `SavedFilter` that then appears under "Project filters" in the queue dropdown and in the queue page.
  Edit/rename/delete and reorder (▲▼) all persist; delete removes it from the dropdown.
- [ ] **Project default** — Filters tab → "Project default view" select (system views + custom filters)
  → Save defaults → an agent with **no personal default** lands on it. Setting `default_view_key` to a
  deleted filter / unknown key is blanked server-side (`validate_default_view_key`) → falls back to
  product default.
- [ ] **Personal default (star)** — on the queue, the view dropdown shows a **star** per row; clicking it
  POSTs `/queue-view/` (upsert) and marks it filled. Reload → that view is applied (it **overrides** the
  project default). Starring a different view replaces it. One agent's default never affects another's
  (owner-clamped `get_queryset`).
- [ ] **Resolution precedence** — personal default → project default → product default (`open`) → All
  tickets; each candidate must still resolve to an available view (an enabled system view or an existing
  saved filter) or it falls through.
- [ ] **RBAC** — the Filters tab writes ride `itsm.projects:update` (project defaults/disabled keys) and
  `itsm.tickets.queue` (custom filters via `savedFiltersApi`, personal default via `queueViewApi`); a
  read-only agent sees disabled toggles/inputs and forged writes 403 server-side.
- [ ] **React component stability** — `FiltersEditor`, `FilterBuilderDialog`, `ConditionChips`,
  `DefaultStar` are module-top-level (none nested in another component's body — no input focus loss in
  the builder).
- [ ] **Build/tests** — `tsc --noEmit` clean; `manage.py check` + `makemigrations --check` clean;
  `apps.itsm_dashboards` suite passes (`QueueViewPreferenceTests`, `ProjectFilterDefaultsTests`).

### Tickets/Fields — Rich-text editor with formatting toolbar (added 2026-06-23)

`richtext` fields (Description + any custom rich-text field) now render a shared TipTap editor
(`components/ui/rich-text-editor.tsx`) instead of a plain textarea — they had **no formatting controls
at all** before. `multiline` stays a plain textarea (it is NOT richtext).

- [ ] **Toolbar renders + toggles** — the create form's Description field (`…/p/<proj>/new`) shows a
  toolbar above the editor: Bold / Italic / Underline / Strike / H2 / H3 / Bullet list / Numbered list /
  Quote / Inline code / Link / Clear formatting / Undo / Redo. Each button toggles its mark on the
  selection and shows an **active** (accent) state when the cursor is inside that mark. Markdown
  shortcuts (`**bold**`, `# ` → heading, `- ` → list) also work via StarterKit.
- [ ] **Formatting is visible** — applying Bold / a bullet list / a heading visibly changes the text in
  the editor AND in the saved read-only view (lists show bullets/numbers, headings are larger, quote is
  indented). This is styled by hand in `app/globals.css` (`.prose`/`.rte-content` rules) because the repo
  ships **no `@tailwindcss/typography` plugin** — without those rules `prose` is a no-op and rich text
  renders flat. Existing read views (comments, KB, descriptions) also pick up the styling.
- [ ] **Empty doc → empty value** — clearing all content stores `""` (not `<p></p>`): a Required
  Description with an empty editor still fails validation; an optional one isn't persisted as junk markup.
- [ ] **Detail Description edit** — the detail view's Description **Edit** toggle opens the same editor
  seeded from the stored HTML (not the plain-text mirror); Save round-trips formatted HTML; the read
  block shows the formatting. Cancel discards.
- [ ] **Inline custom richtext** — a custom `richtext` field on the detail view edits via the toolbar
  editor and **commits on blur** (one `set-fields` write per edit, not per keystroke); its read value
  renders as a sanitised prose block, not raw `<p>…</p>` text.
- [ ] **Server still sanitises** — saving a Description or custom richtext body containing
  `<script>alert(1)</script>` / `<img src=x onerror=…>` strips them. Column path:
  `ticket_service` (`sanitize_html`); custom path: `field_service._coerce` (richtext branch). (Covered by
  `test_patch_description_is_sanitised` + `QueryBuilderTests.test_richtext_custom_field_value_is_sanitised`.)
- [ ] **Link safety** — the Link button writes `rel="noopener noreferrer nofollow" target="_blank"`;
  only `http/https/mailto` survive bleach (a `javascript:` href is dropped).
- [ ] **React component stability** — `RichTextEditor`, `Toolbar`, `TBtn`, `Divider` are module-top-level;
  the editor does not lose focus / cursor position while typing (external `value` re-sync skips our own
  emitted HTML — no cursor jump per keystroke). The toolbar uses `onMouseDown preventDefault` so clicking
  a button keeps the editor selection.
- [ ] **Build** — `tsc --noEmit` clean; clean `next build` compiles (`/new` + `/[ticketId]` carry the
  TipTap bundle); `makemigrations --check` clean (no model change); `apps.itsm_tickets` suite passes.

### Tickets — Top-right Cancel on the create form (added 2026-06-23)

The new-ticket page (`app/(agent)/agent/w/[helpdeskKey]/p/[projectKey]/new/page.tsx`) gained a
**second Cancel** at the top-right of the header row, beside the "New {project} ticket" heading, for a
quick escape without scrolling to the form footer. It mirrors the existing footer Cancel exactly.

- [ ] **Button present + placed** — at `/agent/w/IT/p/ITINC/new` an `outline` **Cancel** button (with an
  `X` icon) sits at the **top-right**, aligned with the "New IT Incident Management ticket" heading
  (heading + button in a `flex items-start justify-between` row). The form's **bottom** Cancel (beside
  **Create ticket**) is still there — both coexist.
- [ ] **Same action** — clicking the top Cancel calls `router.back()` (returns to the prior page, e.g. the
  queue), identical to the footer Cancel; no ticket is created and no form submit fires (`type="button"`).
- [ ] **Lives in the page, not the form** — the button is in `new/page.tsx` (where the heading it aligns
  with is rendered); `ticket-create-form.tsx` is unchanged. The top Cancel is **not** disabled by the
  form's `busy` state (it's outside the form) — acceptable as a deliberate "get me out" escape.
- [ ] **Build/typecheck** — `tsc --noEmit` clean; clean `next build` compiles the `/new` route.

### Tickets — Frozen (sticky) queue pager (added 2026-06-23)

The agent queue **pager** (the "Showing X–Y of N" + Prev/page-numbers/Next row at the foot of
`components/tickets/ticket-queue.tsx`) is now **frozen to the bottom of the viewport** so it stays
visible while a long ticket list scrolls behind it — mirroring the sticky top `WorkspaceHeader`. The
wrapper `<div>` gained `sticky bottom-0 z-30` + a full-bleed footer bar (`border-t bg-card/95
backdrop-blur supports-[backdrop-filter]:bg-card/80`, negative gutters `-mx-3 px-3 py-3 sm:-mx-6
sm:px-6 lg:-mx-8 lg:px-8`). CSS-class-only change — no JS/logic touched.

- [ ] **Pager stays visible while scrolling** — at `/agent/w/IT/p/ITINC` with >25 tickets (≥2 pages),
  scroll the table down: the "Showing 1–25 of N" + Prev/1/2/…/Next bar **stays pinned to the bottom of
  the viewport** (does not scroll away), exactly like the top header stays pinned. Prev/Next/number
  buttons remain clickable while pinned.
- [ ] **Full-bleed footer look** — the pinned bar has a **top border + slightly translucent card
  background (blur)** that spans **edge-to-edge** (wider than the table card, to the viewport gutters),
  reading as an app footer bar — not a panel floating inside the content column. Table rows behind it
  are obscured, not bleeding through.
- [ ] **Rests naturally at the end** — scrolling to the **last page / bottom of the list** the bar
  settles at its natural position (no longer overlapping rows); a short list (≤25 tickets, one page,
  no Prev/Next) shows the same bar at the bottom with just the count — no errors, no layout jump.
- [ ] **Stacking is correct** — the pager (`z-30`) never overlaps the top header (`z-40`); the **Columns**
  popover and filter-chip popovers (Radix portals) still open **above** the pinned pager; the row-click
  → ticket navigation and the per-page buttons are unaffected.
- [ ] **Don't regress the scroll container** — the freeze depends on the **window** being the scroll
  container (`globals.css` keeps `overflow-x-clip`, not `hidden`, on html/body) and the table sitting
  **above** the pager in the same `space-y-4` containing block. Do NOT wrap the queue in an
  `overflow-auto`/`-hidden` ancestor or move the pager out of that block — either silently breaks the
  sticky.
- [ ] **Build/typecheck** — `tsc --noEmit` clean; clean `next build` compiles the
  `…/p/[projectKey]` route (CSS-class-only change).

### Tickets — Frozen (sticky) queue toolbar (added 2026-06-23)

The agent queue **toolbar** (the title/search/Columns/**New ticket** row + the `FilterBar` row at the
top of `components/tickets/ticket-queue.tsx`) is now **frozen below the workspace header** so it stays
visible while a long ticket list scrolls behind it — the top-of-page counterpart to the frozen pager.
The two rows were wrapped in one `<div>` with `sticky top-14 z-30` (`top-14` = flush under the 56px
`h-14` `WorkspaceHeader`) + a full-bleed band (`border-b bg-card/95 backdrop-blur
supports-[backdrop-filter]:bg-card/80`, negative gutters `-mx-3 px-3 py-3 sm:-mx-6 sm:px-6 lg:-mx-8
lg:px-8`, inner `space-y-3`). CSS/markup-only change — no JS/logic touched.

- [ ] **Toolbar stays visible while scrolling** — at `/agent/w/IT/p/ITINC` with >25 tickets, scroll the
  table down: the project title + Search + Columns + **New ticket** row and the filter-chip row **stay
  pinned just under the top workspace header** (do not scroll away). The table column-header row
  (`ID/Summary/…`) is **not** sticky — it scrolls up under the toolbar (only the highlighted toolbar
  panel was frozen, by request).
- [ ] **Parks flush under the header, no gap/overlap** — pinned, the toolbar sits **immediately below**
  the 56px header with no visible gap and without the header ever overlapping it. At scroll-top it rests
  at its natural spot (one main `py-6` below the header).
- [ ] **Full-bleed band look** — the band has a **bottom border + translucent card background (blur)**
  spanning **edge-to-edge** to the viewport gutters (like the header/footer bars), not a panel floating
  inside the content column. Table rows scrolling behind it are obscured, not bleeding through.
- [ ] **Stacking is correct** — the toolbar (`z-30`) slides **under** the header (`z-40`) and sits
  **above** table rows; the **Columns** popover, the saved-views menu, the filter-chip popovers, and the
  **+ Add filter** picker (all Radix portals) still open **above** the pinned band (the `backdrop-blur`
  stacking context does not clip them). Search input, **New ticket**, **Save view**, **Clear all** all
  still work while pinned.
- [ ] **Don't regress the scroll container** — same dependency as the pager: the **window** is the scroll
  container (`globals.css` keeps `overflow-x-clip`, not `hidden`) and the toolbar is the **first** child
  of the queue's `space-y-4` block. Do NOT wrap the queue in an `overflow-auto`/`-hidden` ancestor or
  move the toolbar out of that block — either silently breaks the sticky. If the header height changes
  from `h-14`, update `top-14` to match (otherwise a gap or overlap appears).

### Settings — Routing tab: assignment-group whitelist + routing rules (added 2026-06-23)

New project Settings → **Routing** tab (`components/settings/routing-editor.tsx`, 9th tab). Two
independently-gated sections: the **assignment-group whitelist** (writes ride `itsm.projects:update`,
new `Project.allowed_group_ids` JSON column, migration `itsm_projects/0005`) and the **routing-rule
editor** (writes ride `itsm.groups:update`, `routingRulesApi` → `/routing-rules`). The routing engine
(`apps.itsm_groups.services.resolve_group_and_assignee`) now matches custom-field conditions; the
whitelist is enforced by `ticket_service.ensure_group_allowed`.

**Assignment-group whitelist**
- [ ] **Default is all-allowed** — a fresh project has `allowed_group_ids == []`; the Routing tab shows
  "Restrict to selected groups" **unchecked** and every helpdesk/shared group is selectable on the
  create form group picker + detail **Assigned Group** select (nothing filtered).
- [ ] **Restrict + save** — tick "Restrict to selected groups", check a subset, **Save assignment
  groups** → the create-form group picker and the detail `GroupSelect` now list only the chosen groups.
  The project **default group** is always shown checked + disabled ("Default · always allowed") and is
  folded into the saved list server-side. Saving an empty restricted set is blocked with a toast.
- [ ] **Backend enforcement (400)** — with a whitelist set, `POST /tickets/` (create), inline
  `PATCH /tickets/{id}/` (group change), the `assign` action, and bulk-assign all **reject a
  non-whitelisted group** with 400 ("This group is not allowed for this project"); the default group and
  any whitelisted group pass; clearing the group (null) always works. Empty whitelist ⇒ no restriction.
  (Covered by `apps.itsm_groups.tests.GroupWhitelistTests` + `AllowedGroupIdsSerializerTests`.)
- [ ] **Existing assignment never drops out** — a ticket already on a now-non-whitelisted group still
  shows that group in the detail picker (`allowedGroupsForProject` keeps `default_group` + the ticket's
  current group); only **new** selections are constrained.
- [ ] **Validation** — `validate_allowed_group_ids` strips non-UUIDs, dups, and ids not in this
  project's helpdesk or a shared/global team; a shared (null-helpdesk) group is accepted.

**Routing rules**
- [ ] **Create a rule** — **New rule** → name + one or more conditions (field / `is`·`is not` / value)
  + **Match all/any** + **Route to group** (+ optional technician). Field choices = **Priority**,
  **Type**, and the project's value-backed custom fields (e.g. a "Location" dropdown); option fields
  show a value dropdown, text/number fields a free input. Saves to `match_spec` as
  `{match, conditions:[{field,operator,value}]}`.
- [ ] **Custom-field routing works** — create a "Location" dropdown field (Fields tab) + an "IT Delhi"
  group, then a rule **Location is Delhi → IT Delhi**. Creating a ticket with **no group chosen** and
  Location=Delhi lands it on IT Delhi; Location=other (or no match) falls back to the project default
  group. (Covered by `CreateTimeRoutingTests`.)
- [ ] **Explicit group wins** — a ticket created **with** a group selected keeps it; routing does NOT
  override an explicitly-chosen group/assignee (`create_ticket` routes only when both are unset). This
  is the behavioural change from "routed whenever assignee is None".
- [ ] **Order / match modes / toggle** — rules evaluate by ascending `priority` (reorder ▲▼), **first
  match wins**; **Match all** requires every condition, **Match any** needs one; the per-row active
  checkbox toggles `is_active` (inactive rules are skipped); legacy flat `{ticket_type, priority}`
  specs still match. (Covered by `RoutingResolverTests`.)
- [ ] **RBAC** — the whitelist section disables for a user without `itsm.projects:update`; the rules
  section disables for a user without `itsm.groups:update`; forged writes 403 server-side.
- [ ] **React stability** — `RoutingEditor`, `RoutingRuleDialog`, `ConditionRow` are module-top-level
  (no nesting in another component's body). `tsc --noEmit` clean; `manage.py check` +
  `makemigrations --check` clean; `apps.itsm_groups` suite passes (15 tests).
- [ ] **Build/typecheck** — `tsc --noEmit` clean (verified); clean `next build` compiles the
  `…/p/[projectKey]` route (CSS/markup-only change).

### Tickets — Queue remembers the last-used filters (added 2026-06-23)

The agent queue (`components/tickets/ticket-queue.tsx`) used to **reset to the default view** when you
opened a ticket and came back. It hydrates filters **only from the URL**, but the detail **Back to
queue** link (`ticket-detail.tsx` → `href={base}`) and the row navigation drop the query string, so a
param-less return re-ran default-view resolution. The fix mirrors the active query string
(`q`/`search`/`ordering`/`page`/`view`) to **`sessionStorage`** (`itsm:queue:<project.id>`) and restores
it on a fresh, param-less visit — a new top precedence tier above the personal/project/product defaults.

- [ ] **Back to queue retains filters** — apply a filter/view (e.g. star **My open** or set
  Assignee=me + Status in To Do/In Progress, sort by Priority, go to page 2), open a ticket, then click
  the detail **Back to queue** link. The queue returns with the **same filters, view, sort, and page**
  (not the default "Open"/"All"). The URL also re-shows the params (`?q=…&view=…`), so it stays
  shareable. (This is the originally-reported bug — the `href={base}` link drops the params, so only
  `sessionStorage` restore makes it work; the browser **Back** path is covered in the next section.)
- [ ] **Re-clicking the project in nav retains filters** — within the same tab, navigate away (Home /
  another project) and back to the project queue via the nav/Create menu (a param-less `base`); the last
  filters are restored, not the default view.
- [ ] **Cleared filters stay cleared** — switch to **All tickets** / clear all, open a ticket, return:
  the queue shows All tickets, it does **not** snap back to the personal/project default (an empty stored
  state is honoured as an explicit choice, not "no preference").
- [ ] **Fresh session still defaults** — opening the queue in a **new tab / new browser session** (no
  `sessionStorage` yet) lands on the normal default-view resolution (personal → project → `open` → All),
  with no flash of "All tickets" (the `ready` gate holds the first fetch until restore/resolution).
- [ ] **Deep link wins + becomes last-used** — opening `…/p/ITINC?view=all` (or a `?q=` spec) loads
  exactly that (resolution skipped); it is then persisted as the new last-used for the session.
- [ ] **Degrades safely** — with `sessionStorage` unavailable/full (private mode quota), the helper
  swallows the error and the queue falls back to default resolution (URL stays the source of truth); no
  crash.
- [ ] **Build/typecheck** — `tsc --noEmit` clean; clean `next build` compiles the queue route.

### Tickets — Whole-row click opens the ticket (added 2026-06-23)

The agent queue table (`components/tickets/ticket-queue.tsx`) opens the ticket on a click **anywhere in
the row**, not just the ID/Summary links. Each `<TableRow>` (already `cursor-pointer`) gained an `onClick`
delegating to the module-level `openTicketFromRow(e, open)`, where `open` does
`router.push("${base}/${ticket_number}")`.

- [ ] **Row click navigates** — at `/agent/w/IT/p/ITINC` a left-click on any cell that is **not** a link
  (Status, Priority, Requestor, Assignee, Group, an SLA bar, Created, or the empty gutter) opens that
  ticket's detail (`…/p/ITINC/<ticket_number>`). Clicking the **ID** or **Summary** link still opens the
  same ticket — once, not twice (the handler bails when the target is inside an `<a>`).
- [ ] **New-tab / select preserved** — **Ctrl/Cmd+click** (or middle-click) on the ID/Summary link still
  opens the ticket in a **new tab**; a modified click anywhere else in the row does **not** hijack to a
  same-tab nav (the handler bails on `metaKey/ctrlKey/shiftKey/altKey` and on `button !== 0`). Dragging to
  select text in a cell with a modifier is unaffected.
- [ ] **Keyboard/AT unchanged** — the row is **not** a tab stop; keyboard and screen-reader users still
  reach each ticket via the in-row **ID/Summary `<a>` anchors** (Tab → Enter). No redundant/confusing
  second focus target was added (WCAG 2.2: the real control stays the link; row click is a mouse
  enhancement).
- [ ] **Returning restores filters** — clicking a row then using browser **Back** lands on the queue with
  the **same filters/view/page** (the URL-sync effect persisted them to `sessionStorage` before the nav —
  unchanged by this change).
- [ ] **React stability** — `openTicketFromRow` is module-top-level (stable reference); no component is
  defined inside `TicketQueue`'s body. `tsc --noEmit` clean; clean `next build` compiles the queue route.

### Reporting — Rows console: per-report date range + 6-month cap + export fix (added 2026-06-24)

The agent workspace **Reports** tab was rebuilt from a category card-catalog into a "traditional"
**one-row-per-report table** (`…/agent/w/[hd]/reports/page.tsx`). Each row owns its **Project**
(default All), a **From–To date range** (default = current month, 1st→today; capped 6 months), a
**Download** dropdown (Excel/CSV), and a **Generate Report** action (opens the detail table). Backend:
trend reports honour the explicit range, `date_to` is day-inclusive, a 6-month cap returns 400, and a
pre-existing `?format=` export 404 is fixed. Range helpers live in `components/reports/catalog.ts`
(`MAX_RANGE_MONTHS`, `currentMonthRange`, `maxToDate`, `rangeError`, `buildRangeScope`).

**Console layout (one row per report)**
- [ ] **Every standard report is one table row** — Report (title + description + muted category tag),
  Project select (default **All projects**), Date range (two `<input type="date">`, From–To), a
  **Download** dropdown (Excel `.xlsx` / CSV `.csv`), and a **Generate Report** button. No category
  cards, no charts.
- [ ] **Defaults** — each row starts at **All projects** + **current month** (From = 1st of this month,
  To = today). Rows are independent: editing one row's project/dates never changes another's.
- [ ] **Generate Report** opens `…/reports/<key>?project=&from=&to=` (the detail table), scoped to that
  row's selection. **Download** saves the file directly (`reportsApi.exportOne` → `itsmClient.download`).
- [ ] **Export all (Excel)** (top button) still emits the combined workbook, scoped to **all projects ·
  current month** (tooltip says so); rejects nothing client-side.

**6-month cap (client + server)**
- [ ] **Client guard** — a range > 6 months (or reversed) shows a **red per-row error** and disables
  that row's Download + Generate (and the detail page's Excel/CSV). The To input's `max` is
  `addMonths(from, 6)`. Helper text states the cap + "download a year in two parts".
- [ ] **Server guard** — `GET reports/<name>/?date_from=2025-01-01&date_to=2026-01-01` → **400**;
  reversed bounds → 400; a ≤6-month range → 200; an open-ended `?days=365` (dashboard) → **200** (the
  cap only fires when BOTH bounds are present). Same cap on `…/export/`.
- [ ] **`days` is validated** — `?days=abc` → **400** (not an unhandled 500), `?days=-5` → 400. A lone
  `date_to` (no `date_from`) anchors the trend window on the end date (`end − days`), never a silent
  empty `start > end` window. (Covered: `test_malformed_days_is_400`, `test_negative_days_is_400`,
  `test_window_lone_date_to_anchors_on_end`.)

**Date semantics**
- [ ] **`to` day inclusive** — a ticket created on the `to` date is counted (`__date__lte`), not dropped
  by a midnight-truncating `created_at__lte`. (Covered: `ReportDateWindowServiceTests.test_to_day_is_inclusive`.)
- [ ] **Trend reports honour the range** — `created-vs-resolved`/`volume-trends`/`resolution-trends` use
  the explicit From–To when given, else fall back to `days` back from today. The **dashboard**
  (period-over-period, `days`-only, no `date_to`) is unaffected.
- [ ] **SLA-compliance + breach-list respect the range** — `sla-compliance` over `ticket__created_at`;
  `sla-breach-list` over `breached_at` (both `__date` inclusive).

**Export 404 regression (pre-existing, now fixed)**
- [ ] **Download returns a file, not 404** — `GET reports/by-status/export/?format=xlsx` (and `=csv`)
  returns the file with an `attachment` `Content-Disposition`. (Without the `ReportContentNegotiation`
  + `renderer_classes=[JSONRenderer]` fix, DRF's `URL_FORMAT_OVERRIDE` 404'd it before the view ran.)
  Covered: `ReportRangeGuardViewTests.test_export_single_returns_file_not_404`, `test_export_all_returns_workbook`.
- [ ] **JSON endpoints unaffected** — `GET reports/` and `GET reports/<name>/` still return JSON; a 400
  error renders as JSON (not a broken binary). Helpdesk scoping (`?helpdesk`/`?project`) still clamps.

**Build/tests**
- [ ] `tsc --noEmit` clean; clean `next build` compiles `…/reports` + `…/reports/[reportType]`.
- [ ] `apps.itsm_reporting` suite (**14 tests**) passes; `manage.py check` + `makemigrations --check`
  clean (no model change); `itsm_tickets`/`itsm_helpdesks`/`itsm_dashboards` suites unaffected.
- [ ] **React stability** — the console renders per-row controls as inline JSX (no component defined
  inside the page body); `report-filters.tsx` is module-top-level.

### Knowledge Base — agent authoring UI ("Knowledge Base Mgmt") (added 2026-06-24)

Frontend-only (backend authoring CRUD already existed; the one backend tweak is `helpdesk` added to
`ArticleListSerializer`). New `/agent/kb/**` routes + `components/kb/*`, gated by `useCanAuthorKb`
(`lib/itsm/kb-perms.ts`). Reuses the shared `RichTextEditor` (no inline images). New `itsm-knowledge`
skill created — see it for the contract.

**Entry + gating**
- [ ] **Home section** — the agent Home shows a **Knowledge Base Mgmt** section (after "Select
  Helpdesk") for admin/agent/lead, with a tile per `user.helpdesks` + an **Organisation-wide** tile. A
  pure **requestor** never reaches `/agent/kb` (AgentGuard → portal); `kb/layout` also redirects anyone
  without authoring perm back to the agent Home.
- [ ] **Delete is supervisor-only** — an **agent** sees no Delete button on articles/categories; a
  **supervisor** does, and delete soft-deletes. (Verified: agent has `itsm.knowledge:create/update` but
  not `delete`.)

**Authoring (verified via rolled-back agent API calls)**
- [ ] **Create draft** — a new article saves as **draft** (absent from `/portal/kb`), `helpdesk` set
  from the route (null for the Org-wide tile).
- [ ] **Publish / Unpublish** — Publish → **published** (+ `published_at`); the Portal-visible article
  appears in `/portal/kb` and renders. Unpublish → draft (drops from the portal).
- [ ] **Internal stays internal** — an `internal` article never appears in the portal browse (filters
  `status=published, visibility=portal`), only in the agent list.
- [ ] **Slug auto + collision** — slug auto-derives from the title; two same-titled articles both save
  (second retries with a random suffix) rather than an unhandled 400.
- [ ] **Categories** — parent + child (one level) render indented and are selectable as an article's
  category; an **org-wide** category (under `_org`) is selectable from a helpdesk article.
- [ ] **Org-wide scope** — the `_org` tile lists only `helpdesk == null` articles/categories
  (client-filtered using the new `helpdesk` field on the list serializer).

**Build**
- [ ] `tsc --noEmit` clean; `next build` compiles `agent/kb/**`; `manage.py check` +
  `makemigrations --check` clean (serializer field, not a model change).

### Service Portal — "Create Request" intake (workspace → project → form) (added 2026-06-24)

End-user self-service intake (Request Catalog deferred). New `PortalRequestIntakeViewSet`
(`portal/request-intake`, module `itsm.portal.tickets`): `workspaces`/`projects`/`layout` GETs +
`create` POST + ownership-scoped `attachments`. Frontend routes under
`portal/create-request/[helpdeskKey]/[projectKey]`, reusing the agent form's exported `FieldControl`.

**Flow (as a requestor — role `requestor`, no helpdesk membership)**
- [ ] Portal Home + nav show **Create Request** (Request Catalog removed); the catalog routes still
  exist but are unlinked.
- [ ] **Workspaces** — `/portal/create-request` lists active helpdesks that have ≥1 create-eligible
  project. A requestor with no membership still sees them (portal clamp, not membership scope).
- [ ] **Projects** — selecting a workspace lists its active projects (each with ≥1 ticket type);
  dead-end projects (no ticket type) are omitted.
- [ ] **Form == project layout** — the form renders the project's configured layout (sections, regions,
  required, visibility rules) — the **same** layout configured in project settings — minus
  assignment/user-picker fields. A project with no layout falls back to Summary + Description.
- [ ] **Confirmation** — submit shows "Request <ticket_number> submitted" with **Go to Home**, **Create
  new ticket** (resets to a fresh form), and **Track this request** (opens `/portal/requests/<number>`,
  the requestor's own ticket).

**Single-option auto-skip (added 2026-06-28)** — pickers with exactly one choice are skipped (no flash)
- [ ] **One helpdesk + one project** — "Create Request" lands **directly on the form** (no workspace or
  project picker). Browser **Back** → portal Home; the in-page **Back** link also → Home (no bounce).
- [ ] **One helpdesk + multiple projects** — skips the workspace step → **project picker**; its back
  control reads **Home** and returns to portal Home (not a bouncing "All workspaces").
- [ ] **Multiple helpdesks** — workspace picker shows as before. Pick a helpdesk with a **single**
  project → form, in-page **Back** → workspace picker (not a bounce); pick one with **multiple**
  projects → project picker, **Back** → workspace picker.
- [ ] **No flash / no loop** — the single-card list never flashes before the redirect (spinner stays);
  repeatedly pressing the in-page Back from an auto-skipped form never ping-pongs back to the form.
- [ ] **0 workspaces / 0 projects** — empty-state messages still show (no redirect).

**Backend correctness / security (verified via rolled-back `authenticate`d create)**
- [ ] **Created ticket is portal-sourced + owned** — `source="portal"`, `requestor == request.user`;
  assignment falls to routing / project default group (never client-set).
- [ ] **Spoofing blocked** — client-supplied `assignee`/`assigned_group`/`source`/`requestor` are
  ignored (a `maps_to` of those is dropped); posting to an inactive/foreign or no-ticket-type project →
  400; a `helpdesk` that doesn't own the project → 400.
- [ ] **Required-field validation** — omitting a mandatory layout field → 400 with `{field_key:[msg]}`;
  a mandatory **option** field with no configured options is skipped (no config-gap deadlock), matching
  the create form. Empty summary → 400.
- [ ] **Requestor reaches only portal endpoints** — the browser network tab shows
  `/portal/request-intake/*` only; no requestor call hits `/helpdesks/`, `/projects/`,
  `/field-layouts/resolve/`, `/fields/`, or `/tickets/` (those would 403).
- [ ] **Attachments** — if the layout has an attachment field, files upload via
  `POST /portal/request-intake/<number>/attachments/` (ownership-checked, 10 MB cap); uploading to
  someone else's ticket → 404.

**Regression / build**
- [ ] Agent create flow unchanged after exporting `FieldControl` & helpers from `ticket-create-form.tsx`
  (create a ticket as an agent — assignment/group/user-picker fields still work).
- [ ] `tsc --noEmit` clean; `manage.py check` clean; `makemigrations --check` clean (no model change —
  the only `validate_required` edit is logic, no schema). `apps.itsm_tickets` suite unaffected.

### Agent Home — Service Portal entry (added 2026-06-24)

Agents are employees too: an IT-only agent must be able to raise a request in a helpdesk they
don't staff (e.g. HR salary issue) **as a requestor**. Frontend-only change — a permission-gated
"Service Portal" card on the agent home right rail (`(agent)/agent/page.tsx`), above "Needs your
attention", linking to `portalHome(org)`. Gated on `hasPerm("itsm.portal.tickets", "create")`.
(Backend already supports the flow: portal intake is not membership-scoped and forces
`requestor=self`/`source="portal"`; `PortalGuard` admits agents.)

- [ ] **Card visible with portal grant** — an agent whose role has `itsm.portal.tickets:create`
  (and superusers) sees the **Service Portal** card on agent home, in the right column above
  "Needs your attention".
- [ ] **Card hidden without grant** — an agent whose role lacks the portal grant does **not** see the
  card (no dead link to a 403 portal).
- [ ] **End-to-end** — IT-only agent clicks the card → `/portal` → Create Request → picks **HR** →
  submits → 201 + ticket number; the ticket appears in portal **My Requests** (`requestor=self`) but
  **not** in the agent's IT queue (membership scope intact); only public comments are visible.
- [ ] `tsc --noEmit` clean (new `LifeBuoy` import + `portalHome` resolve).

### Auth — Case-insensitive login (email/username) (added 2026-06-24)

Login was case-sensitive (simplejwt → Django default `ModelBackend`). Fixed globally with
`apps.accounts.backends.CaseInsensitiveModelBackend` (first in `settings.AUTHENTICATION_BACKENDS`):
exact username → `username__iexact` → `email__iexact`. No data migration; multi-tenant safe.

- [ ] **Mixed-case email logs in** — a user stored as `shekhar@ticket.com` signs in with
  `Shekhar@ticket.com` / `SHEKHAR@TICKET.COM` at `POST /api/v1/itsm/auth/login` and gets
  `{access, refresh, user}`. (Verified via a rolled-back `authenticate()` round-trip: lower/mixed/upper
  all return the user.)
- [ ] **Wrong password still 401** — a correct (any-case) login with a bad password fails; an unknown
  user fails. The hasher runs once on a miss (no user-enumeration timing leak).
- [ ] **Email fallback** — when the username differs from the email, signing in with the (any-case)
  **email** resolves the account (`email__iexact`).
- [ ] **All three entry points** — ITSM JWT login, platform-admin JWT login, and the legacy session
  `/api/v1/auth/login` all accept mixed case (the one backend covers them).
- [ ] **Multi-tenant safe** — the lookup runs in the request's active schema; a case-insensitive match
  never crosses orgs.
- [ ] **No regression** — `manage.py check` clean; existing auth/login still works for exact-case
  credentials; `makemigrations --check` clean (no model change).

### Reporting — "Ticket Data" raw export (all fields incl. system + SLA + custom) (added 2026-06-24)

A new flat per-ticket report **`ticket-data`** sits **first** in the reports catalog (`STANDARD_REPORTS[0]`).
`reports.ticket_data(**f)` reuses `_base` and returns a **column manifest** `{columns:[{key,label,type}],
rows:[{key:value}], truncated:bool}`; columns are dynamic (standard + system/timeline → present SLA-metric
kinds → custom fields). `export._section` and the detail page render straight from the manifest. Capped at
5000 rows. No model change, no migration.

- [ ] **Report appears first** — the Reports console lists **Ticket Data** as the top row; **Generate
  Report** opens a wide table with every column; **Download** Excel + CSV both return a file.
- [ ] **All fields present** — a row carries standard fields (Ticket #, Summary, Status, Priority, Team,
  Assignee, Requestor, Source…), **system/timeline** (Created/Updated/Resolved/Closed/Due, Deleted,
  Reopen count) and **SLA** columns for every metric kind present (state/due/breached/breached at/target).
  Spot-check one ticket's values against its detail view.
- [ ] **Custom fields included** — with a single **Project** selected, all that project's (+ global)
  defined custom fields show as columns (label = field display name) even when empty; with **All projects**,
  only fields that carry a value somewhere appear. Multi-value fields render comma-joined. (Confirmed live:
  608 tickets → 44 dynamic columns incl. `Category`/`Location`/`Mode`.)
- [ ] **Screen == file** — the on-screen columns match the xlsx sheet and the CSV header (both go through
  the same `columns` manifest via `_section`). Datetimes render formatted on screen; raw ISO in the file.
- [ ] **Helpdesk + range scoping (Guard 5)** — the raw report is clamped to accessible helpdesks like every
  other report (`_base` `helpdesk_ids`); `?project=` cross-helpdesk → 403; the 6-month range cap still
  applies. A non-member never sees another helpdesk's tickets in the dump.
- [ ] **No N+1 / bounded** — SLA trackers + custom `FieldValue`s are batch-fetched per result set; >5000
  matching tickets sets `truncated:true` and the detail page shows a "narrow the range" note (file is
  likewise capped). Combined **Export all** includes a `Ticket Data` sheet.
- [ ] **Build/tests** — `tsc --noEmit` clean; `next build` compiles `…/reports/[reportType]`;
  `manage.py check` + `makemigrations --check` clean; `apps.itsm_reporting` suite unaffected.

### Tickets — People show email beside the name (added 2026-06-24)

Every ticket-embedded user now carries `email` (the shared `UserBriefField`), surfaced beside the name.

- [ ] **One serializer, everywhere** — `UserBriefField` returns `{id, username, full_name, email}`;
  requestor/assignee/created_by/updated_by, comment author, watcher, and audit actor all gain `email`
  with no per-serializer change. No migration (`email` is on `accounts.User`).
- [ ] **Detail People panel** — open a ticket: Requestor shows name + muted email under it; Assignee
  likewise (falls back to "Unassigned" when none). Created-by / Updated-by meta rows show the email too.
- [ ] **Queue columns** — Requestor / Assignee / Created-by / Updated-by cells show name + muted email
  second line (shared `person()` helper); the Assignee cell still falls back to the group/"Unassigned"
  when there's no assignee.
- [ ] **Pickers** — `InlineUserPicker` (requestor/assignee inline edit) and `UserSearchCombobox` show the
  email in the selected value + each result row (the `/users/?search=` endpoint already returned it).
- [ ] **Blank email is name-only** — a system/non-login user with no email (e.g. `email-bot`) renders just
  the name, no empty parenthetical/line.
- [ ] **Build** — `tsc --noEmit` clean; `next build` compiles; `apps.itsm_tickets` suite unaffected
  (UserBrief gains a key; existing assertions on `full_name`/`username` still hold).

### Tickets — Assigned-Technician picker shows a Lead badge (added 2026-06-24)

`group-member-picker.tsx` is now a Popover dropdown (was a native `<select>`) so leads can show a badge.

- [ ] **Group-dependent** — with no Assigned Group the picker shows "Set a group first"; choosing a group
  populates the list from `GET /groups/{id}/members/`; changing the group reloads the candidates.
- [ ] **Leads first + badge** — the dropdown lists the group's active members with leads at the top, each
  lead carrying a small **Lead** badge (not "(lead)" text); members show name + `@username`.
- [ ] **Trigger reflects selection** — the closed trigger shows the selected technician (+ Lead badge when
  a lead, + muted email), "Unassigned" when none, and "(not in group)" for a stale assignee who left the
  group (still selectable/visible).
- [ ] **Contract preserved** — selecting saves the integer User PK exactly as before (detail inline edit
  `PATCH /tickets/{id}/` assignee; create-form payload); "Unassigned" clears; the strict
  assignee-in-group enforcement (`ensure_assignee_in_group`) is unchanged.
- [ ] **Focus stable** — selection is click-based (no native-select focus loss); the component is
  module-top-level; both call sites (detail + create) render correctly (create passes the wider
  `selectCls` trigger width).
- [ ] **Build** — `tsc --noEmit` clean; `next build` compiles. No backend change.

### User Mgmt — Active-only helpdesks + requestors hold no membership (added 2026-06-24)

- [ ] **Active-only picker** — the Add-user dialog + Helpdesks sheet list only `status==="active"`
  helpdesks (an inactive/archived helpdesk that a manager can still see in admin is **not** offered for
  assignment).
- [ ] **Requestor blocked in UI** — selecting role **Requestor** in Add-user hides the helpdesk picker
  (shows a note) and clears any prior selection; opening the Helpdesks sheet for a requestor shows an
  explanatory message instead of the assignable list.
- [ ] **Requestor blocked server-side** — a forged `POST helpdesks/{id}/add_member` for a requestor → 400;
  `POST members/create_user` with `role_code="requestor"` + `helpdesks` → 400; `add_member` to an inactive
  helpdesk → 400.
- [ ] **Demotion strips access** — changing an agent/lead with helpdesks to **Requestor** prompts a confirm,
  then (server `set_role`) deactivates their `HelpdeskMembership` + `ProjectMembership` rows; the roster
  refetches so the Helpdesks column shows "None", and their Home/tabs disappear on next `auth/me`.
- [ ] **Unassigned user still enrollable** — a user with **no** ITSM role (not a requestor) can still be
  added to a helpdesk (the guard keys off the exact `requestor` role, not "no role").
- [ ] **Build/tests** — `tsc --noEmit` clean; `manage.py check` clean; `apps.itsm_helpdesks` /
  `apps.itsm_rbac` suites pass.

### Projects — Per-user project assignment (strict-whitelist, hard boundary) (added 2026-06-24)

New `ProjectMembership` gates which project tabs/tickets/reports a user sees. `accessible_project_ids`
(superuser/`itsm.projects:update` ⇒ unrestricted; else: lead-helpdesk ⇒ all, member-helpdesk ⇒ assigned
only, plus projects you `lead`). Apply the project clamp at EVERY surface the helpdesk clamp is applied.

- [ ] **Tab visibility** — assign a user to Helpdesk IT but only project **ITINC** → only the ITINC tab
  shows (Dashboard/Reports still there); ITREQ's tab is absent. The header **Create** menu + dashboard +
  reports project pickers narrow too (all derive from the one scoped `projectsApi.list()`).
- [ ] **Hard boundary by URL** — direct-navigating to ITREQ's queue/new/detail → the project-route
  `layout.tsx` shows "no access"; the **API** returns 404 (ticket list/detail not in `get_queryset`),
  403 (create/links/apply_template via `is_project_accessible`), and empty data (reports default scope,
  dashboard widgets, SLA trackers, bulk-by-ids/by-filter). No surface leaks an unassigned project.
- [ ] **Lead override** — a **helpdesk lead** sees all that helpdesk's active projects regardless of
  `ProjectMembership`; a user set as a project's `lead` always sees that project.
- [ ] **Non-breaking rollout** — after `migrate`, an existing agent's tabs are unchanged (backfill `0007`
  granted every active member all their helpdesk's active projects); `seed_itsm` re-run is idempotent and
  `seed_project_memberships` grants the same for fresh orgs.
- [ ] **Assignment UI** — User Mgmt → Helpdesks & Projects sheet: under each member helpdesk, ticking a
  project calls `projects/{id}/add_member`; unticking → `remove_member`; a **lead** helpdesk shows
  "Leads see every project" (no picker). Add-user dialog collects projects under each selected helpdesk;
  `create_user` rejects a project whose helpdesk isn't also assigned (400) and a requestor with
  projects (400). Assigning a project to a **requestor** via `add_member` → 400.
- [ ] **Inactive projects** — only **active** projects count toward access + appear in pickers; assigning
  is scoped to active projects.
- [ ] **Tests/build** — `apps.itsm_tickets`/`itsm_helpdesks`/`itsm_rbac`/`itsm_projects` suites pass (test
  fixtures that enroll an agent now also grant a `ProjectMembership`); `makemigrations --check` clean
  (only `itsm_projects` `0006`/`0007`); `manage.py check` clean; `seed_itsm` re-runnable; `tsc --noEmit`
  clean; `next build` compiles the new project-route `layout.tsx`.

### Notifications — Branded HTML emails + delivery + role-aware links (added 2026-06-25)

The notification email body is now an HTML alternative wrapped in a trusted branded shell, with a
working role-aware CTA link. Designs ship via `seed_itsm` (overwrite-all backfill).

- [ ] **HTML is actually sent** — trigger an email event (e.g. add a public comment) and flush the
  outbox with `EMAIL_BACKEND=console`: the message is **multipart** — a `text/plain` part **and** a
  `text/html` part (the branded shell). `NotificationOutbox.rendered_html` is populated.
- [ ] **Branded shell** — the HTML shows the "One Helpdesk" header, an event accent colour (blue
  routine / green resolved+closed / amber SLA-warning / red SLA-breach), a ticket-details card
  (only populated rows: Ticket/Status/Priority/Assignee/Group), a "View ticket" button, and a footer.
- [ ] **Role-aware deep link** — the **requestor's** email/CTA links to `/t/{org}/portal/requests/{n}`;
  an **agent** recipient's links to `/t/{org}/agent/w/{helpdesk}/p/{project}/{n}` (org = tenant schema).
  The in-app bell `link` uses the same path (no more dead `/tickets/{n}`).
- [ ] **Subject token preserved** — every event subject keeps the `[{{ ticket.number }}]` prefix so
  itsm_email threads replies back onto the ticket.
- [ ] **Body sanitiser unaffected** — editing a per-project template in the Notifications tab still
  only allows safe markup (the shell chrome is in code, not the DB field); the Preview tab mirrors the
  sent email via `email-shell-preview.tsx`.
- [ ] **Backfill = overwrite-all** — `seed_itsm` runs `backfill_email_templates` (after the per-project
  scheme backfill) which force-updates **all** templates (system + clones) by `event_type`; re-runnable.
- [ ] **Tests/build** — `apps.itsm_notifications` (incl. new `RenderAndDeliveryTests`) + `apps.itsm_email`
  + `apps.itsm_tickets` + `apps.itsm_sla` pass; `makemigrations --check` clean (only `itsm_notifications`
  `0002`); `tsc --noEmit` clean.

### Home declutter + per-helpdesk Canned Responses + Tenant Settings hub (added 2026-06-25)

Reorganised the agent **Home** (it was too noisy): canned responses moved into each helpdesk's
Settings (helpdesk-only + isolated); the KB grid collapsed to a single entry; KB/admin pages gained the
shared app-switcher; and the Home gear now opens a **Tenant Settings** master/detail hub. **No DB model
change** (`makemigrations --check` clean) — canned isolation is a `get_queryset` clamp only.

**Canned Responses — per-helpdesk + isolated** (module `itsm.canned_notes`)
- [ ] **Lives in helpdesk Settings** — `agent/w/[hd]/settings/canned-responses` (left-rail item +
  landing card). The old global `agent/canned-responses` route, `agentCannedResponses` helper, and
  `scope-badge.tsx` are gone; the Home "Canned Responses" card is gone.
- [ ] **Helpdesk-only create** — the dialog has **no** scope/workspace/project picker; every save is
  `scope="workspace"` + `helpdesk=<current>`. The list shows only this helpdesk's notes
  (`cannedNotesApi.list({helpdesk})`).
- [ ] **Server isolation** — `CannedNoteViewSet.get_queryset` clamps shared notes to
  `accessible_helpdesk_ids_cached`: an IT agent sees IT's notes, **not** HR's; org-wide (null-helpdesk)
  shared notes stay visible to all; personal stay owner-only; a forged `?helpdesk=<foreign>` returns
  empty (never widens). Superuser sees all. (Covered by `CannedNoteScopeApiTests` — incl. the new
  `test_helpdesk_shared_note_visible_to_members`, `…_hidden_from_non_member`,
  `test_org_wide_note_visible_to_every_agent`.)
- [ ] **RBAC unchanged** — read gates the list; create/update gate the editor; delete = supervisor (403
  for a plain agent).

**Tenant Settings hub** (the Home gear)
- [ ] **Gear → `/agent/admin`** master/detail: left-rail `tenant-settings-nav.tsx` (Overview · Users +
  Roles & Permissions · Helpdesks, each gated by its module) + landing card grid; the three
  `agent/admin/{users,roles,helpdesks}` pages render inside it (no standalone back-link/title), URLs
  unchanged.
- [ ] **Gear gating widened** — shows for `isSupervisor || itsm.admin.helpdesks:update/create ||
  itsm.admin.roles:read/create/update`; a plain agent never sees it and a direct hit shows the
  per-page read-only/no-access banner.
- [ ] **App-switcher on top** — the minimal bar carries `components/shell/app-switcher.tsx` (Home +
  switch helpdesk) on every non-workspace state **except exact Home**, so KB / Tenant Settings /
  approvals / reports all have a way back Home. The switcher is provider-independent (no
  `useWorkspace`) and is reused by the workspace header.

**Home + KB**
- [ ] **Home is calm** — hero + Helpdesk selector + a single **"Knowledge Base"** card (→ `agentKb`,
  gated `useCanAuthorKb`) + the right rail (Service Portal + "Needs your attention"). No
  Canned/Administration/KB-grid sections.
- [ ] **KB single entry** — the Home KB card opens the index (`agent/kb`), which still shows the
  per-helpdesk + Organisation-wide tiles. Inside KB the app-switcher returns Home / switches helpdesk.

**Build/typecheck**
- [ ] `tsc --noEmit` clean; clean `next build` compiles `agent/admin`, `agent/admin/{users,roles,helpdesks}`
  and `settings/canned-responses`; the global `agent/canned-responses` route is absent.
- [ ] **React stability** — `AppSwitcher`, `TenantSettingsNav`, `CannedNotesAdmin`/`CannedNoteDialog`,
  `EntryCard` are all module-top-level (none defined inside another component's body).

### Tickets/Portal — Watchers, attachments (upload/delete/preview), portal reopen (added 2026-06-25)

Agent detail (`components/tickets/ticket-detail.tsx`) gets Jira-style top-right **watcher** + **attachment**
icon buttons with count badges (opening popovers); the end-user portal detail gets watchers + attachments +
a configurable **Reopen** (`Transition.portal_allowed`). RBAC: agent watcher mgmt under
`itsm.tickets.watchers`; all portal actions under `itsm.portal.tickets` (requestor read+create — **removals
are POST, never DELETE**).

**Agent console (watchers)**
- [ ] **Watcher icon + count badge** renders top-right of the detail header; the count matches
  `GET /tickets/{id}/watchers/`. **Self toggle** — Watch then Unwatch updates the list + badge
  (`/tickets/{id}/watch/` POST/DELETE, self only).
- [ ] **Add anyone** via the `UserSearchCombobox` → `POST /watchers/ {ticket, user_id}` (the serializer's
  write-only `user_id`; the old `user` was read-only and could never create). **Remove** a watcher keys off
  the **watcher row id** (`DELETE /watchers/{id}/`), not the user id.
- [ ] A user **without** `itsm.tickets:update` sees the watcher list read-only (no add/remove, no self toggle).

**Agent console (attachments)**
- [ ] **Attachment icon + count badge** opens a popover with **image previews** (content-type/extension →
  thumbnail linking to the file) and file chips with **Download**.
- [ ] **Upload** from the popover (`POST /ticket-attachments/`, keyed off `t.id` UUID — never the number)
  adds the chip immediately (upload returns the full row). **Delete** asks `window.confirm` then
  `DELETE /ticket-attachments/{id}/`; the read-only `FieldView` attachment list stays in sync (single parent state).

**End-user portal detail (`portal/requests/[id]`)**
- [ ] **Redesigned two-column** layout (`max-w-5xl`); header shows number · helpdesk · type, summary,
  `StatusBadge`, and **Reopen** button(s) top-right; sidebar shows **Attachments** + **Watchers** cards.
- [ ] **Attachments visible** — `retrieve` returns an `attachments` array (absolute `file` URLs via request
  context); image previews + download; **upload** via `request-intake/{number}/attachments/`. **No portal
  delete** (requestor lacks the delete bit).
- [ ] **Watchers by email** — list shows **names only** (never another user's email). Add-by-email does an
  exact `email__iexact` match → 201; an unknown email returns a generic **404** and **creates no user** (no
  directory enumeration); idempotent; **remove via POST** `watchers/remove` (a DELETE would 403).
- [ ] **Reopen** appears only for `portal_allowed` transitions (`GET available-transitions`,
  `portal_only=True`); clicking a `note_prompt` transition opens a small reason dialog, else submits.
  `POST transition` rejects a non-`portal_allowed` transition with **404**, forces a **public** comment,
  and another requestor's ticket 404s. Reopen increments `reopen_count` and moves to `in_progress`.

**Workflow config + seed**
- [ ] Settings → project → **Workflow** → a transition's **Configure** dialog has **Allowed from portal**;
  toggling persists (`PATCH /transitions/` `portal_allowed`) and the row shows a green **`portal`** badge.
- [ ] `seed_itsm` is re-runnable: both **Reopen** transitions (Incident `resolved→in_progress`, Request
  `fulfilled→in_progress`) are `portal_allowed=True` with an **optional** "Reason to reopen" note; no other
  transition is portal-allowed. **Multi-tenant**: migration `0003_transition_portal_allowed` + the reopen
  seed must land in **every** org schema (`onemed`, `acme`), not just `public`.

**Build/migration**
- [ ] `makemigrations --check` clean (only the intended `itsm_workflows/0003`); `manage.py check` clean;
  `tsc --noEmit` clean. `apps.itsm_tickets` adds `PortalAllowedSeedTests`,
  `EngineAvailableTransitionsPortalTests`, `PortalTransitionWatcherAttachmentApiTests`, `AgentWatcherApiTests`.
  *(Pre-existing, unrelated: 3 `itsm_sla.FirstResponseStopTests` fail because SLA trackers start in
  `transaction.on_commit`, which a plain `TestCase` never fires — not caused by this change.)*

### Tickets — Ticket linking ("Linked issues") UI (added 2026-07-02)

The agent ticket detail gains a **Linked issues** details-rail card (`ticket-detail.tsx` →
`LinkedIssuesCard`) to view/add/remove ticket relationships. Backend fills the gaps on the
pre-existing `TicketLink`: audit events, inbound display, and a POST-based remove. Agent console
only (no portal linking). No DB migration (`TicketLink` already existed).

**Linked issues card (agent detail)**
- [ ] **Card renders** in the right details rail (near SLA/Approval) with a **Linked issues** header;
  empty state reads "No linked tickets yet." Links are **grouped by relationship** label
  (Relates to / Blocks / Is blocked by / Duplicates / Is duplicated by / Causes / Is caused by).
- [ ] **Add** — **Link issue** opens a `link_type` `<Select>` + a debounced `TicketSearchCombobox`
  (`GET /tickets/?search=`, helpdesk/project-scoped, current ticket + already-linked excluded).
  Picking a target `POST`s `/tickets/{id}/links/` and the row appears grouped under its relationship.
- [ ] **Incident ↔ Request** — the picker surfaces tickets across projects/types, so an incident can
  link to a request (and vice-versa) with no special handling.
- [ ] **Each row** shows the far ticket's number (mono, links through to **its** detail via
  `other_helpdesk_key`/`other_project_key`), a `StatusBadge`, and a truncated summary (full text on
  hover `title`). Clicking the number navigates to the linked ticket.
- [ ] **Remove** — the row ✕ `POST`s `/tickets/{id}/links/unlink/ {link_id}` and drops the row.
  A user **without** `itsm.tickets:update` sees the card read-only (no Link issue button, no ✕).

**Inverse display (single-row)**
- [ ] Linking A **blocks** B: A's card shows "Blocks → B"; open **B** and its card shows
  "Is blocked by → A" — the **same** single row, `link_type` flipped server-side (no duplicate row).
- [ ] `relates_to` reads "Relates to" on both ends.

**Backend / audit / scoping**
- [ ] Adding a link writes `link_added`; removing writes `link_removed` — both appear in the
  **Activity** tab with friendly verbs ("linked a ticket" / "removed a ticket link"); the tab refetches
  after add/remove. (Ties into **Verb coverage**, this doc.)
- [ ] **Guard 4** — linking to a ticket in a helpdesk you can't access → **403**; self-link or bad
  `link_type` → **400**. The raw `GET /ticket-links/` list is helpdesk-scoped (no foreign-link leak).
- [ ] **Idempotent** — re-linking the same pair/type returns the existing row (no duplicate, one audit
  event); re-linking after a remove resurrects the soft-deleted row.
- [ ] **Removal is POST, not DELETE** — a `DELETE` would 403 agents (no delete bit on
  `itsm.tickets.links`); confirm the ✕ uses `POST .../links/unlink/`.

**Build/migration/tests**
- [ ] `makemigrations --check` clean (**no new migration**); `tsc --noEmit` clean; `next build` compiles
  the ticket-detail route. `apps.itsm_tickets` adds `TicketLinkApiTests` (11 tests: add, inverse GET,
  remove, cross-helpdesk 403, self-link/bad-type 400, audit events, idempotent + resurrect, raw-list
  scope) — full module suite (123 tests) green.
