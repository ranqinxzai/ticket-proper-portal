# Bug Log — Ticketing System

Append-only log of fixed bugs. Newest first. Each entry: date, module, summary, root cause, fix location.

Format:

```
## YYYY-MM-DD — Module — One-line summary

**Symptom:** what the user saw.
**Root cause:** the actual bug.
**Fix:** file:line + what changed.
**QA hook:** which checklist item should have caught it (and now does).
```

---

## 2026-06-25 — Tickets/Portal — Watchers invisible in console; portal removal DELETE would 403

**Symptom:** (ITINC-614) the agent ticket detail showed **no watchers** anywhere — no way to see or manage
them — and attachments were read-only (no upload/delete/preview). The portal detail rendered attachments as
a dash and had no watchers or reopen.
**Root cause:** ① the frontend never had a `watchersApi`, a `Watcher` type, or any watcher UI (the backend
endpoints existed). ② `WatcherSerializer.user` was `read_only`, so `POST /watchers/` could **never** set the
watcher — the "add arbitrary watcher" path was silently unusable. ③ Requestors hold **read+create** (not
delete) on `itsm.portal.tickets`; `HasModulePermission` maps `DELETE→delete`, so a portal watcher/attachment
**DELETE would 403**.
**Fix:** ① new `WatchersPopover`/`AttachmentsPopover` (Jira-style header icons + count badges) in
`components/tickets/ticket-detail.tsx`; `watchersApi` + `ticketsApi.watch/unwatch/watchers` +
`ticketAttachmentsApi.remove` in `lib/itsm/api.ts`. ② `WatcherSerializer` gained a write-only `user_id`
(`source="user"`); FE posts `{ticket, user_id}` (`apps/itsm_tickets/serializers.py`). ③ every portal removal
is a **POST** (`PortalTicketViewSet.watchers/remove`), never DELETE (`apps/itsm_tickets/portal.py`).
**QA hook:** the new "Tickets/Portal — Watchers, attachments (upload/delete/preview), portal reopen" section.

## 2026-06-25 — Email — Reply created a DUPLICATE comment + quoted "On … wrote:" not stripped + busy inbox back-filled

**Symptom:** an email reply to a ticket (ITINC-613) created the **same public comment twice** (95 ms
apart); the Gmail quoted-reply attribution line (`On Thu, 25 Jun 2026 … <a@x>\nwrote:`) was **not
stripped**; and connecting a busy mailbox tried to ingest its entire ~3,600-message history (newest mail
was last in line, hours away).
**Root cause:**
1. **Duplicate comment — TOCTOU race.** `inbound.process_inbound` did `get_or_create(channel,
   message_id)` then `if status in (PROCESSED,IGNORED): return`. Two concurrent pollers (a manual
   *Poll now* racing the 60 s scheduler) both saw `status=RECEIVED` and both ran `_run_pipeline` →
   `add_comment` twice. Idempotency held at the *row* level (one `InboundEmail`) but not the *comment*.
2. **Quote not stripped.** `detectors._QUOTE_MARKERS` matched `^On .+ wrote:$` only on a SINGLE line,
   but Gmail (mobile) wraps `wrote:` onto the next line, so the attribution survived.
3. **Back-fill.** `mailbox._fetch_imap` starts at `UID 1` when `last_seen_uid is None`, fetching 50/poll
   ascending → the whole historical inbox (mostly age-ignored) churns before new mail is reached.
**Fix:**
- `inbound.process_inbound` wraps the pipeline in `transaction.atomic()` + `InboundEmail.objects.
  select_for_update().get(pk)` and re-checks status **under the lock** — the second worker blocks, sees
  the terminal status, and no-ops. Failure path `refresh_from_db()` + bails if a peer already finished.
- `detectors._is_attribution_start` detects the wrapped `On … / wrote:` attribution across up to 3 lines
  (+ `Am … schrieb:`, `Le … a écrit :`), while keeping a real reply that merely *starts* with "On …".
- `poller.poll_channel` sets a **start-from-now** high-water mark via `mailbox.current_max_uid()` on the
  first IMAP poll (`last_seen_uid is None`) and processes nothing — no back-fill; POP3 exempt.
- Existing ITINC-613 duplicate soft-deleted. **50 tests pass.** Deployed (backend + scheduler).
**QA hook:** Email-Channel section — *any inbound choke-point that can run concurrently must lock the
idempotency row and re-check under the lock before side-effects; connecting a mailbox must NOT back-fill
its history.*

---

## 2026-06-25 — Email — OAuth (Google/MS365) unusable on the multi-tenant domain; reworked to per-org apps + tenant-aware callback

**Symptom:** "Connect mailbox" for Google/Microsoft could never complete on `pilot-ticket.onemedai.org`.
Also, the design used a single shared provider app for all orgs — wrong for "each org brings its own app."
**Root cause:**
1. **Callback not tenant-aware.** The redirect URI was a single static `…/api/v1/itsm/email/oauth/callback/`
   (no `/t/<org>/`), so `PathTenantMiddleware` left the request in the **public** schema; `state` carried
   only `{cid}`. `EmailChannel` is a TENANT model → the lookup ran in public and found nothing → token
   exchange failed. The success redirect also targeted `/agent/w/<hd>/…` (no `/t/<org>/`) → 404.
2. **Single shared app.** `client_id/secret/tenant` came from global settings, so every org would have
   shared one app — incompatible with per-org consent.
**Fix:**
- **Per-org app creds on the channel:** new `oauth_client_id`, `oauth_client_secret_enc` (encrypted),
  `oauth_tenant_id` (migration `0002`). `oauth._client(cfg, channel)` / `_tenant(channel)` prefer the
  channel's values; blank ⇒ global settings fallback. Serializer exposes id/tenant (rw) and the secret
  write-only (`has_oauth_client_secret`).
- **Tenant-aware callback:** `_redirect_uri()` builds `{PUBLIC_BASE_URL}/api/v1/t/<org>/itsm/email/oauth/
  callback/` from `connection.schema_name`, so the middleware sets the schema from the path; `state` now
  carries `{cid, org}` and `OAuthCallbackView` sets the schema defensively + redirects to
  `/t/<org>/agent/w/<hd>/settings/email?email_oauth=success|error`.
- **Config:** `PUBLIC_BASE_URL` + `FRONTEND_BASE_URL` set to `https://pilot-ticket.onemedai.org`.
- **Frontend:** Connection tab now has Client ID / Client secret / (MS) Directory tenant inputs, shows the
  exact per-org redirect URI to register, and toasts the `?email_oauth=` result. **44 tests pass.**
- **Verified live:** `GET /api/v1/t/onemed/itsm/email/oauth/callback/` → 302; unknown org → 404.
**QA hook:** Email-Channel section — *OAuth on a path-routed multi-tenant domain needs an org-prefixed
redirect URI so the middleware sets the schema; never assume a static callback can resolve tenant data.*

---

## 2026-06-25 — Email — Inbound channel "built" but never polled (scheduler never booted) + forgeable subject-token threading

**Symptom:** the email-to-ticket channel looked complete (models, OAuth, poll jobs, 35 tests, UI) but
no incoming mail ever became a ticket — it felt "not concrete." Separately, anyone could inject a public
comment / reopen on any ticket by putting `[KEY-N]` in a subject line to a connected mailbox.
**Root cause:**
1. **Poller never ran.** The APScheduler jobs (`email.poll_inbound` / `email.retry_failed_inbound`,
   plus the SLA sweep and notification outbox) boot from each app's `AppConfig.ready()` *only when*
   `settings.RUN_SCHEDULER` is truthy (`core/settings.py:221`, default `"0"`). `RUN_SCHEDULER` was set
   NOWHERE — not in `backend/.env.docker`, `docker-compose.yml`, or `entrypoint.sh` (just
   `exec gunicorn --workers 3`). Proof: live `public.django_apscheduler_djangojob` had **0 rows**
   (jobs register on every boot, so empty = never started). The per-tenant fan-out
   (`for_each_tenant`) was correct but never executed.
2. **Forgeable token threading.** `threading.resolve_thread` honoured a `[KEY-N]` subject / `+KEY-N@`
   plus-address token with NO check that the sender owns the ticket — a stranger's guessable token
   threaded as a **public** comment and could trigger a reopen.
**Fix:**
- **Dedicated scheduler process** so exactly one BackgroundScheduler runs (3 gunicorn workers would
  mean 3): new `ticketpilot-scheduler` service in `docker-compose.yml` runs `manage.py run_scheduler`
  (new command `apps/itsm_core/management/commands/run_scheduler.py`) with `RUN_SCHEDULER=1`; web
  workers keep it OFF. Service waits on a new backend healthcheck (gunicorn binds `:8000` only after
  `migrate_schemas`, so "healthy" == "migrated" — no migration race).
- **Sender-ownership gate** (`apps/itsm_email/services/threading.py`): `_sender_owns_ticket(ticket,
  parsed)` requires the envelope sender to be the requestor or a watcher (by email) before a token
  match (paths B/C) threads; else → new ticket. Header-map (path A) untouched (requires a minted +
  recorded Message-ID). Tests: `test_subject_token_from_stranger_is_new`,
  `test_plus_address_token_from_stranger_is_new`, `test_subject_token_from_watcher_threads`.
- **`ITSM_CREDENTIAL_KEY`** set in `backend/.env.docker` (must precede any stored secret; back it up).
- **`poll_email_once`** now fans out per-org (`--schema=<org>` to target one) and is in
  `SCHEDULER_BLOCKED_COMMANDS`. **38 tests pass.**
- **Still open (Phase B):** OAuth (Google/MS365) unusable on the path-routed domain — callback isn't
  tenant-aware (no `/t/<slug>/`, `state` lacks org slug → token exchange runs in public schema) and
  provider creds unset. Basic IMAP/SMTP works today.
**QA hook:** new checklist item — *any scheduled/background job must actually be booted by a process
that sets `RUN_SCHEDULER=1` (the dedicated scheduler container), and any inbound channel must verify
sender authorization before mutating an existing record.* (See the Email-Channel section below.)

---

## 2026-06-24 — Tickets — Comment-note attachment upload 500'd (ticket number sent where UUID expected)

**Symptom:** on a ticket detail (ITINC-606) attaching a file under a comment/note failed — `POST
/api/v1/t/onemed/itsm/comment-attachments/` returned **500** (toast showed the raw Django 500 HTML).
The Files list also 400'd (`GET ticket-attachments/?ticket=ITINC-606`).
**Root cause:** an identifier mismatch. The whole detail UI uses the **readable `ticket_number`** as the
route token (`ticketId='ITINC-606'`), and `TicketViewSet` resolves it via `TicketNumberLookupMixin`
(number-or-UUID). But the attachment endpoints key off the raw **UUID FK pk**. `ticket-detail.tsx` passed
that number straight through to `commentAttachmentsApi.upload`/`ticketAttachmentsApi.list`. Server-side,
`CommentAttachmentViewSet.create` did `get_object_or_404(Ticket, pk='ITINC-606')` → the UUID column's
`to_python` raised `ValidationError('"ITINC-606" is not a valid UUID')`, which `get_object_or_404` does
*not* catch (only `DoesNotExist`) → unhandled → **500**. (`ticket-create-form.tsx` was unaffected — it
already passed the freshly-created `ticket.id` UUID.) Same class as 2026-06-?? "Bug B" (wrong id type on a
ticket field).
**Fix:**
- Frontend `components/tickets/ticket-detail.tsx` — pass the UUID at all three attachment call sites:
  `ticketAttachmentsApi.list(t.id)` (in `load`), and `commentAttachmentsApi.upload(ticket.id, …)` in
  `handleCommentImage` + `attachFiles` (with `if (!ticket) return` guards; dep `[ticketId]`→`[ticket]`).
- Backend `apps/itsm_tickets/views.py` `CommentAttachmentViewSet.create` — validate the `ticket` token as a
  UUID first; a non-UUID now returns a clean **400** `{ticket:["A valid ticket id is required."]}` instead
  of a 500 (defense-in-depth so no client can ever 500 this endpoint with a bad id).
- Verified in the `onemed` schema via `APIClient`: number→400, UUID→201, garbage→400. `tsc --noEmit` clean.
**QA hook:** "API response shape matches what the frontend expects" + a new rule — *ticket-scoped child
endpoints (`*-attachments`, `?ticket=`) take the UUID pk, not the readable number; only
`TicketNumberLookupMixin` detail routes accept either.* Never let `get_object_or_404(pk=…)` take an
unvalidated client token on a UUID pk (validate or catch → 400, never 500).

## 2026-06-23 — Tickets — Activity feed showed who/when but not *what* changed (ITINC-606)

**Symptom:** on a ticket detail (ITINC-606) the **Activity** tab listed rows like "Shekhar updated a field
· 23 Jun 2026, 23:55" / "Shekhar changed status · …" — the **actor and timestamp** were present but the
**field name and before/after value were missing**, so the feed wasn't a usable audit log.

**Root cause:** two gaps. (1) The renderer (`ticket-detail.tsx` Activity tab) only printed
`actor + ACTION_VERB[action] + when` and **never read `AuditEvent.payload`** — the "what" was on the wire
but dropped on the floor. (2) Some write sites stored payloads that weren't self-describing: `summary_changed`
logged `{}` (empty), and `assigned`/`requestor_changed`/`group_changed` logged only **raw user PKs / group
UUIDs**, which a feed can't resolve to names after the fact. (Status changes and custom `field_changed` rows
already carried readable payloads — `from`/`to` names and `{old,new,name}` — they just weren't rendered.)

**Fix:**
- Frontend `frontend/components/tickets/ticket-detail.tsx`: new module-level `activityVerb` (names the custom
  field for `field_changed`) + `activityDetail` (returns the per-action "old → new" from the payload) +
  `activityValue` (formats bools/arrays/empties) + `PRIORITY_LABEL`; the `<li>` now renders **actor · verb ·
  detail · when**. Extra friendly verbs added to `ACTION_VERB` (SLA/attachment/watcher/link/template).
- Backend `backend/apps/itsm_tickets/services/ticket_service.py`: `_user_label`/`_group_label` helpers; the
  `assigned`/`requestor_changed`/`group_changed` payloads (in `update_ticket` **and** the `assign` action)
  now include `old_label`/`new_label` (display names captured **at change time** — survives later renames),
  and `summary_changed` records `{old, new}` (was `{}`). No model/serializer/migration change.

**QA hook:** *Tickets — Activity feed shows what changed (old → new)* (QA_CHECKLIST, 2026-06-23). Tests:
`TicketInlineEditApiTests` +3 (assignee/group label, summary old/new); `apps.itsm_tickets` suite now **56**.

---

## 2026-06-23 — SLA — "Time to First Response" stayed red "overdue" after the agent replied

**Symptom:** on a ticket detail (ITINC-605) the agent had posted a public reply, yet the SLA panel still
showed **Time to First Response — 12h 0m overdue** in red, as if no response had been registered. Looked
like the reply wasn't stopping the first-response clock.

**Root cause:** display only — the engine was correct. `ticket_service.add_comment` stamps
`first_responded_at` on the first public reply and calls `hooks.sla_stop(ticket, "first_response")`;
`sla_engine.stop()` ended the clock and **froze `stopped_at`**. Because the reply landed ~12 business-hours
past the 4h target, the clock ended **`breached`** (correct ITSM — a missed SLA stays missed; replying late
does not un-breach it). The frozen value was real, but the **frontend rendered a stopped/breached clock
identically to a still-running overdue one**: the detail panel (`sla-panel.tsx`) ignored the tracker
`state` and always printed `remaining()` ("Xh overdue"), and the queue bar (`queue-columns.tsx` `SlaBar`)
treated only `met`/`stopped` — **not `breached`** — as "done", so a breached-stopped clock also fell through
to a live, ever-growing "Xh over".

**Fix (frontend only):**
- `frontend/components/tickets/sla-panel.tsx` — new `statusLabel(e)`: a stopped clock
  (`met`/`breached`/`stopped`) shows its **outcome** ("Met" / "Breached"); only a `running` clock shows the
  live "Xh left" / "Xh overdue" (and `paused` → "Paused").
- `frontend/components/tickets/queue-columns.tsx` — `SlaBar` `done` now includes `breached`, so a
  breached-stopped clock shows "Breached" instead of a live "Xh over".
- No backend change — `countdown_payload` / the list serializer already return `state`.

**QA hook:** "Tickets — Configurable queue columns + SLA bars" already specified the bar shows
"Paused/Met/Breached" — the code never honoured `breached` for the *stopped* case. Added an explicit
"SLA — stopped clocks show outcome, not a live countdown" QA section (below) covering both renderers and the
late-response-breached case.

## 2026-06-23 — Groups — Edit group panel had no way to add agents or multiple leads

**Symptom:** on `…/settings/groups`, opening **Edit group** showed only Name/Key/Type/**Lead**(single)/Description.
The user reported "don't see option to add agents" and wanted to "add multiple leads." Member management
*existed* but lived behind a separate per-row **Members** button (obscured by the open Edit panel), and the
Lead control was a single FK.

**Root cause:** not a bug — a discoverability + capability gap. Adding agents was only reachable via the
standalone `group-members-sheet.tsx`, and the form's single `lead` FK didn't expose the `role_in_group="lead"`
membership that already supports multiple leads. Backend already supported everything (`add_member` upserts a
role, `members` action, writable `lead`) — no API change needed.

**Fix (frontend only):**
- `frontend/components/settings/group-form-sheet.tsx` — folded a **Team** section into the Edit sheet (edit-mode
  only, since memberships need a saved group): a **Leads** multi-select (chips, `role_in_group="lead"`) and an
  **Agents** list (`role_in_group="member"`), both via `UserSearchCombobox` → `add_member`/`remove_member`.
  Team writes are **immediate** (matches the old members sheet); core Save no longer sends `lead`. The single
  `Group.lead` FK is kept in sync as the **primary** = `leads[0]` (badge + "Set primary"; demote/remove the
  primary promotes the next lead, or clears to null) so the group-lead auto-assign strategy is unchanged.
  Create mode is core-only with a hint to reopen and add team.
- `frontend/components/settings/groups-list.tsx` — owned groups a supervisor can manage now show **Edit/Delete**
  only (team lives in Edit); the standalone **Members** button is kept for **Shared/global** teams and read-only
  viewers (`!canManage`), which have no Edit.

**QA hook:** rewrote the *Assigned Groups* checklist (`docs/QA_CHECKLIST.md`) — team-in-Edit, immediate writes,
multiple-leads + primary sync, and Members-button-only-for-shared.

---

## 2026-06-23 — Tickets/Fields — Create form showed a "Type" selector the config no longer represents

**Symptom:** the agent create-ticket page (`…/p/ITINC/new`) rendered a prominent **Type** dropdown
(Incident/Hardware/…) at the top of the form, but **Type is not a field on the Layout designer** and
**ticket-categories are not manageable in project config** (the categories editor was removed
2026-06-22). So the create page surfaced a control the layout config had no representation of — a
config↔create **mismatch**. (Verified against live tenants: a freshly-seeded project's main layout
section is even named `"Ticket details"`, which the create form *separately* suppressed while the
designer showed it — same class of editor↔form divergence.)

**Root cause:** `ticket-create-form.tsx` rendered a standalone `<select id="ticket-type">` from
`project.ticket_types` above the layout panes. It pre-dated the 2026-06-22 decision to drop category
management from config; nothing removed it from the create flow, so the form no longer matched the
(simplified) config surface.

**Fix:** `frontend/components/tickets/ticket-create-form.tsx` — removed the Type `<div>`/`<select>`
block and the `setTicketType` setter. `ticketType` is now a value-only `useState(defaultType?.id ?? "")`
(default = the `is_default` type, else the first) that still feeds `layoutsApi.resolve(...)` and the
create payload's `ticket_type`, so the ticket is correctly typed silently. The submit guard message was
corrected (no picker to "pick" from anymore). The form now renders **exactly** the resolved
`FieldLayout` and nothing else. `TicketType` stays load-bearing for the queue Type filter + detail Type
row (unchanged). `tsc --noEmit` + clean `next build` pass.

**QA hook:** new *Tickets — Create form matches the layout config (Type removed)* section in
`docs/QA_CHECKLIST.md`.

---

## 2026-06-23 — Tickets/Fields — Rich-text (RTE) field had no formatting controls in the UI

**Symptom:** on a `richtext` field (the ticket Description, and any custom rich-text field) the create
form and the detail editor rendered a **plain `<textarea>`** — no bold/italic/list/heading toolbar, no
way to format the body. The user reported "even if you use RTE field the formatting option is missing
in UI." (The standard field catalog seeds Description as `richtext`.)

**Root cause:** the layout-driven form treated `richtext` identically to `multiline` (`case "multiline":
case "richtext": → textarea`) — the TipTap editor was always a documented fast-follow that never landed.
TipTap (`@tiptap/react` + StarterKit + underline/link/placeholder) was already a dependency but **unused**
anywhere. Compounding it, the repo ships **no `@tailwindcss/typography` plugin**, so the `prose` classes
on every rich-text read view were dead — even server-rendered HTML showed lists/headings flat.

**Fix:**
- New shared `frontend/components/ui/rich-text-editor.tsx` — a TipTap editor with a formatting toolbar
  (bold / italic / underline / strike / H2·H3 / bullet+numbered lists / quote / inline code / link /
  clear / undo·redo). Emits HTML; empty doc normalises to `""`; SSR-safe (`immediatelyRender:false`); all
  sub-components module-top-level; external-value re-sync skips our own emitted HTML so the cursor never
  jumps mid-type.
- Wired into `ticket-create-form.tsx` (`richtext` case — split out from `multiline`, which stays a
  textarea), `ticket-detail.tsx` `DescriptionEditor` (seeded from stored HTML, not the plain-text mirror),
  and `CustomFieldEdit` (`richtext` case, commit-on-blur).
- `app/globals.css` — hand-written rich-text typography for both the live editor
  (`.ProseMirror`/`.rte-content`) and rendered output (`.prose …`) + the Tiptap placeholder rule; fixes
  all existing read views too (comments / KB / descriptions had been rendering unstyled).
- Backend — `field_service._coerce` now runs `richtext` custom values through `sanitize_html` (bleach) on
  write, so the read view can render them with `dangerouslySetInnerHTML` safely (the Description column
  was already sanitised by `ticket_service`).

**Verification:** `tsc --noEmit` clean; clean `next build` compiles (TipTap bundle in `/new` + detail);
`makemigrations --check` clean (no model change); `apps.itsm_core` + `apps.itsm_tickets` = 48 tests green
+ new `QueryBuilderTests.test_richtext_custom_field_value_is_sanitised` (49).
**QA hook:** new *Tickets/Fields — Rich-text editor with formatting toolbar* section in
`docs/QA_CHECKLIST.md`; skill `itsm-fields` updated (create form / detail / RichTextEditor / `_coerce`).

## 2026-06-22 — Projects/Tickets/Dashboards — Project Filters tab + queue default views (feature)

**Context:** the queue view dropdown (All tickets / Open / Unassigned / …) was hardcoded with no admin
surface, no project-level default, and no per-user default — a fresh visit always landed on **All
tickets**. Requested: a project Settings → **Filters** tab to curate views + create custom filters + set
a project default, a per-user default chosen from the queue, and a product default of **Open tickets**.

**What shipped (reused existing infra — `SavedFilter` already persisted custom filters; mirrored
`QueueColumnPreference` for the per-user default):**
- **Backend.** Two new `Project` columns (`itsm_projects` migration `0004`): **`default_view_key`**
  (CharField — system view key like `"open"`/`"all"` or `"saved:<uuid>"`; blank ⇒ product default) and
  **`disabled_view_keys`** (JSONField — system keys hidden from the dropdown). `ProjectWriteSerializer`
  gained both fields + `validate_disabled_view_keys` (strips `"all"`/unknown/dups) and
  `validate_default_view_key` (blanks an unknown key or a missing `saved:<uuid>` so no dangling refs).
  New per-user **`itsm_dashboards.QueueViewPreference`** (owner+project, unique alive; migration `0004`)
  with an owner-scoped **upserting** `/api/v1/itsm/queue-view/` (copy of `QueueColumnPreference`).
  `PRODUCT_DEFAULT_VIEW_KEY = "open"` added to `itsm_tickets/services/filter_fields.py`.
- **Frontend.** New **Filters** settings tab (`components/settings/filters-editor.tsx`): enable/disable
  system views ("All tickets" locked on), full custom-filter builder reusing the queue chips
  (`FilterChip`/`FieldPicker`/`useFilterOptions`/`buildSpec`) → project-shared `SavedFilter`s with
  rename/delete/reorder, and a project-default selector — all via `projectsApi.update` / `savedFiltersApi`.
  The queue view dropdown (`saved-views.tsx`) gained a **"Set as my default" star** per row (`queueViewApi`).
  `ticket-queue.tsx` resolves a fresh visit (no `?view`/`?q`) as **personal default → project default →
  product default (`open`) → All tickets** behind a `ready` gate (no "All tickets" flash); the dropdown is
  filtered to `enabledSystemViews` (project `disabled_view_keys`, "all" always shown).

**Migrations:** `itsm_projects/0004_project_default_view_key_project_disabled_view_keys`,
`itsm_dashboards/0004_queueviewpreference`.

**Post-review hardening** (adversarial multi-agent review of the diff, all findings low/medium, graceful
fallbacks — fixed anyway):
- **`validate_default_view_key` was too permissive** — accepted *any* existing `SavedFilter`, so a
  personal or cross-project filter could be stored as a project default that no other agent's queue could
  resolve. Now constrained to a **shared** filter on this project (or a global/null-project shared one),
  mirroring `SavedFilterViewSet` (`apps/itsm_projects/serializers.py`; +test
  `test_default_view_key_requires_shared_filter_on_this_project`).
- **Deleting the project-default custom filter** (`filters-editor.tsx`) only cleared local state →
  dangling `default_view_key`. Now PATCHes `default_view_key=""` immediately on delete.
- **Deleting a saved filter that was a personal default / the active view** (`ticket-queue.tsx`) left a
  dangling `QueueViewPreference` + a stale "Saved filter" label. A reconcile effect now drops a
  `saved:<id>` that no longer exists (active view → ad-hoc "Custom filter"; personal default → cleared
  server-side). Admin-*disabled* system views are deliberately preserved (re-enableable).

**Verification:** `tsc --noEmit` clean; `next build` compiles (14/14 routes); `manage.py check` +
`makemigrations --check` clean; 58 existing tests (dashboards/projects/tickets/helpdesks) green + 6 new
(`QueueViewPreferenceTests`, `ProjectFilterDefaultsTests`).
**QA hook:** new *Settings — Filters tab + queue default views* section in `docs/QA_CHECKLIST.md`.

## 2026-06-22 — Email — Email channel for ticket creation (mailbox → tickets, JSM-style) (feature)

**Context:** add an inbound email channel (configure a mailbox per project → email becomes tickets /
replies become comments) plus an outbound loop (the mailbox sends the acknowledgement + agent replies,
threaded). The platform was already scaffolded for `itsm_email` (settings, RBAC modules, `seed_itsm`
step, the `email_thread_headers` outbox hook, default `TicketCreated`/`CommentAdded` requestor rules),
and a complete implementation sat in `archive/old-backend/apps/itsm_email/` but had never been wired in.

**What shipped:**
- **Restored** `archive/old-backend/apps/itsm_email/` → `backend/apps/itsm_email/` (4 models, Fernet
  `crypto`, stdlib IMAP/POP `mailbox`+`parser`, `detectors`, `threading`, `identity`, `poller`, OAuth2,
  scheduler, seed, serializers/views/urls) and wired it into `INSTALLED_APPS` + `core/urls.py` (the only
  2 new lines — settings/RBAC/seed were already present). Regenerated `migrations/0001_initial`.
- **Outbound via the mailbox SMTP:** new `services/transport.py` (`get_outbound_config`) +
  `services/smtp_backend.py` (`XOAuth2EmailBackend` — Django's SMTP backend has no XOAUTH2) + a new
  `email_outbound_transport` hook in `itsm_core/services/hooks.py`; `itsm_notifications/services/
  outbox.py` swaps the connection + From per ticket. Acknowledgement + agent replies reuse the seeded
  notification rules — only transport/From/threading are added. No channel → global backend (unchanged).
- **Priority mapping:** new `services/priority.py` + `EmailChannel.priority_map` (editable) +
  `parser` retains `X-Priority`/`Importance`/`X-MSMail-Priority`/`Priority`.
- **Large-email handling:** `EmailChannel.max_attachment_bytes` — oversize parts skipped + a private
  agent note; whole-message `max_size_bytes` → ignored `size_cap`.
- **OAuth SMTP:** Microsoft scope gains `SMTP.Send`; `oauth.smtp_endpoint` added; Gmail's full-mail
  scope already covers SMTP.
- **Config UI** under the per-helpdesk Settings hub: `settings/email` (tabbed mailbox editor:
  Connection / Outbound / Field Mapping incl. the priority map / Processing / Domains allow-block) +
  `settings/email/logs` (inbound log + retry); `field_mappings` block exposes every mapping; secrets
  write-only. `create_users` now defaults **True** (auto-create the requestor in real time).

**Verification:** `apps.itsm_email` 35 tests; `apps.itsm_tickets` (48) + `apps.itsm_notifications`
green; `makemigrations --check` clean; `seed_itsm` re-runnable; frontend `tsc` clean + `next build`
compiles both routes.
**QA hook:** docs/QA_CHECKLIST.md → "Email Channel — mailbox → tickets, outbound via mailbox SMTP".

## 2026-06-21 — Tickets/Projects/SLA/Groups — "Next level" queue + ticket UX (feature)

**Context:** six enhancements to bring the queue + ticket UX closer to JIRA/Zoho.
The SLA backend already modelled per-priority Response/Resolution targets (policy →
metric → per-priority `SLATarget` + runtime `SLATracker`), so (f) was a *missing config
UI*, not new modelling.

**What shipped:**
- **(a) Configurable queue columns + SLA bars.** Shared registry
  `components/tickets/queue-columns.tsx` (keys ↔ labels ↔ widths ↔ sort keys). New default
  layout = the old columns **plus** Requestor, Group and two SLA RAG bars (Response,
  Resolution). The list serializer (`TicketListSerializer`) gained `requestor`, `created_by`,
  `updated_by` and a cheap `sla` payload (`{first_response, resolution}` — wall-clock RAG so
  the list never pays a business-time calendar read per row); the viewset prefetches
  `sla_trackers__metric`. Per-project default lives in `Project.queue_columns` (JSON), edited
  on the new **Columns** settings tab (`column-layout-editor.tsx`).
- **(b) Per-agent column layout.** New `itsm_dashboards.QueueColumnPreference`
  (owner+project, unique alive) with an owner-scoped upserting endpoint
  `/api/v1/itsm/queue-columns/`. The queue's "Columns" popover
  (`column-picker.tsx`) toggles/reorders columns and persists them; empty ⇒ fall back to
  project/built-in default. Resolution order: user pref → project default → built-in.
- **(c) Comments/Activity tabs.** The ticket detail's stacked Comments + Activity sections
  are now JIRA-style **tabs** at the bottom of the main column (counts in the labels),
  reusing `components/ui/tabs.tsx`.
- **(d) Strict, group-scoped assignee.** A ticket's assignee must be an **active member of
  its assigned group**. Enforced on the agent write paths — `ticket_service.update_ticket`
  (inline edit) and the view-layer create / `assign` action / bulk-assign (400 / skip) via
  `ticket_service.ensure_assignee_in_group`. The lower-level `create_ticket` / `assign`
  services stay permissive (routing, escalation, portal/catalog, fixtures). The assignee
  picker (detail + create) now draws from `GET /groups/{id}/members/` (leads first) via the
  shared `group-member-picker.tsx`; no group set ⇒ assignment blocked. The group members
  sheet can add a member as **member or lead** and promote/demote (`add_member` upserts the
  role).
- **(e) Audit fields.** New `Ticket.updated_by` FK, stamped by `update_ticket` / `assign`;
  list + detail serializers expose `created_by`/`updated_by`/`created_at`/`updated_at`. The
  detail meta rail shows Created / Created by / Last updated / Updated by.
- **(f) SLA config UI.** New project settings **SLA** tab (`sla-editor.tsx`): create the
  project policy + First Response & Resolution metrics with per-priority minute targets
  (e.g. Critical 30m response, Low 4h) and a calendar; CRUD via the existing
  `/sla-policies/ /sla-metrics/ /sla-targets/` endpoints. The engine auto-starts the clocks
  on ticket create (`hooks.sla_start_for_ticket` → `resolve_policy`).

**Migrations:** `itsm_tickets/0002_ticket_updated_by`, `itsm_projects/0003_project_queue_columns`,
`itsm_dashboards/0003_queuecolumnpreference`.

**QA hook:** new *Tickets — Configurable queue columns + SLA bars*, *Tickets — Comments/
Activity tabs + audit fields*, *Tickets — Strict group-scoped assignee*, and *Settings — SLA
configuration* sections in `QA_CHECKLIST.md`; `TicketInlineEditApiTests` gains
`test_patch_assignee_not_in_group_is_400` + `test_patch_records_updated_by`.

## 2026-06-21 — Tickets — Detail view was 100% read-only; made fields editable in place

**Symptom:** opening any ticket in the agent app (`/agent/w/<hd>/p/<proj>/<id>`) showed
every field — priority, assignee, group, requestor, summary, description, custom fields —
as static text. An agent could only change status (via the workflow transition buttons);
nothing else could be edited without going back to a create flow.

**Root cause:** the detail view (`components/tickets/ticket-detail.tsx`) only ever
*rendered* values (`FieldView` / `fieldValue`), and the backend exposed no inline-edit write
path — `TicketDetailSerializer` is all read-only (nested `UserBriefField`s) and there was no
`update`/PATCH handler, only the `assign` / `transition` / `set-fields` actions.

**Fix:**
- Backend — new single write site `ticket_service.update_ticket(*, ticket, user, **changes)`
  (`apps/itsm_tickets/services/ticket_service.py`): touches only the keys supplied
  (`priority`, `summary`, `description_html`, `impact`, `urgency`, `requestor_id`,
  `assignee_id`, `group_id`), logs each change to the audit feed (`priority_changed`,
  `requestor_changed`, `summary_changed`, `description_changed`, `group_changed`, `assigned`),
  re-emits `Assigned` on an assignee change, stamps `assigned_at`, and sanitises the
  description exactly like `create_ticket` (XSS-safe + mirrored `description_text`).
- Backend — `TicketViewSet.update` (`views.py`) routes PATCH/PUT through that service:
  validates `priority` against the allowed set (400 otherwise), rejects an empty `summary`,
  and resolves `requestor`/`assignee` (integer User PK or null-to-clear) + `assigned_group`
  (UUID or null) via `_resolve_user_change` / `_resolve_group_change` (unknown id → 400).
  Helpdesk scope (404) + RBAC `itsm.tickets:update` are enforced upstream by
  `get_object()` / `HasModulePermission`.
- Frontend — `ticketsApi.update` (PATCH standard fields) + `ticketsApi.setFields` (custom
  fields). `FieldView` now renders inline editable controls when the user has
  `itsm.tickets:update`: priority select, async user pickers (assignee/requestor), group
  select, a description editor (toggle), an inline summary editor in the header, and
  type-appropriate controls for custom value-backed fields (dropdown/radio/checkbox/date/
  number/multiline/multiselect/cascade/group_picker). Each control auto-saves and refreshes
  the activity feed. Status stays workflow-driven (transition buttons); `ticket_type` /
  `workflow` / `source` / attachments stay read-only.

**Who can edit:** Agents + Supervisors (both hold `itsm.tickets:update`); a plain Requestor
has no `itsm.tickets` grant, so the agent endpoint returns 403 and the portal stays
conversation-only by design. Editing degrades to read-only when `hasPerm` is false.

**QA hook:** new *Tickets — Inline field editing on the detail view* section in
`QA_CHECKLIST.md` + `apps.itsm_tickets.tests.TicketInlineEditApiTests` (11 tests).

## 2026-06-21 — Fields/Layout — Standard field catalog, layout-driven create form, two-pane regions

Feature work (the "minimum field configuration" milestone) across three iterations. Standard fields
are now seeded as **system `FieldDefinition`s** (global, `config.maps_to` → Ticket column) + a
per-project **Category** cascade field, placed on an auto-created default `FieldLayout`
(`itsm_core/seed.py`; backfilled for existing + new projects). Added field types `richtext` /
`cascade` / `attachment`, `FieldOption.parent`/`level` (cascade tree), per-field Basic/Advanced
settings (`config.tooltip`/`hint`/`regex` + conditional `visibility_rule`), a **layout-driven
two-pane create form**, and layout **regions** (Main/Sidebar) + field **width** (Full/Half). Two
real bugs flushed out:

### Bug A — `FieldDefinitionViewSet` `?project=` hid global system fields

**Symptom:** the Fields tab showed only project-scoped fields; the 9 global standard fields never
appeared (the "Global fields" section was always empty).
**Root cause:** `filterset_fields=["project"]` did an **exact** match on the FK, so `?project=<id>`
excluded `project IS NULL` rows.
**Fix:** `backend/apps/itsm_core/views.py` — dropped `project` from `filterset_fields` and added
`get_queryset` that ORs `Q(project=id) | Q(project__isnull=True)` (mirrors `get_field_definitions`).
**QA hook:** *Fields/Layout regions* checklist — "Fields tab lists project + global system fields".

### Bug B — `TicketCreateSerializer.requestor`/`assignee` were `UUIDField`, but User PK is integer

**Symptom:** creating a ticket with a requestor/assignee (now that the layout-driven form sends them)
failed 400 `"Must be a valid UUID."`. The old hardcoded form never sent these, so it was latent.
**Root cause:** `accounts.User` has an **integer** PK; the create serializer declared those FKs as
`UUIDField` (only `assigned_group` is genuinely UUID).
**Fix:** `backend/apps/itsm_tickets/serializers.py` — `requestor`/`assignee` → `CharField`
(`_user(pk=…)` resolves either); `assigned_group` stays `UUIDField`.
**QA hook:** *Fields/Layout regions* — "create with requestor/assignee/custom_fields returns 201".

**Design note (regions):** `region`/`width` are a brand-new axis, so migration `0004` includes a
one-time RunPython backfill putting the standard sidebar keys (priority/mode/requestor/group/
assignee/source) on the right for layouts created before the feature; admins move fields freely
after. RTE → forced `main`/`full`; sidebar → forced `full` (server-enforced in the serializer).

## 2026-06-20 — Settings / Admin — Zoho-style settings hub + four backend gaps closed

Feature (the per-helpdesk **Settings** area: HelpDesk Configuration + Project Configuration). Mostly a
frontend aggregation over existing engines, but it surfaced four backend gaps worth recording.

**Gap 1 — Business hours had no write endpoint.** `BusinessCalendarSerializer` nests `hours` as
`read_only`, and `itsm_sla/views.py` had only Calendar + Holiday viewsets, so the calendar editor could
not edit working windows. **Fix:** added `BusinessHoursViewSet` (`itsm_sla/views.py`, module
`itsm.sla.calendars`, `filterset_fields=["calendar","weekday"]`) at `business-hours` per-row CRUD +
`BusinessHoursSerializer.validate` (400 on `end_time <= start_time`). Deliberately **no
`(calendar, weekday)` unique constraint** — `business_time.spec_from_calendar` aggregates multiple windows
per weekday (split shifts); a unique constraint would break add/edit.

**Gap 2 — `GroupSerializer` omitted `helpdesk`; list was unscoped.** The model had the FK but the API
neither exposed nor scoped by it, so "assigned groups per helpdesk" was impossible. **Fix:** added
`helpdesk`/`helpdesk_name` to the serializer; `GroupViewSet.get_queryset` now scopes to
`Q(helpdesk_id__in=scope) | Q(helpdesk__isnull=True)` and `perform_create` guards inaccessible helpdesks
(mirrors `ProjectViewSet`).

**Gap 3 — No project→calendar binding.** Calendars are global; nothing let a project pick one. **Fix:**
added nullable `Project.calendar` FK (`0002_project_calendar`) preferred by `sla_engine.start_trackers`
(`ticket.project.calendar or policy.calendar or default`); the per-tracker `calendar` snapshot still
freezes the choice, so in-flight clocks are unaffected.

**Gap 4 — `ApprovalWorkflow` was helpdesk-scoped only.** Per-project approval config needed a project
link. **Fix:** added nullable `ApprovalWorkflow.project` FK (`0002_approvalworkflow_project`) +
`?project=` filter + helpdesk-scoped `get_queryset`.

**Prefix edits:** left always-editable by design (user decision) — the helpdesk/project `key` write
serializers are unchanged; the UI warns + confirms because existing `ticket_number`s are never renumbered.
**QA hook:** new *Settings / Admin* section in `QA_CHECKLIST.md`.

## 2026-06-20 — One Helpdesk — Helpdesk (workspace/department) layer + per-helpdesk scoping

Feature, not a bug — but it shipped with two gotchas worth recording so they don't recur. The product renamed ITSM → **One Helpdesk**: multiple departments (IT, HR, …) share one platform, each a **Helpdesk** (new `apps.itsm_helpdesks` app: `Helpdesk` + `HelpdeskMembership` + `services.py` scoping primitives). `Project` gained a non-null `helpdesk` FK; ticket numbers are now per-helpdesk-prefixed (`ITINC-1`); 8 shared-service guards clamp every ticket-facing query to the caller's accessible helpdesks. The two bugs flushed out during the build:

### Gotcha A — Postgres "pending trigger events" when deleting rows + `ALTER TABLE` in one migration

**Symptom:** the migration that dropped the legacy global `INC` / `REQ` projects and then added the mandatory `Project.helpdesk` FK failed on Postgres with `cannot ALTER TABLE "itsm_projects_project" because it has pending trigger events`.
**Root cause:** the legacy `DELETE`s (cascading through PROTECTed dependents — `Ticket.project`, `EmailChannel.project`) queue deferred FK trigger events that must commit before the table can be altered. Doing the deletes and the `ALTER TABLE` in the **same** migration (same transaction) leaves those trigger events pending at the `ALTER`.
**Fix:** split into two migrations — `itsm_projects/0002_drop_legacy_global_projects.py` (RunPython: clears PROTECT FKs then deletes legacy projects; guarded to no-op on a fresh DB) commits first, then `0003_project_helpdesk_field.py` does the `AddField` + index + partial unique constraint. The DELETEs now commit in their own transaction before the ALTER runs.
**QA hook:** "Old global INC/REQ are gone" + "`seed_itsm` is re-runnable" under *One Helpdesk — Helpdesk scoping* in `QA_CHECKLIST.md`.

### Gotcha B — pre-existing broken Notification frontend contract (had been silently dead)

**Symptom:** the notification bell badge never lit and the new /home attention panel showed no unread notifications, even when `InAppNotification` rows existed for the user.
**Root cause:** a long-standing field-name mismatch between the API and the frontend Notification client (it had been dead since the notifications UI landed — nothing exercised it until the attention panel did). The frontend read `read`, `message`/`body`, and `{count}` while the API emits `is_read`, `body_text`, and `{unread}`.
**Fix:** corrected the frontend contract — `read` → `is_read`, `message`/`body` → `body_text`, `{count}` → `{unread}` — so the bell badge and the /home attention panel's unread-notifications block render correctly.
**QA hook:** existing notification-rendering checks plus the /home attention panel (unread notifications) verification.

---

## 2026-05-10 — Project Management — Comments + Activity Log on items (initial scaffold)

Not a bug — first entry to seed the format. Feature shipped:
- Per-item rich-text comments (Tiptap, server-sanitised via bleach).
- Per-item activity feed covering cell changes, comment lifecycle, attachment add/remove, item create/rename/move.
- Right-side `Sheet` drawer with Comments / Files / Activity tabs.
- Comment-bubble icon column on the board, count badge.
- `/api/v1/pm/items/<id>/files/` unions cell + comment attachments for the Files tab.

Future regressions in this area should land here with the format above.
