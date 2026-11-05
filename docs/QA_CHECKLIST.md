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
- [ ] **Deleted tickets** (added 2026-10-29): a query rooted at a ticket's CHILD model (`SLATracker`, `ApprovalRequest`, `NotificationOutbox`, `SurveyResponse`, `InAppNotification`, links, comments…) or a forward FK (`row.ticket`) still sees deleted tickets. Add `ticket__is_deleted=False` (`.exclude(ticket__is_deleted=True)` when the FK is nullable) or check `row.ticket.is_deleted`. Ticket deletes go only through `ticket_service.delete_ticket`. See "Deleted tickets are inert".
- [ ] `permission_classes` set on every ViewSet (default `AllowAny` is for dev only — production routes must opt in to `HasAppAccess.for_app(...)`)
- [ ] Serializer split into List / Detail / Create where it makes sense
- [ ] No `print()` — use Django logging
- [ ] No `\n` inside f-strings (Python 3.12 SyntaxError)
- [ ] Number / order generation wrapped in `transaction.atomic` and `select_for_update` if concurrent
- [ ] API response shape matches what the frontend `lib/pm.ts` (or equivalent) expects
- [ ] If you added a write site, you also called `log_activity(...)` from `apps.project_management.activity` (PM module only)
- [ ] **Priority writes** (added 2026-10-18): any new write of `Ticket.priority` goes through `ticket_service.update_ticket`, or calls `hooks.sla_priority_changed(ticket, old, new)` post-commit. Otherwise SLA targets silently stop following priority (B8).
- [ ] **New config ViewSet / module code** (added 2026-10-18): decide whether it belongs in `itsm_core/services/audit.AUDITED_AREAS`, the admin audit log's exact-match allowlist. Config writes outside a ViewSet call `audit.log_admin_event(...)`.
- [ ] **Postgres extensions** (added 2026-10-18): never `CREATE EXTENSION` (or `TrigramExtension()`) in a tenant migration. Use `CREATE EXTENSION … WITH SCHEMA public`, or move it there; see `itsm_tickets/0011_search`. Otherwise it lands in the first tenant's schema.
- [ ] **`hooks.begin_approval` is the one non-swallowing hook** (added 2026-10-18). Call it INSIDE the write's transaction so an `ApprovalStartError` (400) rolls the status change back. Every other hook still swallows errors.
- [ ] **`select_for_update` + nullable `select_related`** (added 2026-10-18): Postgres refuses `FOR UPDATE` on the nullable side of an outer join. Pass `select_for_update(of=("self",))`, as in `approvals engine.decide` and `sla_engine.on_priority_change`.
- [ ] **Private files** (added 2026-10-31): files that aren't meant for anyone holding a link (invoices, contracts, HR paperwork) are stored under `media/itsm_private/…` with a random name, have **no** URL in any serializer, and are served only by an authenticated action (`FileResponse`, `as_attachment=True`, `X-Content-Type-Options: nosniff`, Content-Type decided from the extension). nginx 404s `/media/itsm_private/` (both confs). Model: `itsm_assets` `AssetDocument` / `services/documents.py`. Allow only types that can't run script (no html/svg).
- [ ] **New editable ticket field** (added 2026-10-31): if `update_ticket` (or `set_values`) can write it, add it to the automation catalog too (`itsm_automation/services/catalog.py` `SETTABLE_COLUMNS` / `SETTABLE_CF_TYPES`, `actions.SETTABLE_BUILTINS` + `clean_column_value`, `serializers._clean_set_field`). Otherwise "Set field" silently can't offer it (BUG_LOG 2026-10-31).
- [ ] **Option checks are per project** (added 2026-10-31): validate an option value against the project's own `FieldDefinition` (`get_field_definitions(project)`), never `FieldOption.objects.filter(field__key=…)` — several projects share keys such as `category`.

## After Any Frontend Change

- [ ] `"use client"` on any page using state / hooks / event handlers
- [ ] `useParams<{ id: string; boardId: string }>()` for dynamic segments
- [ ] All API calls go through the ITSM client: typed wrappers in `lib/itsm/api.ts` (or a feature file such as `lib/itsm/assets-api.ts`) over `itsmClient` in `lib/itsm/client.ts` (`get / post / patch / put / del / upload / download`) — never raw `fetch` (updated 2026-10-19; this line used to name the old `lib/api.ts`)
- [ ] Errors surfaced via `toast.error(...)` from sonner (now installed) — not `alert()` and not silent
- [ ] Loading states (`<Loader2 className="animate-spin" />` or skeleton blocks)
- [ ] No broken imports or unused variables
- [ ] TypeScript types match API response (`PmItem.comment_count`, `PmComment.body_html`, …)
- [ ] **Rich-text tags need `.prose` styles** (added 2026-10-31): `.prose` is hand-written in `app/globals.css` (no typography plugin) and preflight resets everything. Any tag the sanitizer allows (`itsm_core/services/html.ALLOWED_TAGS`) needs a rule there, or it renders unstyled — tables did until 2026-10-31 (INC112). The sanitizer drops `style`/`border`, so the CSS is the only styling a stored body gets.
- [ ] **Long rich text** (added 2026-10-29): render stored description/comment/rich-text HTML on screen with `ExpandableHtml` (`components/ui/expandable-html.tsx`, 6 lines + Show more), not a bare `dangerouslySetInnerHTML` div. Never put its toggle inside another interactive element: pass click-to-edit through `bodyProps`. Print views render the full text.

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
- [ ] Every icon-only / disabled / jargon control has hover help (`IconButton` / `Hint` / `InfoTip`) — see "Hover help / tooltips (2026-10-18)"

## Module-Specific Checklists

### Email table grid, asset documents, automation Set field (added 2026-10-31)

GridCrest asked for three things (BUG_LOG 2026-10-31, three entries). Decisions: every rich-text table gets a grid (CSS only, signature tables included); document types are a fixed list of Invoice / Warranty card / Manual / Other; asset editors add and remove, viewers download; Set field covers every ticket-detail field except Summary, Description and Requestor.

**Email tables (`app/globals.css`)**
- [ ] A comment or description with an Outlook table (e.g. GridCrest INC112) shows a 1px grid. Cells are padded, and a cell's `<p class="MsoNormal">` adds no extra height.
- [ ] A table wider than the column scrolls inside its card, and the page has no horizontal scroll at 1280px or at phone width.
- [ ] Dark mode: the grid stays visible (`border-border`). Print (More ▸ Print): grey `#999` borders.
- [ ] The portal request page and KB article show the same grid (the same `.prose` rules).

**Asset documents (asset page, right rail)**
- [ ] The **Documents** card sits between Tickets and History, with a count and, for users with Assets → Update, **Add**.
- [ ] The Add dialog defaults to Invoice until the asset has one, then Other. A `.html`/`.svg`/`.zip`/`.exe` file or one over 20 MB is refused in the dialog *and* by the API (400). A note over 255 characters → 400.
- [ ] The list is ordered Invoice → Warranty card → Manual → Other, newest first within a type. Each row shows the type chip, name, size · uploader · date, and the note.
- [ ] A PDF or image opens in a new tab (blob URL, no popup-blocker warning); Word / Excel / txt download under the original name.
- [ ] Remove asks for confirmation. The row goes, and History shows "Document removed · Invoice · name". An upload shows "Document added".
- [ ] A role with Assets → Read only sees and opens files but has no Add or bin icon; the API gives 403 on POST/DELETE. A requestor gets 403. Another helpdesk's asset → 404. Anonymous → 401.
- [ ] The response has no file URL. `GET /media/itsm_private/…` through nginx → 404, while ordinary `/media/` attachments still → 200.
- [ ] Deploy: migration `itsm_assets.0005` in every org; then check that `ticketprod-nginx` actually has the new conf (`docker exec ticketprod-nginx grep itsm_private /etc/nginx/conf.d/default.conf`). A host edit replaces the bind-mounted inode, so restart or recreate the container.

**Automation → Then → Set field**
- [ ] On an Incident project the field list includes Users Affected, Business Impact, Root Cause, Resolution Code, Resolution Notes, Service Downtime, Workaround Provided and Major Incident, plus custom multi-select, cascade (e.g. Category) and group fields. Summary, Description and Requestor are absent. Other project types list only the fields that apply to them (`get_field_definitions(applicable_only=True)`, the same rule as the Fields tab); e.g. Workaround / Investigation Reason belong to Problem projects.
- [ ] Each field shows the right control: a number box for Users Affected, a textarea for notes, a list for Resolution Code, a checkbox for Yes/No fields (starts as No, complete without a click), a level-by-level picker for a cascade, and one group for a group field.
- [ ] Saving with an invalid value (negative Users Affected, an unknown option, a broken cascade path) is refused with a message.
- [ ] The rule summary reads e.g. "set Users Affected to 5", "set Major Incident to Yes", "set Category to Hardware › Laptop".
- [ ] A rule "Ticket created → set Users Affected = 5" runs on a new ticket; the ticket shows 5 and Recent runs says success. Setting Impact or Urgency recalculates Priority.

### Ticket detail: frozen header, Show more, collapsible sections, asset top-3, Internal note button; email CSS leak (added 2026-10-29)

GridCrest asked for six changes (BUG_LOG 2026-10-29, two entries). Decisions: the Internal note button is a brand-pink outline; Show more covers descriptions, read-only rich text **and** comments; old email tickets are NOT cleaned; collapse state is NOT remembered.

**Email CSS leak (backend)**
- [ ] Mail from Outlook on the web (`<head><style> P {margin-top:0;…} </style>`) creates a ticket whose description starts with the real text, both on screen and in `description_text` (search, Ticket Data).
- [ ] `sanitize_html` / `html_to_text` drop `head/style/script/title/xml/template/noscript` **with their contents** (`strip_non_content`). Normal content, `<header>` and braces in text are untouched. Tests: `apps.itsm_core.tests_html`, `itsm_email` `OutlookWebStyleLeakTests`.
- [ ] A signature-only body that also has `<head><style>` is kept whole, not cut to an empty description (`scrub._has_visible_content`).
- [ ] Tickets created before the fix still show the text (user decision). Editing the description removes it.

**Frozen header**
- [ ] At md+ and 1440×900, scroll the ticket: the header card (crumb, number, status, title, actions) stays directly under the app header. Nothing shows above it or around its corners. It gets a shadow once scrolled, and the page doesn't jump at rest.
- [ ] The side rail sticks just below the header when it fits the viewport. When it's taller (16 assets expanded, all sections open), it scrolls with the page and SLA / Linked issues / metadata stay reachable.
- [ ] Tab through the fields: focus never lands under the header (`scroll-padding-top` on `<html>`, cleared on leaving the page).
- [ ] At 390px the header scrolls normally and there is no sideways scroll. Popovers (watchers, attachments, ⋮) and tooltips open above the band. Print is unchanged.
- [ ] Both densities × light/dark. The band is the page colour (`bg-background` + `bg-muted/30`), so it is never a white strip in dark mode.

**Show more / Show less**
- [ ] A long description shows 6 lines ending in "…", then **Show more**. Expanding shows everything with **Show less**, and collapsing scrolls the top back into view if needed. A short one has no toggle.
- [ ] On the description, clicking **Show more** never opens the editor, while clicking the text still does. axe reports no nested-interactive.
- [ ] Long comments (agent page and portal conversation) clamp. Short ones and one-line-per-paragraph mails aren't cut mid-line.
- [ ] The portal description and read-only rich-text fields (agent and portal) clamp. The print sheet prints everything.

**Collapsible sections**
- [ ] Every main section (Ticket details, Impact Assessment…) and every sidebar section (Details, People, Info…) has a header button with a chevron (`aria-expanded`). Click collapses and expands it.
- [ ] Project settings → Layout: each section header has a **Collapsed** switch (read-only users see "Starts collapsed"). It saves at once and survives a reload and a **rename** of the section.
- [ ] A section set Collapsed starts closed on every ticket. Toggling it isn't remembered: the next ticket opens with the layout default.
- [ ] Resolution Details still collapses by itself while empty (with its summary line) and opens once something is recorded.
- [ ] The create form and the Service Portal ignore Collapsed (required fields are never hidden there).
- [ ] API: `PATCH field-layouts/{id}` keeps `collapsed: true` and drops `false`. A non-bool value returns 400. `field-layouts/resolve/` returns `sections`.

**Requestor's assets / Internal note**
- [ ] A requestor with more than 3 active assets shows 3 chips plus **Show N more** (then **Show less**), on the detail page and the create form. Adding a chip still works.
- [ ] **Internal note** beside "Add a comment…" is an outlined pink button (`border-primary/40`, `text-primary-ink`, AA), the same height as the box, with its hover help.

**Gates**
- [ ] `npx tsc --noEmit` + a clean `npm run build`. Backend: `apps.itsm_core apps.itsm_email apps.itsm_tickets` + the full suite; `makemigrations --check` reports no changes. This change adds no migration.
- [ ] Visual check on an isolated stack (never prod), as in the density section.

### Deleted tickets are inert (added 2026-10-29)

GridCrest reported that REQ14 was deleted but still emailed ("Facility Bridge"). Cause: the SLA breach sweep ignored `is_deleted`, and a delete didn't stop clocks, cancel approvals or drop queued mail. The user's rule: after a delete, no email for SLA or any event, and the ticket is out of reports and dashboard counts. Decisions: a reply to a deleted ticket opens a new ticket; already-deleted tickets are cleaned by a migration. Skills: `itsm-tickets`, `itsm-sla`, `itsm-notifications`, `itsm-workflows` (approvals), `itsm-reporting`, `itsm-email` (2026-10-29). Bug log: 2026-10-29.

**Rules:**
- [ ] **One delete write site:** `ticket_service.delete_ticket(ticket=, user=)`. It soft-deletes, stops running/paused clocks (`sla_engine.withdraw_for_ticket` → `stopped`), cancels pending approvals (`approval_engine.cancel_pending`) and drops unsent mail (`outbox.cancel_for_ticket` → `dead`, "Cancelled: ticket deleted"). `TicketViewSet.perform_destroy` and bulk `op=delete` call it. Never call `ticket.soft_delete()` directly.
- [ ] **Guards stay in place** for tickets deleted any other way:
  - `hooks.emit_event` and `bus._emit` return early for a deleted ticket (no email, no bell).
  - `outbox.flush` marks a deleted ticket's row `dead` instead of sending it (covers surveys and retries).
  - `sla_engine.scan_breaches` filters `ticket__is_deleted=False`. Each tracker runs in its own savepoint, so one failure is logged and the sweep carries on.
  - Approvals: `pending_for` and `ApprovalRequestViewSet` hide them (decide/withdraw → 404).
  - Lists: CSAT `_survey_base`, the bell list and unread count, Linked issues, `ticket-links`, comment/watcher/attachment viewsets, KB article links.
  - Inbound retry: a row bound to a deleted ticket runs as a new ticket.
- [ ] **No new announcement on delete.** Nobody is emailed that a ticket was deleted (`ApprovalCancelled` from the cancel is suppressed by the emit guard).

**Verify:**
- [ ] `apps.itsm_tickets.tests_delete` (13) plus the full suite. `makemigrations --check` → "No changes".
- [ ] **Migration** `itsm_tickets/0013_quiesce_deleted_tickets` runs ×every org schema. Afterwards, for deleted tickets: no SLA tracker `running`/`paused`, no `pending` approval request, no `queued`/`sending` outbox row. Live tickets untouched. A second run changes nothing.
- [ ] **Agent:** delete a ticket that has a running SLA, a pending approval and unsent mail. The confirm names the effects. Within a few sweeps: no email, the approver's badge drops, the ticket is gone from queue, search, reports, dashboard widgets and CSAT. Opening its number → not found. A ticket linked to it no longer lists it.
- [ ] **Email:** reply to an old email of the deleted ticket → a new ticket with the normal acknowledgement; nothing is added to the deleted one.
- [ ] Help Center FAQ "What happens when a ticket is deleted?" reads correctly; no mojibake (`grep -P '\xc3\xa2\xc2\x80'`).

### Assets: sidebar category tree under Asset List (added 2026-10-24)

The user wanted ServiceDesk Plus-style browsing: Asset List stays "all assets", with an expandable category → sub-category tree that lists the chosen node's assets. They chose: in the sidebar, with counts. Frontend only. Skill: `itsm-assets` (2026-10-24).
- [ ] Sidebar → the arrow beside **Asset List** opens the tree (categories with counts); a category's arrow shows its sub-categories plus **No sub-category** (only when some assets have none).
- [ ] Clicking a node opens `assets/list?category=…[&sub_category=…]`. The list total equals the node's count (category, sub-category, No sub-category). The header reads "Category › Sub · Showing …".
- [ ] **Asset List** itself shows everything and is highlighted only without a category; the chosen node is highlighted instead.
- [ ] Reloading a category URL keeps the tree open and expanded; the open/closed state is remembered per browser; the icon rail shows only the Asset List icon.
- [ ] At the 192px minimum sidebar width there's no horizontal overflow, labels truncate with the full name on hover, and "Asset List" stays readable.
- [ ] Inactive categories that still hold assets are listed; empty inactive ones aren't.
- [ ] axe clean; every arrow is a labelled `IconButton` with `aria-expanded`.

### Users: edit name, email and manager (added 2026-10-24)

The user found no way to edit a user's name or email; there was also no UI for a user's manager. The username stays read-only (user decision). Skill: `itsm-rbac` (2026-10-24).
- [ ] ⋯ → **Edit details** appears for normal users. Bots don't get it, and a superuser row gets it only when you are a superuser.
- [ ] Save a new name / email / manager: the roster shows the email and "Reports to …", and the Audit log has an **Updated** user entry with the old → new values.
- [ ] An email already used by another account (as email or username, any case) is refused with that account's name, shown under the field. A bad email and a blank name are refused.
- [ ] Manager: self, inactive, bot, or someone who already reports to this user → refused with a message. Clearing works.
- [ ] A "Requestor's manager" approval on a ticket from that user goes to the new manager.
- [ ] Tests: `apps.itsm_rbac.tests_edit_user` + `apps.itsm_core.tests_admin_audit`.

### Send for approval + On-fly approvers (added 2026-10-24)

The user asked for agents to ask for sign-off mid-ticket (e.g. water damage → the requestor's manager approves a replacement), with an **On fly** approver type the agent picks. Decisions:
- the ticket moves to a configured waiting status and returns when decided;
- SLA follows the status (no new SLA logic);
- the drawer offers every active policy of the project;
- v1 includes a message to the approver and Withdraw.

Skills: `itsm-workflows` (approvals section), `itsm-tickets`, `itsm-rbac`, `itsm-notifications` (2026-10-24). Bug log: 2026-10-24.

**Rules:**
- [ ] **One write site:** agent-started approvals go through `itsm_approvals/services/send.py`, never `engine.start_approval(..., source="sent")` directly from a view.
- [ ] **Status moves:** the waiting / return moves go through `itsm_workflows.services.engine.move_for_approval`. It is the only status write besides `transition()` and shares `_status_change_effects`, so audit, SLA (`pauses_sla`), StatusChanged and automation behave like a transition.
- [ ] **On-fly approvers are per request** (`ApprovalRequestApprover`). Anything that resolves approvers must pass the request: `resolve_approver_ids(stage, ticket, req)` / `stage_problem(stage, ticket, req)`. Without `req`, an On-fly stage resolves to nobody.
- [ ] **An On-fly policy is never started by a transition or catalog item.** The stage, transition and catalog serializers refuse it, and `ensure_startable` refuses it at runtime (400, full rollback).
- [ ] **Only `source="sent"` requests can be withdrawn** and only they return the ticket. A rejected sent request never runs `move_to_rejected`.
- [ ] **The gates are unchanged:** `approval_granted` / `approval_rejected` read the latest non-cancelled request of either source.

**Verify:**
- [ ] `apps.itsm_approvals` (`OnFlyStageConfigTests`, `SendForApprovalTests`, `SentDecisionTests`, `WithdrawTests`) + `apps.itsm_workflows` (`SendForApprovalStatusTests`) + the full suite. `makemigrations --check` → "No changes".
- [ ] **Migrations** `itsm_workflows/0010`, `itsm_approvals/0004` and `itsm_rbac/0015` run ×every org schema. After `0015`:
  - Agent has `itsm.approvals.send` read/create/update.
  - Supervisor and Admin have full CRUD.
  - Requestor and custom roles have an explicit no-access row.
  - Hand-edited roles keep their other rows.
- [ ] **Admin, Workflow tab:**
  - Status settings → **Allow Send for approval** + **While waiting, move to**.
  - The row shows "send for approval → Awaiting Approval".
  - A Done status can't be ticked.
  - The waiting status can't be deleted while it's used.
  - Validate shows no "Unreachable" warning for it.
- [ ] **Admin, Approval tab:** add an **On fly (agent picks)** stage with each pool (Any user / Members of a group / Listed users).
  - The card shows "Send for approval only".
  - The transition **Start approval** select lists it disabled.
  - PATCHing it onto a transition via the API → 400.
- [ ] **Agent, In Progress ticket:** **Send for approval** opens the drawer.
  - Policies list their stages. One that can't start shows why and is disabled.
  - An On-fly stage needs a pick before Send enables (Hint says why).
  - Send → the ticket shows **Awaiting Approval**, the header shows "Awaiting approval", and the panel shows "Sent by …", the message, and "goes back to In Progress".
  - Activity reads "sent the ticket for approval — On Demand — Pick — asked Alice — “…”".
- [ ] **Approver:** inbox row shows the sender + message; email has **Sent by** and **Message** rows; approve → the ticket returns to In Progress and the buttons come back. Repeat with reject (returns, not Rejected).
- [ ] **Withdraw:** the sender sees **Withdraw**; another agent doesn't; a supervisor does. Withdraw → Cancelled, the ticket returns, Activity reads "withdrew an approval — reason: …", and you can send again.
- [ ] **Hidden when:** status not flagged, an approval is pending, or the role lacks `itsm.approvals.send` create.
- [ ] **No regression:** a transition-started approval (Manager approval on REQ) still freezes, notifies, gates and auto-moves to Rejected.
- [ ] **UI checks:**
  - The drawer at 390px has no horizontal scroll.
  - Every control has a Hint or InfoTip; disabled Send says why.
  - `lib/itsm/help/*` has no mojibake (`grep -P '\xc3\xa2\xc2\x80'` → nothing, see BUG_LOG 2026-10-24).
  - Agent sidebar resize handle (added 2026-10-24):
    - Nothing shows at rest.
    - On hover: a ↔ cursor, a thin brand-pink line and a small round ‹› grip, in light and dark.
    - Dragging from the line or the grip resizes; double-click resets.
    - The hidden grip never blocks clicks on the page next to it.

### Asset Management phase 2: assets linked to tickets (added 2026-10-23)

The user asked for an "Asset" system ticket field: link assets on create (defaulting to the requestor's), link any other asset with filters, show Asset in the Ticket Data report, and list a ticket history on the asset page. Decisions: no on/off switch, several assets per ticket (first = primary), portal requestors pick only their own. Skills: `itsm-assets`, `itsm-tickets`, `itsm-fields` (2026-10-23).

**Rules:**
- [ ] **One write path:** ticket↔asset links change only through `itsm_tickets/services/ticket_assets.py`. It keeps `Ticket.primary_asset` = position 0, stamps `updated_at`, honours `expected_updated_at`, and writes `AssetEvent` + ticket `AuditEvent`.
- [ ] **Same helpdesk only:** `resolve_assets(helpdesk_id, ids)` for agents; `owner=request.user` on the portal. Never link from a client-supplied helpdesk.
- [ ] **`asset_picker` stays in `NO_VALUE_TYPES`** (no FieldValue, no transition screens, automation, queue columns or filters). Anything that treats a `maps_to` as a scalar Ticket column must skip `maps_to == "assets"`.
- [ ] **`validate_required` skips only attachments.** The Asset field's Required flag is enforced.
- [ ] **The asset page's ticket list is clamped** like the queue (`scope_ticket_queryset` + `scope_ticket_queryset_by_project`).

**Verify:**
- [ ] `apps.itsm_tickets.tests_assets` (20) plus the full suite. `makemigrations --check` → "No changes".
- [ ] `migrate_schemas` rehearsal: an org rolled back to `itsm_core 0016` / `itsm_tickets 0011` / `itsm_assets 0003` with IT categories gets Asset **visible** on ITINC/ITREQ and hidden on HR/FAC. A fresh org gets it hidden everywhere. A second run applies nothing.
- [ ] **Create (agent, IT Incident):**
  - Picking a requestor with one active asset links it.
  - **Find another asset** (search + filters) adds a second asset.
  - The ticket shows both, with the first marked **Primary**.
  - Activity shows "linked 2 assets".
- [ ] **Detail:** ☆ makes another asset primary and × unlinks. Activity shows both. A stale copy gets the 409 refresh message.
- [ ] **Asset page:** the **Tickets** card lists the ticket (Primary badge, "N tickets · M open"). History shows "Linked to a ticket".
- [ ] **Portal (Request project, Asset Portal-visible):**
  - Only the requestor's own assets are offered.
  - A forged id → 400.
  - The request page lists the linked asset.
- [ ] **HR helpdesk form:** no Asset field (hidden by default).
- [ ] **Ticket Data report / export:** has the **Asset** and **All assets** columns.
- [ ] **UI checks:** axe clean on the finder dialog, ticket detail and asset page (2026-10-23: only the older Linked-issues `<dl>` remains; the peer's "Resize navigation" separator was fixed). 390px has no horizontal scroll. Hover-help grep gates pass.

### Asset Management v1: register, categories, statuses, import (added 2026-10-19)

The user asked for Asset Management in the helpdesk workspace, starting with basic IT assets. New TENANT app `itsm_assets`, the sidebar **Assets** section (Asset Dashboard · Asset List · Asset Report) and **Configuration → Asset Configuration**. Skill: `.claude/skills/itsm-assets`.

**Rules (check on every change that touches assets):**
- [ ] **One write path.** Assets are created/updated/deleted only through `services/asset_service.py` (the importer reuses `validate_core`). Every write logs an `AssetEvent` in the same transaction.
- [ ] **Scope (rule 15).** Reads use `resolve_helpdesk_scope`; writes resolve the target with `_require_helpdesk` (403 when not yours) and check category / sub-category / fields belong to that helpdesk. Another helpdesk's asset is 404.
- [ ] **Org-wide vs per helpdesk.** Statuses, Vendors, Locations, Departments have no helpdesk FK; categories, fields, assets, imports do. Don't add a helpdesk filter to the org-wide lists.
- [ ] **Uniqueness ignores case and soft-deleted rows.** Expression constraints get no DRF validator: check `iexact` in the serializer and map `IntegrityError` → 400. Tag writes take `tags.lock_tags()` first.
- [ ] **In-use checks are explicit** (soft delete never fires PROTECT): statuses, masters and categories refuse delete while live assets use them.
- [ ] **Detail values:** a bad number / unknown choice is an error, never a silent blank. Values of a deactivated or deleted field are kept; values of a live field that stops applying are dropped and logged.
- [ ] **Expiry:** past Expiry Date + active status is refused when either changed in the request; the hourly sweep (`assets.expiry_sweep`, in-memory job store — rule 23) moves the rest. Don't add a `DjangoJobStore`.
- [ ] **Excel:** every cell goes through `xlsx.put` (formula guard, rule 22); imports read with `read_only=True`, pre-load lookups (no per-row queries), and keep the 5,000-row / 10 MB / zip-size caps.
- [ ] **Permissions:** `itsm.assets` (register), `itsm.assets.import`, `itsm.assets.config`. Lookup lists open with either Assets or Config read (`AssetLookupPermission`). New modules need registry entries AND a create-only backfill migration with explicit rows for every live role.

**Verify:**
- [ ] `apps.itsm_assets` tests pass (69). Full backend suite on 2026-10-19: 960 tests, all green (the 3 `itsm_email` attachment tests only fail on a read-only `/app` mount — run them on a writable copy). `makemigrations --check` → "No changes".
- [ ] `migrate_schemas` rehearsal with two orgs: a fresh `create_org` (seed wires the modules) and an existing org rolled back to `itsm_assets zero` with a custom role (it gets explicit no-access rows); a second run applies nothing; the public schema has no `itsm_assets_*` tables.
- [ ] **Sidebar:** ASSETS shows Asset Dashboard / Asset List / Asset Report for roles with `itsm.assets` read and is hidden otherwise; collapsed rail shows the divider + icons; the mobile drawer closes on click.
- [ ] **Configuration → Asset Configuration → Categories & Fields:** empty state → **Load IT starter set** adds Computer, Server, Printer, Network Device, Monitor, Mobile Device with sub-categories and fields; a second click adds nothing. A third level is refused; a duplicate name (any case) is refused; deleting a category with assets shows "N assets use this category…".
- [ ] **Create asset:** Computer › Laptop shows Serial Number* + Screen Size, Server › Virtual Machine shows Hostname*, IP Address*, Hypervisor (different fields per category); inherited fields say so. Saving without a required detail shows it inline. A blank tag becomes `<HD>-AST-00001`.
- [ ] **In Use** without a User or Department is refused inline; picking a past Expiry Date with In Stock warns before saving and the API refuses it; "Expired" saves.
- [ ] **Edit:** changing Laptop → Desktop asks to confirm, removes Screen Size and History shows it as removed. History lists created / updated (old → new) / auto-expired (System).
- [ ] **Asset List:** filters and sort live in the URL; dashboard tiles open the list with the same filter; search finds a serial number; pager shows "Showing X–Y of N".
- [ ] **Import:** template download has Instructions / Assets / Lists / Fields by category with drop-downs. A file with good and bad rows saves only the good ones; the import screen lists each failed row with "Column: message"; **Download failed rows** → fix → re-upload imports them. **Check only** saves nothing. "Create missing…" is disabled with a reason without Asset Configuration create.
- [ ] **Report:** group by Category / Location / User shows count, %, cost; **Export to Excel** downloads Summary + Assets (detail columns, frozen header). A name starting with "=" opens as text.
- [ ] **Agent:** can add and edit assets, can't delete or import; settings pages are read-only with the banner. **Requestor:** no Assets section; the API returns 403.
- [ ] Hover help on every icon-only / disabled / jargon control (state type, Expired target, auto-number, inherited field, import options); grep gates in "Hover help / tooltips"; light/dark, 390px (no horizontal scroll), Compact/Comfortable; axe (wcag2a/aa/21aa/22aa) shows no serious/critical issue on any asset page (2026-10-19 run: 10 pages × light/dark clean, after naming the user-picker combobox via `id` + `<label htmlFor>`).

### Bug-fix batch (added 2026-10-18)

About 50 items, fixed in 10 workstreams: approvals, SLA, workflows, fields, reporting, notifications/portal, RBAC, search/KB, ticket detail and the audit log. BUG_LOG has the symptoms and root causes: "2026-10-18 — Bug-fix batch". Skills carry an "Update (2026-10-18) — Bug-fix batch: …" entry at the top of each SKILL.md.

**Deploy pre-checks (run per prod schema; take a backup first):**
- [ ] **pg_trgm location:** `SELECT extname, extnamespace::regnamespace FROM pg_extension;`. `pg_trgm` must be absent or in `public`.
  - `itsm_tickets/0011_search` creates it `WITH SCHEMA public` or moves it there.
  - The DB user needs the privilege to CREATE/ALTER EXTENSION.
- [ ] **Reset mail:** `EMAIL_HOST` and `PLATFORM_NOTIFY_FROM` are set in the backend env. Password-reset mail goes through platform SMTP, From `formataddr(<branding name>, PLATFORM_NOTIFY_FROM)`.
- [ ] **Approval stages:** for every live `ApprovalStage`, `itsm_approvals.services.engine.stage_problem(stage)` returns `None`. Any stage that reports a problem will **block** the transition that starts it (B1). Fix those stages before deploying.
- [ ] **R1, users on soft-deleted roles.** They lose access on deploy. List them per schema and re-assign them first:
  ```sql
  SELECT u.username FROM itsm_rbac_roleassignment ra
  JOIN itsm_rbac_systemrole r ON r.id = ra.role_id
  JOIN accounts_user u ON u.id = ra.user_id
  WHERE r.is_deleted AND NOT ra.is_deleted;
  ```
- [ ] **Mailboxes with create-requestor off and no `default_requestor`:** list them. They must pick a default requestor on their next save (B11 validation).
- [ ] **Migrations, in order** (`migrate_schemas`, every tenant):
  1. `itsm_core/0014_fieldlayout_sections`
  2. `itsm_rbac/0014_backfill_enforced_module_grants`
  3. `itsm_core/0015_admin_audit_event`
  4. `itsm_core/0016_audit_module`
  5. `itsm_tickets/0011_search`
  6. `itsm_knowledge/0002_article_search_indexes`
  7. `itsm_knowledge/0003_flatten_kb_categories`
  8. `itsm_workflows/0009_request_rejected_status`
  9. `itsm_approvals/0003_request_mode_stage_ids_live_level_unique`
  10. `itsm_notifications/0004_approval_and_watcher_events`
  11. `itsm_surveys/0002_comment_required_needs_comment_box`
  12. `itsm_dashboards/0005_savedfilter_helpdesk`
  13. `itsm_dashboards/0006_backfill_savedfilter_helpdesk` (prints counts per schema)

  The data migrations are idempotent. `itsm_rbac/0014` writes explicit grants equal to each role's current effective access, so nobody gains or loses anything.
- [ ] After deploy, users re-fetch `/auth/me` (log out and back in) to pick up `itsm.admin.audit` and the explicit S7 grants.

**Security (critical):**
- [ ] **S8:** `GET /api/v1/t/<org>/users/` without a token → 401/403.
  - A requestor → 403. An agent gets only `id, username, full_name, email`, active users, no bots.
  - `PATCH` / `POST` / `DELETE` → 405.
  - The legacy `/api/v1/[t/<org>/]auth/login|logout|me` routes 404.
  - Grep gate: no frontend write to `/users/`.
- [ ] **A1:** `POST approval-requests/start/` without `itsm.approvals` create → 403; on a ticket in another helpdesk → 404.
- [ ] **A2:** a requestor's `GET approval-requests/` lists only requests on their own tickets or ones they approve.
- [ ] **K1:**
  - A requestor's `GET kb-articles/` returns only published, portal-visible articles.
  - `kb-article-links/` → 403 for non-authors and for a ticket you can't access.
- [ ] **R2:** widget data for a dashboard you neither own nor were shared → 404/403. A project default view pointing at another helpdesk's view is saved as blank (product default).
- [ ] **R3:** routing rules of another helpdesk are invisible. A non-superuser can't write a global rule.

**Approvals & catalog:**
- [ ] **B1:** a stage with no resolvable approver can't be saved (400). For "Requestor's manager", a fallback user is accepted.
  - On an existing broken stage, the transition that starts it fails with a readable 400 and the ticket **keeps its status** (rolled back).
- [ ] **B2:** after a rejection, a "Require approval" transition stays blocked until a new approval is granted.
- [ ] **B3 (parallel mode):** all stages are pending at once, and one approver eligible for two stages completes both with one click.
  - An inactive approval workflow: the transition starts nothing, and the API/catalog start → 400.
  - A superuser's approval completes the stage.
- [ ] **B4:** a catalog item with "Needs approval" and no/inactive workflow can't be saved. Submit is refused before the ticket is created.
- [ ] **U2:**
  - Approve/Reject are visible only to someone who `can_decide`; others see "Waiting for…".
  - A stage broken after start shows `blocked_reason`: Approve is refused, Reject still works.
- [ ] **U3:** inbox ticket numbers link to the ticket (agent and portal). Reject opens a dialog, and a blank reason → 400.
- [ ] **U7:** stages show the approver's name; a stage without one shows a "No approver" badge.
- [ ] **Rejected request:** rejecting moves the ticket (as `automation-bot`) to **Rejected**, a done category.
  - The resolution SLA stops.
  - The reason appears as a comment and in Activity.
  - The requestor gets **one** "rejected" email (not "resolved"/"closed").
  - No CSAT survey is sent.
- [ ] **Reject gate:** an agent can't use the Reject transition unless the latest approval was rejected (`approval_rejected` condition).
- [ ] **Inbox gate:** a role without `itsm.portal.approvals` read gets 403 on `my-pending`/approve/reject. The portal nav, portal home Approvals card and agent approvals bell are hidden. A user with **no role** keeps the inbox.

**SLA & calendars:**
- [ ] **B7:** a holiday marked "Repeats annually" pauses the clock on the same date next year. 29 Feb → 28 Feb in non-leap years.
- [ ] **B8:** a blank target for a priority → no clock for that priority.
  - Changing priority re-targets running clocks (start and pauses kept), withdraws a clock whose new target is blank, and starts missing ones backdated.
  - Finished clocks are untouched.
  - Activity shows the SLA re-target.
  - Covered for: inline edit, impact×urgency, automation `set_field`, bulk, transition `set_priority` / screen priority, escalation raise-priority, and move (re-target only).
- [ ] **B9/C1:**
  - A new calendar gets Mon–Fri 09:00–17:00.
  - A calendar with no hours shows "No working hours", runs 24×7 in its timezone, and never returns "due now".
  - The breach sweep and `/tickets/{id}/sla/` don't 500.
- [ ] **M5:** the queue bar percentage equals the detail panel (business time), and a paused clock's bar doesn't move. Opening the queue issues a constant number of queries.
- [ ] **C2:** delete then re-add the same holiday date or SLA target → 201, not 500.
- [ ] **C3:** resolve from Pending (paused) → the hold time doesn't count; no false breach.
- [ ] **U1:** confirms on holiday delete, window delete / day off (warns about 24×7), and an SLA save that clears a target.

**Workflows & assignment:**
- [ ] **B14:**
  - A new ticket starts at the create transition's target and runs its safe post-functions (assign-if-unassigned, stamps, approval).
  - Running the create transition on an existing ticket → 400.
  - A `from_status=None` non-global transition isn't offered.
  - A second create transition, or a create into Done → 400.
  - The editor requires From, with "Any status (global)".
- [ ] **B17:**
  - A field condition on a field the project lacks is skipped.
  - A cascade condition needs a leaf.
  - Assign / round-robin **never** replaces an existing assignee (all orgs).
- [ ] **U4:** buttons show the target status **name**. A blocked transition is disabled with a Hint naming the reason, and buttons refresh after an inline edit.
- [ ] **U6:**
  - A workflow used by more than one project shows "Shared by N projects".
  - "Make a copy for this project" creates a uniquely named copy, links it and repoints that project's automation rules.
  - Open tickets keep their old workflow.
- [ ] **C5:** deleting a status in use, or the create target → 400. Deleting an unused status removes its transitions. No ticket can move into a deleted status.
- [ ] **Status filter:** the All-Tickets / multi-workflow status filter lists the union of statuses, and a copied workflow's statuses match their originals (`status_lineage_ids`).

**Fields, layouts & forms:**
- [ ] **B5:**
  - A Required field hidden by its rule (or read-only by rule) doesn't block portal or agent submit.
  - Option fields with no options, attachments, deleted fields and inapplicable globals are skipped.
  - Agent create with a missing visible Required field → 400 `{key: [msg]}`, highlighted with "Please fix the highlighted fields."
  - System creates (email, catalog, automation) are unaffected.
- [ ] **B20:** hide a column, reload, re-show it → it returns to its old position. `!key` entries survive both the project Columns tab and the per-user picker.
- [ ] **B21:** a visibility rule with an empty value can't be saved (UI and API 400). Status values come from a select of the workflow's statuses; checkbox values are Yes/No.
- [ ] **B22:** "+ Section" uses an inline name input. An empty section survives reload and can be deleted (with a confirm).
- [ ] **U13 (portal):**
  - Priority isn't pre-selected. With Required on, the requestor must pick one; with it off, a blank becomes P3 server-side.
  - Option-less fields aren't shown.
- [ ] **C5:** deleting a cascade node (the confirm states the descendant count) soft-deletes its children.

**Reporting & dashboard:**
- [ ] **M6:** changing Period changes every history tile but not the **Now**-tagged ones (Open, Needs attention, Backlog, Projects). "Updated HH:mm" shows.
- [ ] **Totals:**
  - The donut total = Created.
  - The sum of resolved per priority = Resolved.
  - A drill-down count = its segment.
  - The trend is zero-filled.
- [ ] **M1:** "Overdue by" is realistic business time (not ≈1 min), plus a "Finished" column. The export has "Overdue by (business min)" + "Finished".
- [ ] **M2:** the SLA headline is per ticket (met only if all its timers met), with `by_metric` for FR and Resolution.
  - Stopped/cancelled timers are excluded; a running timer past due counts as breached.
  - The group filter applies.
- [ ] **M3/M4:**
  - Resolution time is in business hours over tickets resolved in the range, including unassigned ones.
  - Agent performance lists agents with only open work ("Open (now)") and shows full names.
- [ ] **At-risk tiles:** the count equals the amber bars in the queue (same `timer_snapshot`).
- [ ] **B18:** period boundaries are UTC days, so a browser in UTC+5:30 gets the same numbers.
- [ ] **Module gating:** a role without `itsm.reports.sla` sees no SLA tiles/reports, and one without `itsm.reports.agent` no leaderboard. The API returns 403 for those reports.
- [ ] **M7:** the card is titled "Tickets by team". Agent home has a Reports card (`itsm.reports` read), and workspace reports have "All helpdesks ↗".

**Notifications, portal, password reset, surveys:**
- [ ] **S3:** an internal note / private mention / SLA warning or breach never reaches a non-agent watcher or a removed watcher, in-app or email.
- [ ] **G4:**
  - Each newly pending stage's approvers get "Review approval".
  - Granted/Rejected reach the requestor; Rejected carries who decided and the reason.
  - An added watcher gets "you were added" (not when adding yourself).
  - `ApprovalCancelled` is seeded **off**.
- [ ] **Portal read-only:**
  - An approver or watcher opens the request read-only, with a note and the actions hidden.
  - Reply, reopen, watchers, upload and feedback are requestor-only (403). A stranger → 404.
  - "My requests" list/pulse stays requestor-only.
- [ ] **C2:** remove a watcher, then re-add them → 201 (restored), audited `watcher_added`.
- [ ] **U14:**
  - Forgot-password sends a link that is valid for 60 minutes, single-use and bound to the org. A second use or another org's path → invalid.
  - The response is generic either way.
  - No mail for bots, SSO users, unusable-password or inactive users.
  - The login label says "Username or email".
- [ ] **U5:** opening the bell no longer marks everything read. Each item marks itself read and links to the right app (portal vs agent). "Mark all as read" works, and the portal header has the bell.
- [ ] **B6:** turning the comment box off clears "required", and explicitly asking for required with no box → 400. Effective `comment_required(config)` = enabled AND required, so the survey can always be submitted.
- [ ] **B24:** the disabled feedback Submit shows its reason under the button.

**RBAC, saved views, helpdesk admin:**
- [ ] **S2:** the email bot resolves per tenant schema (two orgs in one worker get their own bot).
- [ ] **S5:**
  - A personal view saved in project A doesn't appear in project B.
  - A view shared from helpdesk H's All Tickets reaches only H's members.
  - A forged `?helpdesk=` / `?project=` returns nothing, never 403.
- [ ] **C6:** an agent can delete their own saved view, but not someone else's.
- [ ] **S6:**
  - A built-in role can't be deleted or have its code or active flag changed.
  - A role in use → 400.
  - A superuser or bot can't be deactivated via the API.
  - The console keeps at least one active superuser.
  - The UI shows disabled controls with Hints.
- [ ] **S7:**
  - Without `itsm.tickets.create`, the Create menu / New ticket are hidden and `POST /tickets/` → 403.
  - The Layout tab follows `itsm.fields.layouts:update`, and the Routing buttons follow create/delete.
  - Portal, email and catalog intake are unaffected.
- [ ] **R1:** a user whose role is soft-deleted has no ITSM permissions.
- [ ] **B23:** creating a helpdesk makes you lead. With the checkbox on (the default), INC + REQ projects are imported.
- [ ] **U8:** clicking the active ★ clears your default view.
- [ ] **U10:** admin home shows a User Attributes card, and an inactive helpdesk can be edited.

**Search & KB:**
- [ ] **G6:**
  - Typos match (`printr` finds "Printer jammed": word similarity ≥ 0.6, 3+ characters).
  - Number forms and old (moved) numbers match.
  - Comment text matches, but private comments only for users with `comments_private` read.
  - 1–2 characters fall back to substring on number + summary.
  - Ranking applies only with the default sort.
  - The queue pulse respects the search.
  - Run the two-schema script (`scratchpad/ws8/scripts/check_multischema.py`) on a 2-tenant rehearsal.
- [ ] **B16:**
  - Published articles show "Save & keep published" / "Unpublish & save as draft". `status` can't be PATCHed.
  - A category can't be nested two levels (400); the Parent select is disabled with a Hint.
  - Deleting a category un-categorises its articles and promotes its children.
- [ ] **U12:** Archive / Restore to draft work. The list hides archived unless filtered; the filter offers Active/Draft/Published/Archived.
- [ ] **KB lists:** the agent list shows more than 25 articles (`kbAllPages`), and the Org-wide tile uses `helpdesk__isnull=true`.

**Ticket detail, mentions, email UX:**
- [ ] **U17 (live refresh):**
  - Another agent's change appears within about 15 s when idle.
  - While editing, an "Updated by X — Refresh" pill appears instead, and a half-typed value isn't clobbered.
- [ ] **U17 (stale write):**
  - Two tabs edit the same field: the second save → 409 `stale_write`, and the toast names the attempted value.
  - Automation, email, bulk, transition, assign and portal writes are never 409'd.
  - A custom-field edit bumps "Last updated".
- [ ] **G2:**
  - Typing "@" lists only active agents who are members of the ticket's helpdesk, and the chip renders.
  - The mentioned agent is notified (private-note mentions respect S3).
  - A forged mention id → 403 `{invalid_mention_ids}`.
- [ ] **U11/C4:** the canned picker shows this helpdesk's, org-wide and your personal responses, grouped with scope badges, up to 200.
- [ ] **U16:** the email log shows readable outcome/status labels, with the raw code in the tooltip.
- [ ] **B11:** with create-requestor off, the mailbox form requires an active, non-bot default requestor. The list shows a "No requestor" badge.
- [ ] **Activity feed:** shows `approval_*` (with the reason), watcher added/removed and the SLA re-target.
- [ ] **U1 confirms:** linked-issue remove, routing rule, email routing rule, and allow/block rule.

**Admin & security audit log (G8):**
- [ ] **Recorded:** a change in each `AUDITED_AREAS` area (role, user, helpdesk, project, workflow, field, SLA, notification, email, survey, approval, catalog) appears in Tenant Settings → **Audit log** with before/after.
  - Secrets show as redacted.
  - No-op updates and ticket traffic aren't recorded.
- [ ] **Auth events:** login, failed login, password change and password reset are logged with IP.
  - IP comes from `X-Forwarded-For[-AUDIT_TRUSTED_PROXY_HOPS]`.
  - Console user changes are logged as "Platform admin: <name>".
- [ ] **Export:** CSV export caps at 10k with `X-Audit-Export-Total` / `-Truncated` headers, cells are formula-escaped, and the export is itself logged.
- [ ] **Access:** Supervisor/Agent/Requestor → 403 on `audit-events/`; Admin can read it.
- [ ] Nothing is written in the public schema.

**Verify (build):**
- [ ] Full backend suite on a throwaway PG (serially if the host is loaded; install `tblib` for `--parallel`), and `makemigrations --check` → "No changes".
- [ ] `migrate_schemas` rehearsal with 2+ tenants (data migrations run twice = no-op). `npx tsc --noEmit` plus a Docker `next build`.
- [ ] **Grep gates:**
  - no new `window.prompt`
  - no `/users/` writes
  - the hover-help gates (clean; the one `TooltipTrigger` hit in `ticket-detail.tsx` was a code comment, reworded 2026-10-18)

#### Follow-ups (2026-10-19): N14, N17–N21, N23
- [ ] **Contrast (N14), axe `color-contrast` clean on queue / detail / dashboard / portal detail:**
  - Pink text on a pale pink tint uses `text-primary-ink` (`--primary-ink` 338 100% 38%, about 5.2:1), never `text-primary`. Grep gate: no line has both `bg-primary/(5|10|15)` and a bare `text-primary`.
  - Buttons and fills keep the exact brand pink.
  - Sidebar section headings and "· None" are full `text-muted-foreground`.
  - `text-muted-foreground/NN` is only allowed on decorative icons and separators.
- [ ] **Approvals inbox (N17):** every row has "View request" (portal) / "Open ticket" (agent) beside Approve/Reject. The portal one opens the read-only request page, with a hover hint saying so.
- [ ] **Status chip aliases (N18):**
  - After "Make a copy for this project", a saved filter holding the OLD workflow's status id shows the status name on its chip, and the option is ticked.
  - Unticking it removes the old id too.
  - `filter-fields?project=` status options carry `aliases`.
- [ ] **Mentions (N19):** @mentions render as chips in the portal conversation and as semibold text on the print sheet (Ctrl+P preview). Read-only pages import `components/ui/mention-styles` (not the Tiptap editor).
- [ ] **Relevance cue (N20):**
  - With a search term and the default sort, the Created header shows no arrow (`aria-sort="none"`), its tooltip says results are ordered by best match, and the footer reads "Showing … · sorted by best match".
  - Clicking Created gives oldest first; clicking again returns to best match.
- [ ] **Multi-select (N21):**
  - On the agent create form and the portal request form, a multi-select field is a checkbox list. It saves a list, which shows ticked on the ticket detail.
  - Required: nothing ticked → "… is required."
  - Field settings → "Show this field when" a multi-select **is** X: a picker of its options, with the "includes" hint.
  - The rule fires when X is among the picked values, and stops when it isn't. "is not" is the inverse. Nothing picked = never matches.
- [ ] **Queue footer (N23):** on an empty queue and on a 3-row queue, the "Showing / No tickets" footer sits at the bottom of the viewport, not right under the table. Long queues are unchanged (the table pane scrolls).

### Automation rules: per-project When → If → Then (added 2026-10-18)

The user asked for automation rules in project settings, e.g. "assigned to an agent while New → move to Assigned". This is a new `itsm_automation` app plus the project-settings **Automation** tab. Skill: `.claude/skills/itsm-automation`.

**Rules (check on every change that touches ticket writes or the engine):**
- [ ] **New write path?** If it changes a field a rule could watch, call `hooks.automation_dispatch(...)` at the END of its post-commit callback, with the trigger field keys. Column-backed fields use the column name; value-backed custom fields use `cf:<key>`. Never call the dispatcher directly (rule 12).
- [ ] **Internal callers of `field_service.set_values`** (create, transition screens, move, automation) leave `notify_automation=False`. Only the agent set-fields edit passes `True`.
- [ ] **Automation actions call the existing services** as `get_automation_bot()`. Never write Ticket columns directly: guards, audit and notifications must behave like a manual edit.
- [ ] **Loop guard:** `dispatch()` returns when the actor is the automation bot. Don't add an action that writes as a different user.
- [ ] **Ticket views serialize after `refresh_from_db()`.** on_commit automation runs inside the request, so the response must carry the post-automation status.
- [ ] **New rule conditions are queue `FilterSpec`s.** The serializer must reject anything `query_builder._compile_condition` drops; a dropped condition widens an `all` rule. `"me"` is rejected.
- [ ] **Automated public comments pass `counts_as_response=False`** (they never satisfy the first-response SLA).
- [ ] **Permission:** reads need `itsm.projects:read`; every write needs `itsm.projects:update`. The API is clamped by helpdesk and project scope (another helpdesk's rule → 404, create → 403).

**Verify:**
- [ ] `apps.itsm_automation` tests pass (22, incl. a `TransactionTestCase` for the PATCH response). Also run `itsm_workflows`, `itsm_tickets`, `itsm_core`, `itsm_groups`, `itsm_notifications`, `itsm_sla`, `itsm_surveys`, `itsm_approvals`, `itsm_projects` and `itsm_email`.
- [ ] **Settings → Projects → <Incident> → Automation**
  - **Use template** pre-fills: When = Ticket created + Assignee updated · If = Status is New AND Assignee is not empty · Then = Assign (New → Assigned) with **Keep the current assignee**.
  - **Create rule** shows the rule with the summary "When created or Assignee changed · if … · then run “Assign”".
- [ ] On a **New** ticket, set the Assigned Technician inline.
  - The status badge flips to **Assigned** without a reload, and a toast says "Automation moved this ticket to Assigned".
  - The transition buttons now show Start Progress.
  - The assignee is the agent you picked, not a round-robin pick.
- [ ] **Activity** shows "Automation ran an automation rule · Move to Assigned… — Assign → Assigned".
- [ ] **Recent runs** (history icon) lists the ticket as `success`.
  - Setting an assignee on an In Progress ticket adds **no** run.
  - A transition blocked by a field condition shows `failed` with the condition's message, and the ticket is unchanged.
- [ ] **Validation:** **Create rule** stays disabled with the reason shown (no name, no trigger, no action, incomplete condition or action). The "(create)" transition isn't offered.
- [ ] **Read-only:** a user without `itsm.projects:update` sees the list and runs with a "View only" banner and no edit controls. The API returns 403 on POST.
- [ ] **Hover help:** every icon button (runs, up/down, edit, delete) has an `IconButton` label, the active Switch has a `Hint`, and the When/If/Then and action options have `InfoTip`s (`AUTOMATION_HELP`).

### Hover help / tooltips — every control explains itself (added 2026-10-18)

The user asked: "check if proper tool tips are added across the application, especially in the agent view (list + ticket detail)". The audit found about 400 gaps across the agent app, settings, admin, console and portal:
- icon-only buttons with an `aria-label` only (no hover text)
- disabled controls that never say why
- unexplained domain terms
- truncated text with no `title`

All of it is now covered. This was a frontend-only change.

**Primitives — use these, never hand-roll another tooltip:**
- `components/ui/hint.tsx` → `<Hint label side? wrap?>{child}</Hint>`. This is the app-wide Radix tooltip for one control.
  - **A disabled child is auto-wrapped in a focusable `<span tabIndex=0>`.** Disabled buttons fire no pointer events (`disabled:pointer-events-none`), so a tooltip placed on them never opens. Pass the *reason* as the label while disabled.
  - **It strips the tooltip's `data-state` before it reaches the child** (`KeepChildState`). Without that, a Radix child (Switch, Checkbox, Select / Popover / DropdownMenu / Sheet / Tabs trigger) gets its own `data-state` overwritten: a checked Switch renders unchecked and an open popover trigger loses its open styling.
  - Use `wrap` for display components that don't forward refs.
- `components/ui/icon-button.tsx` → `<IconButton label detail? disabledReason?>`
  - `label` is BOTH the aria-label and the tooltip.
  - It forwards its ref, so it can be a `PopoverTrigger` / `DropdownMenuTrigger asChild` child.
- `components/ui/info-tip.tsx` → `<InfoTip label>explanation</InfoTip>`, the ⓘ "what does this mean?" icon.
  - It opens on hover, focus, **or tap** (Radix tooltips never open on touch otherwise).
  - It swallows click and Enter/Space, so it is safe inside sort buttons, `<label>`s and tiles.
  - Its hit area is 24px (`p-[5px] -m-[5px]`, WCAG 2.5.8). When you add margin, compensate: `ml-[-1px]` reproduces the old `ml-1` gap.
  - It replaced 5 hand-rolled copies.
- `components/ui/tooltip.tsx` — `TooltipContent` is now **portalled** to `<body>`, with defaults `max-w-xs whitespace-pre-line text-left leading-relaxed`. `\n` becomes a line break.
- **Copy lives in `frontend/lib/itsm/help/`:**

  | File | Contents |
  |---|---|
  | `fields.ts` | `FIELD_HELP` + `fieldHelp(def)` = admin `config.tooltip` → built-in → `def.description` |
  | `sla.ts` | `slaTooltip()`, metric / state / RAG text |
  | `status.ts` | Status category help |
  | `format.ts` | Formatting helpers |
  | `queue.ts` | Queue copy |
  | `ticket.ts` | Ticket detail and create-form copy |
  | `dashboard.ts` | Dashboard copy |
  | `reports.ts` | Reports copy |
  | `settings.ts` | Project-settings copy |
  | `admin.ts` | Helpdesk, email, users, roles, console copy |
  | `portal.ts` | Requestor-facing wording |
  | `assets.ts` | Asset Management: state types, auto-expire, import rules, detail-field inheritance (added 2026-10-19) |

**Rules (check on every UI change):**
- [ ] **Icon-only control** → `IconButton` with a verb phrase that names the object ("Remove Priya Raman"). Grep gate: `grep -rn 'size="icon"' frontend/app frontend/components | grep -v ui/icon-button` should be empty.
- [ ] **Disabled control** → tooltip says WHY ("Type a message or attach a file first", "Already using the default layout", "You don't have permission…"). Use `disabledReason`, or a `Hint` whose label switches on the condition.
- [ ] **Destructive action without a confirm** → `detail="Deletes immediately"`. If it confirms, don't say that.
- [ ] **Domain concept** (SLA, KPI, status, config switch, report column) → `InfoTip` with 1–2 sentences describing what the code **actually** does. Verify against the backend before writing a behavioural claim. If the behaviour is wrong, describe the real behaviour and log it in BUG_LOG; never promise the intended one (e.g. annual holidays, reopen window).
- [ ] **Truncated plain text in dense rows** (queue cells, tables, lists) → native `title` (cheap). Radix `Hint` is for actions, icons, disabled reasons and concepts.
- [ ] Don't add noise tooltips that repeat a visible label.
- [ ] **No new `TooltipProvider`.** The one in `app/layout.tsx` (150 ms) is the only one. No new local ⓘ helpers. Grep: `grep -rln TooltipTrigger frontend/app frontend/components | grep -v components/ui/` should list only `workspace-nav.tsx` (collapsed-rail items).
- [ ] **Clickable cards/tiles that contain an ⓘ use the stretched-button pattern** (`TileOverlay` in `report-views.tsx`): a full-size `<button>` behind `pointer-events-none` content, with the ⓘ opted back in via `pointer-events-auto`. A `role=button` div wrapping the ⓘ fails axe `nested-interactive`.
- [ ] Don't put `aria-label` text on a link or button that differs from its visible text (WCAG 2.5.3). Use a `Hint` for the extra explanation instead.
- [ ] Keep components module-level (focus-stability rule). `Hint`, `IconButton` and `InfoTip` all are.

**Verify (2026-10-18 run: 52/52 hover checks, Compact/light + Comfortable/dark, no page errors):**
- [ ] **Queue**
  - Hover New ticket, search, a sortable header ("Click to sort…"), an SLA bar ("Due: … · Target: … (business time)"), and a status badge ("Status: …").
  - Columns → Reset shows "Already using the default layout" while disabled.
  - Keyboard focus also opens tooltips.
- [ ] **Tooltip sits above the sticky toolbar and the z-40 header.** It is portalled; check that `elementFromPoint` at its centre is inside it.
- [ ] **Detail**
  - Watchers / ⋮ / Edit summary.
  - A transition button shows "Move to <status>".
  - Open the composer: "Add comment" disabled says "Type a message or attach a file first".
  - RTE Bold shows "Bold (Ctrl/⌘+B)".
  - SLA panel row explains the clock.
- [ ] **Dashboard**
  - Every KPI/tile/chart has an ⓘ.
  - Clicking a tile's ⓘ shows the tip and does **not** open the drill-down; clicking the tile still does.
- [ ] **Radix state preserved under `Hint`:** every `button[role=switch]` has `data-state` matching `aria-checked` (Users list), and Columns trigger `data-state=open` while open.
- [ ] **Settings → Workflow:** status delete shows "Deletes immediately".
> **Updated 2026-10-18:** status and transition deletes now **confirm** (U1), and an in-use or start status can't be deleted (400). Their hint no longer says "Deletes immediately".
- [ ] **Portal:** header controls all have accessible names at 390px, and the login "Username" ⓘ mentions email.
- [ ] **axe** (wcag2a/aa/21/22aa) shows no new serious or critical issues. Pre-existing ones still open: nav `SectionLabel` contrast (`text-muted-foreground/70`), `· None` contrast, the Linked-issues `<dl>` holding `<div>/<p>`, and one portal create-request contrast node.
- [ ] Detail side-rail label column is **8rem** (was 7rem). "Assigned Group ⓘ" must stay on one line; "Assigned Technician" already wrapped at 7rem.

### Email intake Mode + one Resolution Notes field (added 2026-10-14)

Client feedback (GridCrest): the Ticket Data report showed **Mode**, **Request Type** and **Resolution
Note** as blank. The report was correct; the data was never stored (see BUG_LOG 2026-10-14). Email
intake now records **Mode = Email**. The global column-backed **Resolution Notes** now also applies to
**Request** projects (`itsm_core/0012`), so there is one note column, not a per-project custom copy.

- [ ] **Email → Mode = Email.** A new email creates a ticket whose Mode shows **Email** on the detail
  view and in the Ticket Data report's Mode column. Replies (comments) don't change Mode. If the Mode
  field's `email` option is deactivated, the ticket is still created (Mode left blank, no error).
- [ ] **Agent/portal create unchanged.** Mode is still whatever the agent or requestor picks (no forced
  value). Source stays `email`/`portal`/`agent` as before.
- [ ] **Resolution Notes on Request projects.** On a Request project (ITREQ/REQ), Settings → Fields and
  the Workflow → Transition settings capture-field picker list **Resolution Notes**. The other ITIL
  fields (Impact, Urgency, Resolution code, Root cause, …) stay hidden on Request projects. Custom
  projects are unchanged.
- [ ] **Fulfil captures into the shared column.** Moving a REQ ticket to Fulfilled with a Resolution
  Notes capture field saves into `Ticket.resolution_notes`. The value shows in the report's standard
  **Resolution notes** column (no extra `cf_` column), and a blank mandatory value is rejected with
  "This field is required for this transition."
- [ ] **Migration 0012 is safe on every tenant.** `migrate_schemas` adds `service_request` to the global
  def's `applies_to` once (idempotent; reverse removes it). Tenants with no `applies_to` tag are untouched.
- [ ] **Diagnosis rule for "blank report column".** Before changing report code, count `FieldValue`
  rows for that field + project in the date range, and open one ticket to compare. Remember that with
  **All projects**, a custom column appears only if ≥1 ticket in range has a value.
- [ ] **Build/tests.** `manage.py check` + `makemigrations --check` clean. `apps.itsm_email`,
  `apps.itsm_core`, `apps.itsm_tickets`, `apps.itsm_workflows`, `apps.itsm_reporting` and
  `apps.itsm_projects` suites pass.

### Problem Management — importable standard project (added 2026-07-24)

A third standard project type **Problem** (`project_type="problem"`, ITIL problem/error control) plus a
**standard-project catalog**: Settings → Projects → **Import standard project** provisions Incident /
Request / Problem into any active helpdesk (one-per-helpdesk). Problem is import-only (never
auto-seeded), agent-only (hidden from the portal), and starts with **no SLA**. See the `itsm-projects` /
`itsm-workflows` / `itsm-fields` / `itsm-tickets` / `itsm-sla` / `itsm-helpdesks` SKILL updates
(2026-07-24).

- [ ] **Import visible + gated.** Settings → Projects shows **Import standard project** only with
  `itsm.projects:create` (Supervisor/Admin); the dialog lists Incident / Request / Problem with
  Enabled badges for installed ones. A forged `POST /projects/import_standard/` as an Agent → **403**
  (create bit); a helpdesk outside the caller's accessible set → **404**, indistinguishable from a
  nonexistent one (no key-existence oracle). `GET standard_templates` blanks
  `installed_project_id/key` for projects outside a non-manager's per-project whitelist (the
  `installed` flag stays).
- [ ] **Import provisions everything.** Importing Problem into IT creates `ITPRB` wired to the
  **Default Problem Workflow** + IT's Service Desk group, with a default "Problem" ticket type
  (`base_category="problem"`), the Problem layout (Problem Assessment / Root Cause & Workaround /
  Resolution Details sections), a notification scheme, a survey config (disabled), a project-scoped
  **"No SLA (default)" policy with zero metrics**, and `ProjectMembership` rows for the helpdesk's
  active members — the tab appears for agents without re-login (after `refresh()`).
- [ ] **One per helpdesk, friendly errors.** A second import of the same template → **400** ("already
  has a …"), not a 500; a squatted key (e.g. a custom project took `ITPRB`) → 400; an inactive
  helpdesk → 400. **The import endpoint is the ONLY path to a standard type**: a plain
  `POST /projects/` (or a PATCH retype) that sets `project_type` to incident/service_request/problem
  → **400** `{project_type: [...]}` (`validate_project_type` — a bare write would bypass the
  provisioning chain and e.g. yield a Problem WITH SLA clocks); keeping an instance's existing
  standard type on PATCH still works; **custom** projects stay unconstrained (DB partial constraint +
  DRF's conditional validator remain the backstop).
- [ ] **Soft-delete lifecycle.** Deleting a standard project then re-importing the template
  **restores the same project row** (same pk/key, `is_deleted=False`, active) — never a dead-end
  "key already in use"; a foreign/custom squatter on the key still 400s. Re-running `seed_itsm`
  with a soft-deleted seeded INC/REQ neither crashes (old `objects`-manager get_or_create raised
  IntegrityError on the key) nor resurrects it (seed skips; only an explicit import restores).
- [ ] **New-helpdesk flow.** A UI-created helpdesk starts with no projects (unchanged, deliberate);
  importing Incident into it yields `<KEY>INC` with starter types — the catalog is the provisioning
  path (user decision 2026-07-24: no auto-seed on helpdesk create).
- [ ] **Problem workflow.** New → Under Investigation ↔ Pending → Known Error → Resolved → Closed.
  **Record Known Error** blocks with **422** until Root Cause is filled (screen-mandatory) and persists
  root_cause / workaround_notes / workaround_provided to the Ticket columns; **Re-analyze** returns a
  known error to investigation; **Resolve** and **Implement Fix** share the Resolution Details screen;
  **Reopen** clears the resolution (code/notes) but **keeps the whole KEDB payload** —
  `root_cause` + `workaround_provided` via `clear_resolution`'s `config.preserve` list, and
  `workaround_notes` (untouched by clear_resolution); the graph passes
  `validate_workflow_graph`. Problem's Reopen is **not** `portal_allowed` (Incident/Request keep it).
- [ ] **Field scoping (`applies_to`).** A Problem project's Fields tab / filter picker offers the shared
  ITIL set (Impact, Urgency, Business Impact, Resolution Code, Root Cause, Workaround Provided,
  Resolution Notes) **plus** Workaround (`workaround_notes`) + Investigation Reason — and **not**
  Major Incident / Users Affected / Service Downtime. An Incident project does NOT offer the two
  problem-only fields. A Request/custom project offers none of the tagged set but still shows
  `cf:mode`/`cf:description` (**JSON-trap regression** — `inapplicable_global_keys` must keep the
  positive `config__has_key` filter). The All-Tickets union surfaces problem-only fields only when a
  helpdesk has a Problem project.
- [ ] **Offered ⇒ it works.** Filtering `cf:workaround_notes contains …` and
  `cf:investigation_reason = Recurring Incidents` matches by the Ticket **column**
  (`MAPPED_COMPILE`); Resolution Code now also offers Risk Accepted / Won't Fix (both projects).
- [ ] **No SLA on problems.** With the tenant default SLA policy present, a new problem ticket starts
  **zero** `SLATracker` rows (no due date, no queue SLA chips); an incident ticket still starts its
  clocks (control). Adding metrics to the project's seeded policy in the SLA tab opts in.
  **⚠️ The seeded policy must be `is_default=False`** — `resolve_policy`'s tenant fallback matches
  is_default policies and `.first()` orders by random UUID, so a second default would coin-flip SLA
  resolution off for EVERY project; the fallback is also hardened to `project__isnull=True`.
- [ ] **Problem fields flow through the API.** `workaround_notes` + `investigation_reason` round-trip
  create → detail → PATCH (they are real Ticket columns: detail serializer, create serializer/view/
  service, PATCH whitelist all carry them); an unknown `investigation_reason` → 400; PATCHing
  `resolution_code` to the new `risk_accepted`/`wont_fix` codes → 200 (choice sets derive from the
  model enums, no hardcoded drift). The detail rail displays both and edits them inline
  (`IMPACT_ASSESSMENT_MAPS_TO` includes the two Problem keys).
- [ ] **"Is empty" works on choice columns.** `cf:investigation_reason is_empty` matches tickets with
  the blank value ("" — char columns never store NULL) and `is_not_empty` the set ones — same fix
  applies to `cf:impact`/`cf:urgency`/`cf:resolution_code` (previously matched nothing/everything).
- [ ] **Portal exclusion (BOTH directions).** The end-user portal (workspaces/projects/intake) never
  lists a Problem project; a requestor cannot reach its layout/create. AND the read path is clamped:
  a problem ticket whose `requestor` is an end user (set by an agent, or arriving via move-ticket)
  never appears in portal "My requests" — list, detail, pulse, survey, transitions and the intake
  `attachments` action all 404/omit it (`PortalTicketViewSet.get_queryset` excludes
  `project__project_type="problem"`). Agent console shows it normally (tabs, queue, All Tickets,
  Create menu — labelled "Problem", shield-alert icon, sorted after Request).
- [ ] **Priority matrix on Problem.** The project settings show the **Priority Matrix** tab for
  Incident AND Problem; setting Impact+Urgency on a problem ticket auto-derives Priority (server +
  live form) exactly like an incident.
- [ ] **Linking.** An incident links to a problem with **causes / is caused by** (both directions
  render); no new link types needed.
- [ ] **Multi-tenancy.** Migrations run per schema via `migrate_schemas`: `itsm_projects/0010`
  (enum + constraint), `itsm_workflows/0008` (base_type), `itsm_tickets/0010` (columns + resolution
  codes), `itsm_core/0011` (**data**: `incident_only` → `applies_to` retag + 2 new defs + 2 options —
  must land with the code or ITIL fields leak into request/custom pickers). Existing tenants get the
  Problem *workflow* via `ensure_problem_workflow` self-heal on first import (no data migration).
  `seed_itsm` stays idempotent (re-run adds nothing, keeps admin overrides).
- [ ] **Gates:** `manage.py check` + `makemigrations --check` clean; `tsc --noEmit` + `next build`
  clean; suites green: `apps.itsm_projects` (`StandardProjectImportTests`), `apps.itsm_workflows`
  (`ProblemWorkflowSeedTests`), `apps.itsm_tickets` (`ProblemFieldScopingTests`,
  `ProblemColumnFilterCompileTests` + pre-existing `FilterFieldRegistryScopingTests` unchanged).

### Queue columns — sortable Requestor / Group / Project / Created-by / Updated-by + custom fields (added 2026-07-24)

Fixes the report that several queue headers had no sort caret (screenshot: Requestor, Module, Group,
Type). A column sorts only when its `queue-columns.tsx` def has a `sortKey` AND the server accepts that
`ordering=` term. Built-ins got the missing aliases; **every value-backed custom field of an orderable
type** is now sortable too (people columns sort by display **name**, not FK id). No migration. See the
`itsm-tickets` / `itsm-core` / `itsm-fields` SKILL updates (2026-07-24).

- [ ] **Built-in headers sort.** On a project queue, **Requestor**, **Group** (assigned_group),
  **Created by**, **Updated by**, and (in All Tickets) **Project** show a sort caret and cycle asc → desc
  → default on click. **Priority/Status/Assignee/Created/Updated/ID/Summary** unchanged. (Note: the
  screenshot's **Type** and **Module** columns on `int`/DEV are **custom fields** `cf:type` / `cf:module`,
  not the `ticket_type` built-in — they're covered by the custom-field row below.)
- [ ] **People sort by NAME, not id.** Sorting Requestor / Assignee / Created-by / Updated-by orders by
  the displayed name (`full_name`, else `username`) — e.g. "Amy" before "Zoe" — not by the underlying
  integer user id. Group sorts by group name; Project by project name.
- [ ] **SLA bars are NOT sortable (intended).** Response SLA / Resolution SLA headers have **no** caret
  (computed per row from the tracker payload, no DB column) — this is deliberate, not a miss.
- [ ] **Custom-field columns sort.** Add a custom-field column of a value type (text / number / date /
  checkbox / dropdown / radio / user_picker) → its header is clickable and `?ordering=cf:<key>` orders the
  list by the **displayed** value (dropdown by option **label**, user_picker by **name**, not the stored
  code/id). Tickets with no value sort last (ASC). Works in a single-project queue AND All Tickets.
- [ ] **Unsortable custom types have no caret.** A **multiselect / cascade / group_picker / rich-text /
  attachment** column renders a plain header (no sort) — a joined list / HTML blob has no sane order. A
  `maps_to` system field is never a `cf:` column anyway.
- [ ] **Forged / stale ordering never errors.** `?ordering=cf:nope` (unknown), `?ordering=cf:<foreign>`
  (a field outside the caller's project scope), or `?ordering=cf:tags` (an unsortable type) all return
  **200** and fall back to the default order — never 400/500. A saved/bookmarked queue URL with a
  since-changed cf key still loads.
- [ ] **Combined-queue ambiguity is safe.** In All Tickets, a `cf:<key>` that resolves to **different
  types** across projects is dropped from ordering (not applied ambiguously); a same-type key unions
  correctly. At most **2** `cf:` ordering terms are honoured per request (`CF_ORDERING_LIMIT`).
- [ ] **Scope holds.** `_annotate_cf_ordering` looks up the field only within the caller's accessible
  projects — sorting by a cf column never widens the row set or leaks another helpdesk's field.
- [ ] **One rule, one place.** Cf sortability is `field_service.CF_SORTABLE_TYPES`; the FE trusts the
  server's `ordering_key` and never guesses from the field type in `queue-columns.tsx`.
- [ ] **Gates:** `manage.py check` + `makemigrations --check` clean (no model change); `tsc --noEmit` +
  `next build` clean; `apps.itsm_tickets` green incl. `TicketFilterApiTests` (requestor/group/cf sort,
  unsortable-no-key, unknown-cf-ignored).

### Queue layout — toolbar flush under the header + page details on top (added 2026-07-24)

> **Updated 2026-10-15 (density pass):** the `-mt-6`/`py-6` coupling is gone — the queue uses the density tokens (`-my-main-y`, `top-header`, `-mx-main-x`, `h-[calc(100dvh-var(--header-h))]`). Check the items below in BOTH densities; see the 2026-10-15 section at the end.

Vertical-space cleanup on the agent queue (`components/tickets/ticket-queue.tsx` → `QueueView`, shared by
the single-project queue and All Tickets). The empty strip above the sticky toolbar is reclaimed
(`-mt-6` cancels `<main>`'s `py-6`), "Showing X–Y of N" moved from the footer pager up beside the project
name, and the footer band renders only when there's more than one page.
> **Updated 2026-10-19:** superseded. Since 2026-10-18 the count lives in an always-rendered footer band (bottom-left), and since 2026-10-19 that band is pinned to the viewport bottom with `mt-auto` (N23). While a search is relevance-ranked, the count adds "· sorted by best match" (N20). Markup/CSS only — no backend,
API, state or RBAC change. See the `itsm-tickets` SKILL update (2026-07-24).

- [ ] **No empty strip under the header.** Open `…/w/<hd>/p/<KEY>` — the toolbar band (title/search/
  Columns/New ticket + filter row) starts **immediately** below the 56px workspace header, with no white
  gap above it. Same on **All Tickets** (`…/w/<hd>/all`).
- [ ] **Sticky behaviour unchanged (the invariant).** Scroll the table: the toolbar stays parked at
  `top-14` flush under the header (no overlap, no gap, no jump on the first scroll), the header still
  paints above it (z-40 > z-30), and the Columns / filter-chip / saved-views popovers still open above
  the band (they portal to `body`).
- [ ] **No jump when the live-refresh pill appears.** Have another agent create a ticket while you sit
  mid-scroll so the "N new tickets · Refresh" pill renders — the toolbar must **not** shift down. (The
  `-mt-6` lives on `QueueView`'s outer wrapper, not the band: `space-y-4` out-specifies a `-mt-6` on the
  band once a sibling precedes it.)
- [ ] **⚠️ `-mt-6` is coupled to `<main>`'s padding.** It cancels `workspace-chrome.tsx`'s
  `<main className="… py-6">`. If that padding changes, update the queue's `-mt-6` to match, and never
  copy it onto a component that is **not** the first thing in `<main>` (it would eat the element above).
- [ ] **Page details render beside the project name.** Row 1 reads `DEV · Showing 1–24 of 24` (muted,
  small) with search/Columns/New ticket still right-aligned. The count **updates on page change** (page 2
  → "Showing 26–50 of …"), on filter/search change, and after a live silent refresh.
- [ ] **No "No tickets" flash.** On first load (skeleton rows showing) the count area is **blank**, not
  "No tickets"; a genuinely empty result shows **"No tickets"** next to the title. The text keeps
  `aria-live="polite"` so screen readers still hear the count change.
- [ ] **Footer pager only when it's needed.** A queue whose results fit one page (e.g. 24 of 24) shows
  **no bottom band at all** — the table is the last thing on the page. With >1 page the band returns,
  right-aligned, still **frozen to the bottom** of the viewport, and Prev/numbers/Next work as before.
- [ ] **Live-refresh pill unaffected.** The "N new tickets · Refresh" pill still floats bottom-centre and
  is not hidden by (or overlapping) the pager, in both the single-page and multi-page cases.
- [ ] **Long titles wrap sanely.** A long project name (All Tickets, or a wordy project) wraps the count
  onto the next line **with** the title (`gap-y-2`) rather than pushing the search/Columns/New ticket
  cluster off-row; narrow/mobile widths still stack without horizontal overflow.
- [ ] **Gates:** `npx tsc --noEmit` clean; `npm run build` (`next build`) compiles both queue routes —
  no migration, no backend test impact (nothing outside the frontend component changed).

### Queue filters — registry conditioned on what's configured (added 2026-07-16)

The filter picker ("More filters" → "Find a field…") listed **21** custom fields on `int`/ONE/DEV where only
4 are DEV's. **Helpdesk scoping was never the bug** — `filter_fields` already clamps by
`resolve_helpdesk_scope` ∩ accessible projects (there's a superuser test proving no cross-helpdesk leak).
The cause: `FieldDefinition` has **no helpdesk FK**, so `project=null` defs are global to the whole tenant.
The registry now lists only fields **actually present** on the in-scope projects, and every field it offers
actually filters. See `itsm-fields` (2026-07-16b) / `itsm-tickets` / `itsm-core` SKILL updates.

- [ ] **Conditioned on project type.** A **non-Incident** project (service_request / custom) shows **no**
  ITIL fields (Impact, Urgency, Major Incident, Business Impact, Users Affected, Service Downtime,
  Resolution Code/Notes, Root Cause, Workaround). An **Incident** project shows them. On `int`/DEV the
  custom list is exactly **Category, Mode, Module, Type, Description** (21 → 5).
- [ ] **Combined = union of the helpdesk's projects.** `?helpdesk=<key>` surfaces an ITIL field only when
  ≥1 **Incident** project is configured in that helpdesk (e.g. `IT` has `ITINC` → shown; a helpdesk with
  only custom/request projects → hidden). Rule (a) single-project and (b) All-Tickets share ONE code path
  (`filter_fields_payload_multi` calls `custom_field_payload` per project).
- [ ] **No built-in duplicates.** `cf:priority` / `cf:requestor` / `cf:assignee` / `cf:assigned_group` /
  `cf:source` / `cf:summary` are **not** listed under "Custom fields" — but the **Standard** Priority /
  Requestor / Assignee / Group / Source / Summary (and Created at / Created by) **are** still there and
  still work. This is de-duplication, **not** a dropped capability.
- [ ] **Offered ⇒ it works.** Filtering an Incident by **Impact = High** returns the matching tickets (it
  matched **nothing** before — a `maps_to` field has no `FieldValue`). Also check `Major Incident is true`,
  `Users Affected > 10`, `Description contains …`. A **legacy SavedFilter** holding `cf:priority` now
  behaves exactly like the Standard `priority` filter instead of silently matching nothing.
- [ ] **One rule, one place.** The `incident_only` exclusion lives in
  `field_service.hide_inapplicable_globals` and is used by BOTH `FieldDefinitionViewSet` (Fields tab +
  layout palette) and `filter_fields.custom_field_payload`. Don't re-implement it at a call site.
- [ ] **⚠️ JSON-exclude trap.** Resolve `incident_only` keys with a **positive** filter, then exclude by
  key. A direct `.exclude(project__isnull=True, config__incident_only=True)` drops **every** global field
  (missing JSON key → NULL → `NOT(TRUE AND NULL)` is NULL → row filtered out). Regression: a non-Incident
  project must still show `cf:mode` / `cf:description` / its own fields.
- [ ] **`?project=` is access-checked.** `GET tickets/filter-fields/?project=<uuid-from-another-helpdesk>`
  → **403** (`is_project_accessible`); an in-scope project → 200. Previously any authenticated user could
  read any project's field names/types/option labels.
- [ ] **Gates:** `manage.py check` + `makemigrations --check` clean (**no model change**); `tsc --noEmit`
  clean (frontend untouched — `field-picker.tsx` renders whatever the server returns);
  `apps.itsm_core` + `apps.itsm_tickets` green incl. `FilterFieldRegistryScopingTests`,
  `MappedColumnFilterCompileTests`, and the pre-existing `CombinedQueueApiTests` no-leak/union tests.

### Queue columns — only value-backed custom fields are column options (added 2026-07-16)

Bugfix on the 2026-07-15 feature: the Columns pickers were built from the **filter** registry, so every
column-backed (`config.maps_to`) global system field (Priority / Requestor / Assignee / Assigned Group /
Description / the ITIL + Resolution set) showed up as a `CUSTOM` column option — each would render a
**permanently blank** column (a `maps_to` field has no `FieldValue`) and duplicate its built-in
counterpart. See `itsm-fields` SKILL update (2026-07-16).

- [ ] **Only value-backed fields are offered.** Project → Settings → **Columns** and the queue's
  **Columns** picker list a custom field ONLY when it stores a `FieldValue` — i.e. **not**
  `config.maps_to` and not `NO_VALUE_TYPES` (attachment). On `int`/DEV that means exactly **Category,
  Mode, Module, Type** — *not* Impact / Assigned Group / Assigned Technician / Description / Priority /
  Requestor / Business Impact / Major Incident / Urgency / the Resolution set.
- [ ] **One shared rule.** Both pickers gate on `isColumnEligibleCf` (`queue-columns.tsx`); the backend
  tags entries via `custom_field_payload` → `maps_to` and validates with
  `filter_fields.column_cf_keys(projects)`. Don't re-test `maps_to` by hand at a call site.
- [ ] **Server rejects a forged key.** `PATCH projects/{id}/ {queue_columns:["cf:impact"]}` (or the
  helpdesk `combined_queue_columns` equivalent) **drops** it — a `maps_to`/unknown `cf:` key never
  persists. A legitimate value-backed key (e.g. `cf:type`) round-trips untouched.
- [ ] **Same rule in the combined queue.** The All-Tickets **Columns** picker and the helpdesk
  **All-Tickets Columns** page exclude `maps_to` fields too (this bug also affected the pre-existing
  combined queue, live since 2026-07-01).
- [ ] **Legacy stored keys don't break.** A `cf:` key already saved for a `maps_to` field still renders
  a sane header (`cfLabels` covers every `cf:` key) and a blank cell — never a raw key or a crash; the
  next save strips it.
- [ ] **Filter registry unchanged (deliberate).** The `maps_to` fields are still listed as **filters** —
  the payload change is additive. ⚠️ Those filters are **broken pre-existing** (`_compile_custom`
  queries `FieldValue`, so `cf:impact` matches nothing) — a separate open decision, not this fix.
- [ ] **Gates:** `tsc --noEmit` clean; `makemigrations --check` clean (**no** model change);
  `apps.itsm_helpdesks` + `apps.itsm_projects` green.

### Queue columns — custom fields + helpdesk All-Tickets default (added 2026-07-15)

Two gaps in the queue-column system. (1) The per-project **Columns** tab (and the single-project
queue's own "Columns" picker) only offered the 14 built-in columns — a project's **custom fields**
could never be a queue column, even though the `cf:<key>` render/`?cf=` machinery already existed
and was wired *only* to the combined queue. (2) The combined **All Tickets** queue resolved its
columns from **per-user localStorage only**, with no admin-managed helpdesk-level default. Fix:
un-gate `cf:` columns for single-project scope; add `Helpdesk.combined_queue_columns` +
a new **Settings → All-Tickets Columns** page (admin default, agent override). Chosen scope is
**columns-only** — no cross-project field aliasing (the union stays key-based). See `itsm-fields` /
`itsm-tickets` / `itsm-projects` / `itsm-helpdesks` SKILL updates (2026-07-15).

- [ ] **Custom fields in the project Columns tab.** Project → Settings → **Columns**: the project's
  custom fields appear as toggleable rows (labelled, with a `custom` badge) below the built-ins.
  Enable one, **Save layout**, open that project's queue → the column shows with **display-ready**
  values (dropdown→option label, user_picker→name, checkbox→Yes/No), **blank** where unset — never
  an error, never the raw stored value/id.
- [ ] **Single-project queue picker offers custom fields.** The queue toolbar **Columns** popover
  (per-agent override) now lists the project's custom fields too, independent of the project default;
  selecting one sends it as `?cf=cf:<key>` and the list batch-attaches `custom_values` (no N+1, capped
  `CF_COLUMN_LIMIT=12`) — same path the combined queue already used.
- [ ] **Stale keys don't break the table.** A `cf:` column for a since-deleted field renders a blank
  cell (survives by prefix in `resolveQueueColumns`/`resolveCombinedColumns`), and
  `ProjectWriteSerializer.validate_queue_columns` / `HelpdeskWriteSerializer.validate_combined_queue_columns`
  drop unknown built-ins + `cf:` keys not defined on the scope (via the shared
  `filter_fields.clean_queue_columns` / `QUEUE_COLUMN_KEYS`), preserving order, no dupes. On **create**
  (no instance) custom keys are kept as-is (catalog seeded right after).
- [ ] **Helpdesk All-Tickets default (admin).** Settings → **All-Tickets Columns** (HelpDesk
  Configuration group; gated `itsm.admin.helpdesks:update`, else `ReadOnlyBanner` + a forged PATCH →
  **403**). Pick built-ins + a custom field from the **union** of the helpdesk's projects (blank where
  a project doesn't define it), Save → persists to `Helpdesk.combined_queue_columns`.
- [ ] **Precedence + override.** All Tickets resolves columns **agent localStorage override →
  helpdesk `combined_queue_columns` → built-in `COMBINED_DEFAULT_COLUMNS`**. An agent with no override
  sees the admin default; an agent who customizes wins; the picker's **Reset** returns to the helpdesk
  default (not the product default). The helpdesk default rides the slim `/me` payload
  (`build_helpdesk_membership`) so the queue applies it with no extra fetch; saving calls
  `useWorkspace().refresh()` (→ `refreshUser()`) so it updates live.
- [ ] **Scope holds (no leak).** All Tickets still shows only the agent's accessible projects in the
  helpdesk; a `cf:` column defined on one project is blank (not an error) for other projects' rows.
- [ ] **Reuse (no duplication).** The project Columns tab and the helpdesk page render **one** shared
  `QueueColumnEditor` (in `column-layout-editor.tsx`), differing only by field source / base default /
  persistence. All cell + editor sub-components stay module-top-level (focus-stability rule).
- [ ] **Multi-tenancy / build / tests.** `Helpdesk.combined_queue_columns` is a **TENANT** app field
  (`itsm_helpdesks`); migration `0004_helpdesk_combined_queue_columns` runs per org via
  `migrate_schemas`. `makemigrations --check` clean; `manage.py check` clean; `tsc --noEmit` clean;
  `next build` compiles `settings/columns`. Backend suites green: `apps.itsm_helpdesks`,
  `apps.itsm_projects` (validator round-trips built-ins + live `cf:`, drops stale/foreign),
  `apps.itsm_tickets` (single-project `?cf=` batch-attach regression).

### Workflows — Create & link a new workflow (added 2026-07-13)

Fixes the dead-end where a project with no workflow could only *pick* a pre-seeded one — there was no
way to create a workflow. New `POST /workflows/create_starter/` builds a minimal valid graph; the UI
creates + links it. See the `itsm-workflows` / `itsm-projects` skills.

- [ ] **Backend service is the write site** — `itsm_workflows/services/starter.py::create_starter_workflow`
  is `@transaction.atomic`; the view action does no business logic (rule 4).
- [ ] **Starter is VALID + USABLE** — result has one `is_initial` status, a create transition
  (`from_status=null`), ≥1 Done status; `validate_workflow_graph(wf)["valid"]` is True; a ticket can be
  created on a project linked to it (no `ValueError: no initial status`).
- [ ] **No migration** — reuses existing models + the seeded three `StatusCategory` rows (never creates
  a category); `is_default=False` so it stays project-specific (seed won't hand it to other projects).
- [ ] **RBAC** — `create_starter` is a POST ⇒ the `create` action on `itsm.workflows`; a user without
  that grant gets **403** and no workflow is created. Linking (`projectsApi.update`) needs
  `itsm.projects:update` — the "Create workflow" button requires **both** perms.
- [ ] **Frontend** — `CreateWorkflowDialog` is a module-scope component (not defined inside another —
  focus-loss rule); calls go through `lib/itsm/api.ts` (`workflowsApi.createStarter`); errors via
  `toast.error`; busy state on the Create button.
- [ ] **Workflow tab** re-renders into the new graph after create (via `useWorkspace().refresh()`);
  **Overview tab "+ New"** appends+selects the workflow and requires **Save changes** to persist the link.
- [ ] `blank name → 400`; unknown `base_type` coerced to `custom`.

### Dashboard — interactive drill-down + accurate attention (added 2026-07-10)

The workspace command-center dashboard (`…/w/<hd>/dashboard`) became **interactive**: every chart
segment, hero count KPI, and "Needs attention" tile drills into the actual tickets. Fixes the report
"the chart says 9 unassigned but there's no way to reach those 9 tickets". Backend = new
`itsm_reporting` helper reports (no model/migration); frontend = optional interactivity props on the
shared chart primitives + a `DrillDownSheet` slide-over + a dashboard rewrite. See `itsm-dashboards` /
`itsm-reporting` SKILL updates (2026-07-10).

- [ ] **Every mark drills.** Clicking a status donut slice, a priority/team/source bar, a backlog-aging
  bar, the Open/Created/Resolved KPI, or any Needs-attention tile opens a **right slide-over** listing
  the matching tickets; each row deep-links to that ticket's detail (closes the sheet on nav). A tile
  with value 0 is **not** clickable (nothing to show).
- [ ] **Panel count == tile/segment count.** The slide-over header ("N tickets" / "Showing 50 of N")
  matches the number on the clicked mark. Attention drills are **open-scoped** (`status_category in
  [todo,in_progress]`) so "Unassigned (open) = 9" opens exactly those 9 (not resolved unassigned too).
- [ ] **Open in queue keeps the filter.** The slide-over's **Open in queue** button lands on the queue
  (`…/all` for All-projects, `…/p/<key>` for one project) pre-filtered to the same set via `?q=`/`?view=`
  — the queue hydrates from the URL. Status→`{status eq id}`, Priority→`{priority eq p#}`,
  Team→`{assigned_group eq id}` (or `is_empty` for Unassigned), Source→`{source eq code}`,
  Backlog→open + `{created_at between/before}`, Overdue→`view=overdue`, Open KPI→`view=open`.
- [ ] **Accurate attention (the core fix).** Unassigned / Overdue / SLA at-risk / SLA breached come from
  the server `attention-summary` report over the WHOLE scoped OPEN backlog — NOT a client count of the
  first page of tickets. Create >25 unassigned open tickets in one project → the tile shows the true
  total (the old build capped at 25). The dashboard no longer fans out `ticketsApi.list({project})`.
> **Updated 2026-10-18:** both now use `sla_engine.timer_snapshot` (business time on the ticket's calendar, shared per-request calendar cache), not a wall-clock fraction. They still agree with each other. See "Bug-fix batch (2026-10-18)".
- [ ] **SLA tiles match the queue RAG.** `attention-summary` classifies at-risk (amber) / breached (red)
  with the SAME cheap wall-clock fraction as the queue list serializer (`_list_sla_entry`) — no
  business-time read. A ticket amber in the queue is counted at-risk here; a breached one counts breached
  (and the SLA-breached panel is **open-only**, distinct from the historical `sla-breach-list` report).
- [ ] **Helpdesk scope holds (Guard 5/6).** `attention-summary` / `sla-at-risk-list` /
  `sla-breached-open-list` / `by-source` all go through `reports._base` (helpdesk + project clamp), so an
  agent never sees another helpdesk's counts/tickets; `?project` on the dashboard narrows correctly.
  (Covered by `DashboardDrilldownReportTests.test_attention_respects_helpdesk_clamp`.)
- [ ] **Interactivity is additive (no regression).** `onSlice`/`onBar`/`onClick` on `DonutChart`/
  `BarList`/`AlertTile`/`KpiCard` are OPTIONAL — the global + workspace **reports** pages pass none and
  render exactly as before. Donut hover swaps the center label; `DualTrendChart` shows a per-date
  tooltip. All marks are keyboard-activatable (Tab + Enter/Space) with a visible focus ring; the
  slide-over closes on Esc / overlay click.
- [ ] **Focus stability.** No sub-component is defined inside another component's body — the keyboard
  wrapper is the module-level `activate()` helper, and `DrillDownSheet` / chart primitives are all
  module-top-level (prevents remount/focus-loss; see the React Component Stability rule above).
- [ ] **Live refresh unaffected.** The dashboard still silently re-computes via `useLivePoll` on a pulse
  change (no skeleton flash); opening/closing a drill-down never triggers a spurious full reload, and a
  stale drill fetch is dropped by a monotonic seq guard.
- [ ] **Export endpoint doesn't 500.** The dashboard-only list reports (`by-source`, `sla-at-risk-list`,
  `sla-breached-open-list`) are in `REPORTS` (so `/reports/<name>/export/` resolves them) — hitting that
  URL with matching data must return a file, not a 500. `export._section` renders any list-of-dicts
  report as a generic table (also fixes the pre-existing `csat-responses` export crash).
- [ ] **Build gates:** `tsc --noEmit` clean; `next build` compiles the dashboard route;
  `makemigrations --check` clean (no model change); `python manage.py test apps.itsm_reporting` green
  (25 tests, incl. `DashboardDrilldownReportTests`).

### Move ticket between projects (added 2026-07-03)

Agent action on the ticket detail (⋮ menu → **Move ticket**) that re-homes a ticket into another
project **in the same helpdesk** (JIRA-style: pick project → map fields → confirm). Re-keys
`ticket_number` from the target's `TicketSequence`, re-points `project`/`ticket_type`/`workflow`/
`status`, remaps or **drops** value-backed custom fields, writes a `TicketNumberAlias` so the old
number auto-redirects, and logs `ticket_moved`. Comments/attachments/watchers/links/history ride the
ticket UUID and are untouched. Decisions: **SLA clocks are kept as-is** (not restarted); a **pending
approval** is allowed — it is cancelled and the ticket lands on the target's **start** status. See
`itsm-tickets` SKILL update (2026-07-03).

- [ ] **Gating (agent console only).** The **Move ticket** item appears only for a role with
  `itsm.tickets.move` create (seeded to **Agent + Supervisor + Admin**); a role without it never sees
  it and a forged `POST tickets/{id}/move/` → **403**. The end-user **portal never** shows the action.
- [ ] **Same-helpdesk target.** The Step-1 picker lists only same-helpdesk projects (from
  `useWorkspace().projects`). Server-side, a cross-helpdesk/inaccessible target → **403**
  (`is_project_accessible`); an accessible-but-different-helpdesk target (e.g. a superuser) → **400**;
  moving to the same project → **400**.
- [ ] **Re-key + source sequence untouched.** The moved ticket's number is fresh from the **target**
  sequence (starts with the target key); the source project's `TicketSequence.last_number` is unchanged
  (a vacated number is never reissued). Two concurrent moves into one target get **distinct** numbers.
- [ ] **Alias + URL auto-redirect.** A `TicketNumberAlias(old_number → ticket)` row is written (unique
  `old_number`). Opening the **old** agent URL (`/…/p/OLDKEY/OLD-N`) or old **portal** URL, or the old
  UUID, resolves via `TicketNumberLookupMixin` and the detail page **canonicalises** the URL
  (`router.replace` to the new `/…/p/NEWKEY/NEW-N`). Moving twice keeps **both** old numbers resolving.
- [ ] **Email threading of old numbers.** An inbound reply quoting the **old** `[KEY-N]` in the subject
  (to the original mailbox) threads onto the moved ticket via the alias (does **not** open a new
  ticket); header-map (In-Reply-To/References) threading still works; plus-address stays
  participant-gated.
- [ ] **Custom fields map or drop (with warning + confirm).** A source project-scoped field auto-maps
  to the target **only** when key + type match **and** (for dropdown/radio/multiselect/cascade) every
  stored option value exists in the target field; otherwise the value is **dropped**. Step 2 highlights
  each dropped value ("This value will be dropped"); Step 3 lists them for confirmation. Global
  (`project=null`) fields are untouched; the per-project **category** drops (re-set it on the moved
  ticket). No orphaned/duplicate-key `FieldValue` (source rows soft-deleted; remapped values re-written
  onto the target field).
- [ ] **Workflow/status + approvals.** `workflow` re-points to the target default; a normal move lands
  on the same-**category** status (agent-overridable, auto-suggested); a **resolved/closed** ticket does
  not silently reopen (`resolved_at`/`closed_at` stay consistent with the landing category; no
  `reopen_count` bump). A ticket with a **pending approval** still moves — the approval is **cancelled**
  (audited `approval_cancelled`) and it lands on the target **initial** status (never frozen).
- [ ] **SLA kept.** Existing `SLATracker` rows are **not** voided and **no** new clocks are started
  (keep-existing-clocks decision) — the ticket keeps exactly one tracker per metric it already had.
- [ ] **Assignment + priority.** A group not on the target's `allowed_group_ids` is reset to the
  target `default_group` and a now-invalid assignee is cleared (audited). Priority is recomputed from
  the target `priority_matrix` when Impact+Urgency are set (never blanked).
- [ ] **Retention + queues.** Comments, attachments (files not relocated — path keyed by UUID),
  watchers, links, and the full activity feed remain. The ticket leaves the source queue/saved views and
  appears in the target (and combined "All Tickets"); `updated_at` bumps so `pulse` refreshes both.
  Linked-issue cards on both ends show the new number/project/helpdesk (recomputed live). The activity
  feed shows a `ticket_moved` row (old → new project, old → new number).
- [ ] **Multi-tenancy / build / tests.** `TicketNumberAlias` is in a **TENANT** app (`itsm_tickets`);
  `migrate_schemas` creates it per org; the new `itsm.tickets.move` module is backfilled per schema
  (`itsm_rbac/0009`). `makemigrations --check` clean, `manage.py check` clean, `tsc --noEmit` clean.
  New tests: `apps.itsm_tickets.tests` `TicketMoveServiceTests` (16) + `TicketMoveApiTests` (8) green.

### Tickets — Delete moved into a "More" (⋮) menu + Print (added 2026-07-03)

The exposed red **Delete** button in the ticket-detail header was replaced by a compact **⋮ More
actions** kebab menu holding **Print** and **Delete ticket**. Print is a new, self-contained,
dependency-free feature. Frontend-only (`components/tickets/ticket-detail.tsx` + `app/globals.css`);
no backend/serializer/migration change. See `itsm-tickets` SKILL update (2026-07-03).

- [ ] **Menu replaces the button.** The header action cluster shows a **⋮** icon button at the end
  (after Watchers / Attachments / transition buttons); the standalone red Delete button is gone.
- [ ] **Print — RBAC-gated (2026-07-04).** **Print** appears only when
  `hasPerm("itsm.tickets.print","read")` — default **Agent + Supervisor + Admin** (Requestor none),
  revocable per role in the roles matrix. The **⋮** menu renders only when at least one of
  Print / Move / Delete is permitted; each item is independently gated.
- [ ] **Delete ticket — gated.** **Delete ticket** appears **only** when
  `hasPerm("itsm.tickets","delete")` (Supervisor/Admin); an Agent without it doesn't see the item.
- [ ] **Delete unchanged behaviour.** Clicking **Delete ticket** still prompts `window.confirm`,
  soft-deletes via `ticketsApi.remove`, toasts success, and routes back to the queue (no hard delete;
  backend/RBAC untouched).
- [ ] **No blank pages (2026-07-04).** The sheet is portaled to `<body>` and print CSS does
  `body > *:not(#ticket-print){display:none}` — the preview is exactly as many pages as the content,
  with **no trailing blank pages** (regression from the old `visibility:hidden` approach).
- [ ] **Prints ALL on-screen fields (2026-07-04).** Every visible layout field (main + sidebar) prints
  via `fieldValue()` — Category, VIP User, UserLocation, Priority, custom + ITIL fields — **plus** the
  **Requestor profile** attributes, the **Details** block (Type/Created/Created by/Last updated/Updated
  by), and public comments. Sidebar nav, workspace header, action buttons, tabs and composer are hidden.
- [ ] **Internal notes excluded from print.** Private/internal comments do **not** appear on the sheet.
- [ ] **Dark-mode safe.** Printing while the app is in dark mode still yields black-on-white (no dark
  background bleed — `#ticket-print *{color:#000!important}`).
- [ ] **XSS/altitude.** Printed description + comment HTML come from the server-`bleach`ed
  `description_html`/`body_html` (no client sanitisation added); the dropdown reuses
  `@/components/ui/dropdown-menu` and helpers stay module-top-level.
- [ ] **Delete is RBAC-driven, not hardcoded.** The **Delete ticket** item is gated on the
  `itsm.tickets` **delete** bit (FE `hasPerm`, BE `check_permission` on `TicketViewSet`), editable
  per-role in the roles-admin matrix Delete column — no role/name is hardcoded in the component.
- [ ] **Default grant = lead + admin.** `seed_rbac()` grants `itsm.tickets` delete to **Admin +
  Supervisor** (lead tier) and **not** to Agent/Requestor (Agent is in `AGENT_RW_MODULES`,
  `can_delete=False`). New orgs get this at provision.
- [ ] **Existing tenants backfilled.** Migration `itsm_rbac/0008_grant_ticket_delete_lead_admin`
  reinstates Admin+Supervisor `itsm.tickets` delete idempotently, touching **only** the delete bit
  (hand-edited read/create/update survive); no-op on a fresh schema; graph is linear
  (`0007_module_category → 0008 → 0009_seed_tickets_move_module`).
- [ ] **Print permission (2026-07-04).** New module `itsm.tickets.print` (registry + `AGENT_RW_MODULES`);
  `seed_rbac` grants Agent+Supervisor+Admin; existing tenants backfilled by
  `itsm_rbac/0010_seed_tickets_print_module` (mirrors 0009). Appears as a **Print Ticket** row in the
  roles matrix; revoking it hides the Print menu item (after re-login refreshes the permission map).
- [ ] **Build gates:** `tsc --noEmit` + `next build` clean; `makemigrations --check` clean (data-only
  migrations 0008/0010); `apps.itsm_rbac` grant tests green in a throwaway Postgres.

### Workflows — Configurable transition capture fields (added 2026-07-02)

Admins configure typed fields captured when a transition runs (e.g. Resolve → Root cause /
Resolution type), each Mandatory or Optional — generalises the seeded Incident Resolve screen to
**any transition**. See `itsm-workflows` / `itsm-fields` SKILL updates (2026-07-02). No migration
(reuses `TransitionScreen`/`TransitionScreenField`; writes via the transition serializer).

- [ ] **Config UI.** Project settings → **Workflow** → a transition's ⚙ **Transition settings** →
  **Capture fields on this transition**: the **Add field** picker lists the project's fields (custom +
  system) of a supported type only (text/multiline/number/date/dropdown/radio/checkbox); already-added
  fields disappear from the picker.
- [ ] **Mandatory/optional + order.** Set a field Mandatory, reorder with ↑/↓, remove with ✕, **Save**.
  Reopen the dialog → the rows, requirement, and order round-trip (read from `screen_fields`).
- [ ] **List badge.** A transition with ≥1 capture field shows an **`N fields`** badge in the
  transitions list.
- [ ] **Empty detaches.** Remove all fields + Save → the transition's `screen` is detached (no orphan
  screen left behind for a transition-owned screen).
- [ ] **Runtime capture.** Open a ticket, run that transition → the slide-over shows the configured
  fields (right control per type), **blocks submit** while a Mandatory one is empty, and on submit the
  values are **saved on the ticket** (custom → `FieldValue` shown in detail; `maps_to` → the column).
- [ ] **Unknown key rejected.** A `field_key` that isn't a live `FieldDefinition` → **400** on PATCH.
- [ ] **Seeded Resolve unaffected.** Incident **Resolve** still captures resolution_code/root_cause/
  workaround/notes and writes the Ticket columns (regression).
- [ ] **Security/altitude.** Config gated by `itsm.workflows.transitions` (supervisor); capture-field
  sub-components stay **module-top-level** (React focus stability); no business logic in the view —
  sync lives in the serializer, persistence in the workflow `engine`.
- [ ] **Build/tests:** `makemigrations --check` clean (no migration); `npx tsc --noEmit` clean;
  `next build` compiles; `python manage.py test apps.itsm_workflows apps.itsm_tickets` green
  (`TransitionScreenConfigTests` + the ITIL resolution regression).

### ITIL — Incident Impact Assessment, Priority Matrix & Resolution Details (added 2026-07-02)

> **Updated 2026-10-15:** on the detail view Impact Assessment honours Half widths (2 columns), and **Resolution Details collapses** to one line while all its fields are empty; it expands by itself after Resolve captures values.

Makes Incidents ITIL-standard. See `itsm-tickets` / `itsm-fields` / `itsm-projects` / `itsm-workflows`
SKILL updates. Scope = **Incident projects only** (`project_type == "incident"`).

- [ ] **Impact Assessment section shows on Incident only.** Open a `<KEY>INC` ticket → the layout has an
  **Impact Assessment** section (Impact, Urgency, Priority, Business Impact, Users Affected, Service
  Downtime, Major Incident). A `<KEY>REQ` (or non-incident custom) project has **no** Impact Assessment
  / Resolution Details section.
- [ ] **Impact Assessment values survive create → detail (ITINC-2 regression).** Fill Impact / Urgency /
  Users Affected / Service Downtime / Major Incident / Business Impact on the **create** form → open the
  new ticket. The detail rail shows **exactly those values** (option label for Impact/Urgency, Yes/No for
  the checkboxes, the number for Users Affected), **not "—"**. These are column-backed (`config.maps_to`),
  so any detail/queue renderer must read them off the **ticket column** (`ticket[maps_to]`), never
  `custom_fields` (a `maps_to` field has no `FieldValue`). Editing Impact/Urgency **inline** on the detail
  saves and re-derives Priority server-side; Business Impact / Users Affected / Service Downtime / Major
  Incident are editable inline too. Resolution-Details fields **display** their captured values (set via
  the Resolve screen; read-only in the rail).
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
> **Updated 2026-10-18:** `/users/` is now read-only and agent-only (`itsm.tickets` read), returning `id, username, full_name, email` (S8). A caller without it gets 403.
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
> **Updated 2026-10-18:** "Repeats annually" is honoured (B7). Re-adding a deleted date revives the row instead of a 500 (C2), and holiday delete confirms. A new calendar gets Mon–Fri 09–17 by default; one with no hours runs 24×7 with a warning (B9).
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

> **Updated 2026-10-15:** the profile menu also carries a **Density** switch (Comfortable | Compact) under Theme — agent app only (the portal's menu hides it). The header height is `--header-h` (56px / 48px compact) on the outer `<header>`.

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
> **Updated 2026-10-18:** the picker fetches `cannedNotesApi.list({ for_helpdesk, page_size: 200 })`, which returns this helpdesk's notes plus org-wide and your personal ones. `?helpdesk=` is an exact match that hid both (C4). Results carry scope badges (`scope-badge.tsx`).
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

> **Updated 2026-10-15:** gutters come from `--main-px` (12/24/32px comfortable, 12/16/20px compact) and header↔body alignment is automatic (both use `px-main-x`). The Settings + Tenant-Settings shells are now **full width** (the `max-w-6xl` cap was lifted on request); single-column forms keep their own caps. The portal keeps `max-w-5xl`.

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
> **Updated 2026-10-18:** the `sla` RAG / `percent_used` is now business time via `sla_engine.timer_snapshot` with one calendar cache per request (M5), still a constant query count. It matches the detail panel.
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

> **Updated 2026-10-15:** the composer starts collapsed to a one-line "Add a comment…" bar — click it (or "Internal note") first, then run the checks below.

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

> **Updated 2026-10-15:** open the composer first ("Add a comment…" / "Internal note" shortcut); the toggle lives in the expanded form.

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

> **Updated 2026-10-15:** detail side-rail fields are label-beside-value rows (`FieldView labelSide`, `grid-cols-[8rem_minmax(0,1fr)]` — 7rem until 2026-10-18); long selects must still truncate inside the card (the `minmax(0,1fr)` + `min-w-0` guard).

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

> **Updated 2026-10-15:** full-bleed gutters are `-mx-main-x px-main-x` (density tokens), not `-mx-3 sm:-mx-6 lg:-mx-8`.

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

> **Updated 2026-10-15:** `top-14` is now `top-header` and the WorkspaceHeader really is z-40 (it was z-30 — BUG_LOG 2026-10-15).

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
> **Updated 2026-10-18:** the Org-wide filter is server-side (`helpdesk__isnull=true`), and lists page through everything (`kbAllPages`, 500/page; it was capped at 25).
> - Publish/Unpublish/Archive/Restore are lifecycle actions; `status` is read-only on PATCH.
> - Published articles get "Save & keep published" / "Unpublish & save as draft".
> - Categories are strictly one level (400).
> - Requestors see only published portal articles on `/kb-articles/` (K1).
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

> **Updated 2026-10-15:** queue person cells are **name only** again (email in the hover tooltip + `sr-only`); the ticket detail view still shows the email beside the name.

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

> **Updated 2026-10-15:** Home also lost the static "SLA at risk" / "Assigned to me" cards (never loaded data) and the one-card Knowledge Base section (now a card in the right rail); the hero has no eyebrow/subtitle. "Select Helpdesk" h2 is unchanged (e2e).

Reorganised the agent **Home** (it was too noisy): canned responses moved into each helpdesk's
Settings (helpdesk-only + isolated); the KB grid collapsed to a single entry; KB/admin pages gained the
shared app-switcher; and the Home gear now opens a **Tenant Settings** master/detail hub. **No DB model
change** (`makemigrations --check` clean) — canned isolation is a `get_queryset` clamp only.

**Canned Responses — per-helpdesk + isolated** (module `itsm.canned_notes`)
> **Updated 2026-10-18:** `components/canned-notes/scope-badge.tsx` exists again. It was re-created for the composer picker's scope badges (U11). The management list is unchanged.
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

> **Updated 2026-10-15:** with no links the card is a single row "Linked issues · None" + **Link** (no "No linked tickets yet." line).

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

### Surveys — Per-project CSAT feedback (added 2026-07-02)

A new `itsm_surveys` TENANT app: a per-project survey config (Survey settings tab) → survey email on
resolve/close → portal feedback page → CSAT report + dashboard KPI. See the **itsm-surveys** skill.

**Config (Survey settings tab — Supervisor-only)**
- [ ] The **Survey** tab appears in project settings (`?tab=survey`); it is **read-only** for non-Supervisors
  (gated by `itsm.surveys.config`), and Save PATCHes the config. New projects get their own `SurveyConfig`
  (via `perform_create`); an existing project self-heals on first tab open (`survey-configs/for-project`).
- [ ] Changing the **scale type** updates the preview; **trigger** offers Resolved/Closed; the email
  message edits in Tiptap. Surveys ship **disabled** — nothing sends until an admin enables one.

**Trigger + send (backend)**
- [ ] Resolving/closing a ticket fires the survey **only** when: the project config is `enabled`, the
  transition matches the trigger (`closed` → the closed status; `resolved` → a done status that isn't
  closed), and the requestor **has an email**. Disabled / no-email / no-config ⇒ **nothing**.
- [ ] **One survey per ticket** — reopen→re-resolve does not create a second `SurveyResponse` or a second
  email (idempotent guard). A branded email lands in the outbox (`event_type="SurveyRequest"`,
  `dedupe_key="survey|{ticket}|{response}"`) with a **Give feedback** CTA to the portal feedback page.
- [ ] A survey failure **never breaks the ticket transition** (the hook swallows + logs; it runs in
  `on_commit`, so it's absent from a rolled-back transition — verify with `captureOnCommitCallbacks`).

**Answer (portal — requestor-only)**
- [ ] The feedback page (`/t/<org>/portal/requests/<n>/feedback`) requires portal login, renders the
  configured scale + optional comment, and submits via `POST portal/requests/{id}/survey/`. The
  thank-you / already-submitted states render. A **non-requestor gets 404** (owns-ticket clamp).
- [ ] Submit **validates the rating** against the scale (bad rating → 400), **requires a comment** when
  configured (→ 400), and **refuses when no survey was sent** (→ 400, no unsolicited responses). The
  comment is **bleach-stripped** to plain text (XSS) and `csat_score`/`is_satisfied` are normalised.

**Report + dashboard**
- [ ] `csat-summary` / `csat-responses` reports honour project/date/**helpdesk** scoping (never leak
  across helpdesks) and appear in the Reports catalog (category "Satisfaction", exportable). The
  command-center **CSAT KPI** renders and auto-refreshes; it reads `csat_pct` (or "—" when no responses).

**Multi-tenancy / seed / build**
- [ ] `itsm_surveys` is in `TENANT_APPS`; `migrate_schemas` creates its tables per org; `seed_itsm` runs
  the default-config + backfill steps **idempotently** (re-run = no dupes). No `tenant_id` filters.
- [ ] `python manage.py check` clean; `tsc --noEmit` clean; `apps.itsm_surveys` tests green (trigger,
  normalisation, submit rules, sanitisation, CSAT report, portal boundary).

### Reporting + Tickets — Frozen header rows: report xlsx sheets + sticky queue column header (added 2026-10-14)

GridCrest asked for the column-header row to stay visible while scrolling (a) the Excel reports exported
from Reports and (b) the agent ticket queue. Backend: `export.build_workbook` sets `ws.freeze_panes =
"A4"` on every report sheet. Frontend: `QueueView` is a viewport-height column whose table card is the
only scroll pane (both axes) with a sticky header; `Table` gained an opt-in `containerClassName`. No
model change, no migration.

- [ ] **Excel freeze** — Download any report as Excel (and **Export all**): on every report sheet, rows 1-3
  (title + header) stay visible while scrolling down; **Ticket Data** with hundreds of rows keeps its
  header. The **Summary** cover sheet is not frozen. CSV is unchanged.
- [ ] **Queue sticky header** — on a project queue (e.g. `/w/IT/p/INC`) with more rows than fit, scroll the
  table: the header row (ID / Summary / Status / …) stays pinned directly under the filter toolbar; the
  page itself doesn't scroll. Same on **All Tickets**. Header cells are opaque (rows don't show through)
  and keep a bottom divider line; check light + dark theme.
- [ ] **Horizontal scroll** — with many columns on a laptop-width window, the horizontal scrollbar is
  visible at the bottom of the table pane (not below the last row) and the header scrolls sideways in
  step with the rows. Sort carets still work.
- [ ] **Pager + page reset** — with >1 page the pager sits flush at the viewport bottom; clicking **Next**
  after scrolling to the bottom shows the new page from its first row. Changing a filter/search/sort
  also returns to the top. A single-page queue has a bottom gap and no pager band.
- [ ] **Live refresh** — scrolled down inside the table, a background update stages the **Refresh** pill
  (rows don't shift); at the top of page 1 it applies silently; the pill scrolls the pane back to top.
- [ ] **Short screens** — at a very short window height the layout keeps a usable table (page scrolls a
  little; toolbar/pager stay sticky). Wrapping filter chips shrink the table pane rather than overflowing.
- [ ] **Report detail sticky header (2026-10-15)** — open a report (e.g. Reports → Ticket Data, range
  01→15 Oct): scrolling the rows keeps the column header pinned at the top of the table card while the
  title, project/date filters and Excel/CSV buttons stay visible above it. Scroll sideways across all the
  Ticket Data columns and the header follows. Short reports (a few rows) keep their natural height.
- [ ] **Other tables unchanged** — Users / Groups / email lists / KB / Reports-catalog tables still scroll
  horizontally as before (`Table` default wrapper untouched; `TableHeader sticky` is opt-in).
- [ ] **Build/tests** — `tsc --noEmit` + `next build` clean; `manage.py check` + `makemigrations --check`
  clean; `apps.itsm_reporting` tests green (export tests assert `freeze_panes`).

### Density toggle (Compact default) + free-space pass (added 2026-10-15)

Customer feedback: "Need to optimize the GUI free space." Approved via the HTML mockup
(`ui-designs/compact-density-preview.html`). A per-user **Density** switch (Comfortable | Compact, profile
menu, remembered per browser, **Compact by default**) plus dead/duplicated content removed in **both**
modes. Frontend only — no backend, API, migration or RBAC change. See the itsm-tickets / itsm-helpdesks /
itsm-reporting / itsm-dashboards SKILL updates (2026-10-15) and BUG_LOG 2026-10-15.

**Mechanism**
- [ ] **Toggle** — profile menu → Density shows **Comfortable / Compact**; switching is instant (no reload),
  survives a reload, and a fresh browser (nothing stored) opens in **Compact**. No flash of the other
  density on load (pre-paint `DENSITY_SCRIPT` sets `<html data-density>`).
- [ ] **Scope** — only the agent app changes. The end-user **portal** (no Density item in its menu),
  **/console** and **login** look identical in both densities. Popovers/dialogs/sheets keep comfortable sizing.
- [ ] **Theme × density** — check light + dark in both densities (tokens only, no literal colours added).
- [ ] **Grep gate (must be empty except `components/portal/portal-request-form.tsx`):**
  `grep -rnE 'top-14|-my-6|3\.5rem|6\.5rem|lg:top-20|-mx-3 .*sm:-mx-6' frontend/app frontend/components`.
  Chrome geometry comes only from the `--header-h / --main-px / --main-py / --sidebar-w` tokens.
- [ ] **`compact:` rules** — never inside `components/ui/*` (primitives read `var(--ctl-h)`, `var(--cell-px)`…);
  use `compact:lg:` for breakpoint-gated layout (grid-cols / flex-row / hidden); new chrome offsets use
  `top-header` / `top-rail` / `-mx-main-x`.

**Chrome**
- [ ] Header is exactly **56px** (comfortable) / **48px** (compact), border included; sidebar 256 / 224px;
  sidebar collapse state shows immediately on reload (no expanded-then-collapsed flash).
- [ ] Queue page does **not** scroll as a whole (`scrollHeight === innerHeight`) — the 1px overflow is gone;
  the toolbar band sits flush under the header; the header paints above the band (z-40 > z-30).

**Queue**
- [ ] People cells (Requestor/Assignee/Created by/Updated by) are **one line**; hovering shows
  "Name · email"; a screen reader still reads the email.
- [ ] Unassigned → **"Unassigned"** (group in tooltip); with the Group column hidden it shows the group name.
- [ ] SLA bars are one line (bar + label); date cells never wrap. Rows ≈ **47px** comfortable / **35px**
  compact; at 1440×900 compact shows ~18 of 25 rows (was ~8–10).
- [ ] Summary keeps ≥220px; on a laptop width the pane scrolls sideways (sticky header follows) rather
  than squeezing Summary.

**Ticket detail**
- [ ] No separate back-link row: the badge row starts with **← project (or All tickets) /**; it goes back
  to the right queue (incl. `?from=all`). Title and the action buttons share one row.
- [ ] No **Status** card in the side rail (status shows in the header).
- [ ] Main sections honour **Half** widths (2 columns at md and xl+, 1 at lg); inline edit on a half-width
  field saves.
- [ ] **Resolution Details** is a one-line collapsed header ("Nothing recorded yet · captured on Resolve")
  on an unresolved ticket; it expands on click; after **Resolve** with captured values it is open by
  itself. Print (More ▸ Print) still lists every layout field incl. the Resolution ones.
- [ ] **Composer**: one-line "Add a comment…" (+ "Internal note" for agents with the grant; *Updated 2026-10-29:* a pink outline button). Clicking opens
  the editor **focused**; typing, canned-response insert, paste/drop image, Attach files all work; a
  started draft never collapses away; **Cancel** with a draft asks first; posting closes it.
- [ ] Side rail is **sticky** on desktop (*Updated 2026-10-29:* below the frozen header, and only while it fits the viewport), rows are label-beside-value; long selects stay inside the card;
  Requestor profile is collapsed, shows "· N" attributes and no duplicate email (absent when there are
  no attributes); empty Linked issues is one row; Attachments field hidden when there are none.

**Home / dashboard / reports / settings**
- [ ] Home: no "OneDesk" eyebrow or hero subtitle, no placeholder cards; KB is a rail card (only for
  KB authors); **"Select Helpdesk"** heading present (e2e).
- [ ] Dashboard: no subtitle; loading skeleton matches the 5-tile KPI row (no jump on load).
- [ ] **Reports → Ticket Data** (GridCrest screenshot): headers + cells are one line (long values clipped
  with the full text on hover — the Excel/CSV export still has everything); header row frozen at the top
  AND the first column (Ticket #) frozen on the left while scrolling sideways; page itself doesn't scroll.
- [ ] Reports catalog rows are two lines (title + category tag, one-line context); org Reports shows 4
  cards side by side at 2xl.
- [ ] Settings / Tenant Settings use the full width; at 1920 the Users table fits without sideways
  scroll; project settings' 12 tabs fit one row at 1440 in Compact; single-column forms keep their width.

**Gates**
- [ ] `npx tsc --noEmit` + clean `npm run build` (`rm -rf .next/*` first) green; compiled CSS contains
  `[data-density=compact] [data-shell=agent]` and `calc(var(--main-px) * -1)`.
- [ ] Visual check in an ISOLATED stack (throwaway Postgres + `ticketprod-backend:latest` with an inline
  env — never `backend/.env.docker` — + `next start` of the build + scratch nginx + Playwright), both
  densities × light/dark at 1440×900, 1920×1000 and 390×844. Never against prod.


### Modern interface — step B1 token layer + Classic / Modern switch (added 2026-11-05)

Decided with the user through the mockup series `ui-designs/workbench-v7-2026-11.html` (approved
2026-11-04; spec in the plan's sections 11–12). **Modern** is the new workbench; **Classic** is today's
UI. B1 ships only the token layer and the per-agent switch; the layout steps (B2–B9) follow one by one.
Frontend only — no backend, API, migration or RBAC change. Backup:
`backups/pre-modern-b1-2026-11-05/files.tgz`.

**Mechanism**
- [ ] **Switch** — profile menu → **Interface** shows **Classic | Modern (New)** under Density, agent app
  only (the portal's UserMenu passes `showDensity={false}`, which hides both). Switching is instant, survives
  a reload, and a fresh browser (nothing stored) opens in **Modern** since 2026-11-05c (it was Classic before).
  No flash on load: the same pre-paint
  `DENSITY_SCRIPT` sets `<html data-ui="modern">` (only when chosen) and `<html data-app="agent">` on
  `/t/<org>/agent…` routes; `AgentShell` keeps `data-app` right across soft navigations
  (`useLayoutEffect`, before its early return).
- [ ] **Scope** — every Modern rule is `html[data-app="agent"][data-ui="modern"]` (globals.css) or the
  `modern:` Tailwind variant (`:is(html[data-app="agent"][data-ui="modern"] &)`). Portaled dialogs,
  selects and menus follow Modern (they hang off `<html>`); the end-user **portal**, **/console** and
  **login** are byte-identical in both interfaces. **Classic is pixel-identical to the previous build**
  on every agent page — nothing above the Modern block in globals.css changed.
- [ ] **Tokens only** — Modern overrides `--foreground/--muted-foreground/--border/--input/--muted/
  --secondary/--accent(-foreground)/--primary-ink/--success/--warning/--destructive`, `--radius` (0.5rem),
  the new `--radius-xl` (panels: `rounded-xl` now reads it; Classic 0.75rem) and the new
  `--shadow-soft`/`--shadow-soft-md` (Classic = the old literal shadows; Modern `0 0 #0000`). Dark theme
  has its own Modern block (`html.dark[...]`). No literal colours in components; `shadow-soft` /
  `rounded-xl` call sites unchanged.
- [ ] **Weights** — in Modern, `.font-semibold` renders 500 except on `h1` (rule in `@layer utilities`,
  specificity beats the utility; Classic unaffected).
- [ ] **Portals + compact** — in Modern with Compact density, dialogs/menus also get the compact control
  sizes (`html[data-app][data-ui][data-density="compact"]` repeats the compact geometry vars). In Classic
  they keep comfortable sizes, as before (2026-10-14 decision stands for Classic).
- [ ] **Grep gates** — the 2026-10-15 gate still returns only `portal-request-form.tsx`; `grep -rn
  "compact:\|modern:" frontend/components/ui` is empty.

**Visual (isolated stack, never prod; 1440×900 light+dark, Classic+Modern, Compact)**
- [ ] Classic: screenshot diff against the previous frontend image = 0 px on queue, ticket detail,
  dashboard, settings, admin users, an open dialog, an open select.
- [ ] Modern: text is a dark neutral (#292A2E), not black; secondary text #505258; borders lighter;
  panels 8px radius with no shadow; chips/active nav use the magenta ink on the pink tint; dialogs/selects
  take compact control sizes; dark theme uses the graphite surfaces (#18191A / #1F1F21).
- [ ] Portal, login and /console: identical in Classic and Modern (attribute absent or ignored).

**Gates**
- [ ] `npx tsc --noEmit` + clean `npm run build` (`rm -rf .next/*` first) green; compiled CSS contains
  `html[data-app=agent][data-ui=modern]`, `.shadow-soft{--tw-shadow:var(--shadow-soft)` and
  `rounded-xl{border-radius:var(--radius-xl)`; `[data-density=compact] [data-shell=agent]` still present.

### Modern interface — step B2 shell + Interface org setting (added 2026-11-05)

Step B2 of the Modern build (plan `~/.claude/plans/can-you-check-the-graceful-blum.md` §15; mockup
`ui-designs/workbench-v7-2026-11.html`). **Frontend + backend.** Migrations: `accounts 0005_user_ui_preference`
(runs in `public` AND every org schema — `accounts` is in both app lists) and `itsm_rbac 0016_tenantinterfaceconfig`
+ `0017_seed_interface_module` (per org). Backup: `backups/pre-modern-b2-2026-11-05/files.tgz`. Classic must be
pixel- and behaviour-identical (`_CODING_RULES.md` rule 24).

**Interface policy + preference (backend)**
- [ ] `GET itsm/auth/interface/` (no auth) → `{ui_default, ui_allow_switch, ui_classic_retire_on, classic_retired}`;
  defaults (`modern` since 2026-11-05c, `true`, `null`, `false`) when no row exists and on the public schema.
- [ ] `GET/PUT itsm/admin/interface/` gated by **`itsm.admin.interface`** (Admin + Supervisor full; Agent, Requestor and
  custom roles an explicit no-access row from 0017, `get_or_create` so hand-edited grants survive). A GET never writes a
  row; PUT upserts the single row and writes an `AdminAuditEvent` (area `itsm.admin.interface`, both saves recorded as
  `update` because the row is created empty first, like Branding). `ui_default=classic` with a retire date ≤ today → 400.
- [ ] `POST itsm/auth/preferences/ {ui_preference: "" | "classic" | "modern"}` (any signed-in user) saves
  `User.ui_preference` and answers with the `/auth/me/` payload; `""` = follow the org. 400 for a bad value, for Classic
  once retired, and for the non-default interface while switching is off. Not an admin audit event.
- [ ] `/auth/me/` and the login payload carry `ui_preference`.
- [ ] Tests: `python manage.py test apps.itsm_rbac apps.accounts apps.itsm_core.tests_admin_audit` green on a throwaway
  PG (93 tests on 2026-11-05) and `makemigrations --check` = "No changes detected". Note: under `manage.py test` every
  app is flattened into `public`, so the "public schema → defaults" guard checks `settings.SHARED_APPS` too.

**Interface resolution (frontend)**
- [ ] `InterfaceSync` (agent layout, below AgentGuard): retired → Modern, switch hidden; switching off → org default, switch
  hidden; else the user's saved choice; else the org default. It waits for the policy when the user has no saved choice
  (no Classic→Modern flash) and writes the result to `itsm-ui`, so the pre-paint script is right on the next load. A
  switch in the profile menu applies at once and saves to the account (`interfaceApi.setPreference` + `refreshUser`);
  a failed save shows a toast and keeps the local choice for the session.
- [ ] Profile menu → Interface hidden while the org decides (`uiLocked`); the palette's "Switch to …" action too.
- [ ] Tenant Settings → Organisation → **Interface: Classic or Modern** (nav item + hub card, gate
  `isSupervisor || itsm.admin.interface read`): default (Classic | Modern), "Let agents switch themselves", "Retire Classic
  on" (date, Clear), Save disabled with a reason until something changed; read-only banner without update rights. After a
  save agents get the new policy on their next page load.

**Modern shell (Classic untouched)**
- [ ] Inside a helpdesk and on Home / Approvals / Reports / Knowledge / Help / Tenant Settings: a **56px icon rail** + a
  **44px top bar** (`--header-h` 2.75rem on `html[…modern]` AND `[data-shell="agent"]`; queue page still
  `scrollHeight === innerHeight`; every `top-header` band follows).
- [ ] Rail: hover (140 ms) or keyboard focus opens a 240px labelled menu **over** the page (content does not move), leaving
  (220 ms) / Esc / picking an item folds it. Items: Dashboard (G D), All Tickets (G T) + project sub-links, Approvals with
  the pending count (G A), Reports, Assets (G E) + Asset Dashboard / Asset List with the category tree / Asset Report;
  footer Configuration (G S, admins), Pin, profile. Same permission gates as the Classic nav. One link per item in both
  states (label `sr-only` folded); sub-links mounted once and `hidden` folded (the asset tree loads once).
- [ ] **Pin menu open** keeps it at 240px in the page flow (content narrows); stored per device in `itsm-rail-pinned`;
  "Unpin menu" reverts. Since 2026-11-05c the pin is an icon-only button (accessible name + tooltip) in the same spot
  folded and open.
- [ ] Top bar: breadcrumb (`Helpdesk › Incident › ITINC-12`, `… › Configuration › Business Calendars`, `Home › Tenant
  Settings`) + the page title (PageHeader teleport) + page actions, **Search ⌘K**, Create,
  Help, Notifications. Below lg: menu button (Classic drawer), Approvals icon and avatar menu instead of the rail.
- [ ] PageHeader in Modern on lg+: title + actions render in the top bar via `createPortal`; description becomes an ⓘ, or
  stays as text with `descriptionInline` (asset list, import history, import detail); `breadcrumb` (back links) stays in
  the page; exactly one `<h1>` per page. Classic, portal, console and narrow screens keep the inline header.
- [ ] Pages WITH a description (Configuration home, Business Calendars, Tenant Settings → Users / Interface,
  Approvals) render in Modern with the ⓘ beside the title and no console error — React #185 regression check
  (BUG_LOG 2026-11-05: the slot's `setTitle` must keep one identity).
- [ ] Settings / Tenant Settings keep their in-page column (the rail stays the main menu) with **← Back to helpdesk /
  Back to home** on top; Classic markup unchanged (`SettingsColumns`).
- [ ] Keys (Modern only, ignored while typing / inside dialogs and menus): ⌘K or Ctrl+K palette; `?` shortcuts sheet;
  G then D/T/A/E/S. Palette: tickets by number or words (server search, first 8), Go to (sections, projects, other
  helpdesks, Tenant Settings, Help), Actions (`>`: New ticket in <project>, Switch interface, Keyboard shortcuts); arrows /
  Enter / Esc; listbox semantics. Account menu → "Keyboard shortcuts ?" (Modern only).
- [ ] Classic e2e strictness holds: no second link named "Incident" or "New ticket" in Classic; in Modern the project
  sub-links exist only while the menu is open.

**Gates**
- [ ] Docker `tsc --noEmit` + clean `next build` green; compiled CSS has `html[data-app=agent][data-ui=modern] [data-shell=agent]`,
  `--rail-w:56px`, `.w-nav-rail{width:var(--rail-w)}` and still `[data-density=compact] [data-shell=agent]`.
- [ ] Grep gates: the 2026-10-15 gate shows only its long-standing hits (globals.css lines 137/143 and
  `portal-request-form.tsx`); `grep -rn "compact:\|modern:" frontend/components/ui` empty; `BreadcrumbPage` unused; raw
  `TooltipTrigger` outside `components/ui` only in `workspace-nav.tsx`.
- [ ] Isolated stack (odb2 recipe in memory; backend = a writable tar copy of the working tree so the migrations run):
  Classic new-vs-previous-image diff = only time-based pixels; Modern assertions + screenshots (rail folded / hovered /
  pinned, palette, `?` sheet, settings, Tenant Settings → Interface, home, ticket, 390px, dark); axe serious/critical = 0 on
  Modern dashboard, queue, settings, home, interface page; org lock: switching off flips a Modern user to the default and
  hides the switch, lifting it restores the saved choice.

### Modern interface — step B3 queue (added 2026-11-05)

Step B3 of the Modern build (plan §14; mockup `ui-designs/workbench-v7-2026-11.html`). **Frontend only, no
migration.** Applies to both queue routes (`…/p/<KEY>` = `TicketQueue`, `…/all` = `CombinedTicketQueue`, one shared
`QueueView`). Backup: `backups/pre-modern-b3-2026-11-05/files.tgz` (+ `queue-columns.tgz`). Classic keeps the
toolbar band, the "Open ▾" view menu, the pager and `?page=`, pixel- and behaviour-identical (rule 24).

**Layout (Modern)**
- [ ] The queue is full-bleed (`-mx-main-x -my-main-y`) and viewport-tall: view tabs (36px) → Find row (only when open
  or a search is set) → filter row (only when open) → table pane (the only scroller) → 32px count footer. Page
  `scrollHeight === innerHeight`; no horizontal page scroll at 1440 or 390.
- [ ] `<h1 class="sr-only">` = the queue name (the breadcrumb shows it visibly); exactly one h1.
- [ ] **View tabs** (`view-tabs.tsx`, `role="tablist"`, ←/→/Home/End move focus, Enter/Space opens; manual activation):
  starred default first, then the enabled system views, own saved views, shared ones; max 6, the active view always
  shown. Counts = one `tickets/pulse/?q=<view spec>` per tab within the queue scope (no Find text), cached 60 s per
  scope + view, refetched when the queue's live poll sees a change; the active tab shows the list's own total. A
  hand-edited filter adds a selected **Custom filter** tab. The table pane is the `tabpanel`.
- [ ] **Views ▾** (tool row) = the Classic `SavedViewsMenu` with a small trigger: every view, ★ default, delete own.
- [ ] **Find (/)**: a borderless search row (focus = brand underline across the row; no browser clear button; search
  help behind an ⓘ, not a tooltip that opens on focus), same server-side search as Classic (`?search=`, 300 ms
  debounce, relevance rules unchanged), "N matches", Esc or ✕ clears and closes and returns focus to the Find button.
- [ ] **Filters (F)**: shows/hides the chip row (`FilterBar hideViews`); badge = number of hand-set conditions (Custom
  filter only). Opens by itself when the queue arrives on hand-edited filters (URL `?q=` without `?view=`, or restored).
- [ ] Tool row also has Columns (icon `ColumnPicker iconOnly`) and, in a project queue, an outline **New ticket** link
  from 640px up (the top bar's Create menu covers every project and phones). Classic still has exactly one "New
  ticket" link.

**Rows + infinite scroll**
- [ ] Rows 36px (`h-9`, `--cell-py: 0`), header 32px with 12px labels; same cells/columns/sorting as Classic; ticket
  IDs muted grey in Modern (`modern:text-muted-foreground`; Classic keeps the brand colour).
- [ ] 25 rows per batch; a sentinel row (120px look-ahead inside the pane) loads the next batch; duplicates (rows that
  shifted while loading) are dropped. At 1440×900 the queue opens on "25 of N" (one batch), not two: after an append
  the code re-measures the sentinel because the observer flag lags one callback (regression seen in QA 2026-11-05). Footer: ● Live · **26** of 127 tickets · "scroll for more" / "Loading more…" /
  "all loaded" (+ "sorted by best match" while searching) · **Top** after one screen. A failed batch shows "Couldn't
  load more tickets. Try again" and stops auto-loading.
- [ ] No `?page=` is written in Modern; a Classic `?page=3` link opens Modern at the top.
- [ ] Live refresh: the silent fetch re-reads every loaded row in one request (`page_size` = loaded, max 500). Applied in
  place only when the pane is at the top and not hovered; else the "N new tickets · Refresh" pill appears **inside** the
  list (absolute, bottom-centre), never over other content.

**Keys (Modern only, through `usePageShortcuts` → the ShortcutsHost listener; ignored while typing / in dialogs)**
- [ ] J/K (and ↓/↑ when focus is on the page or a row) move a highlight (2px brand bar on the first cell + tint; the
  focused summary link underlines instead of a ring box) and focus the row's summary link, scrolling it clear of the sticky header (`scroll-padding-top`). Enter on that link / O opens the ticket; Enter
  on any other button or tab does its own thing. `/` opens Find, `F` toggles filters. The `?` sheet lists them.

**Gates**
- [ ] Docker `tsc --noEmit` + `next build` green; `grep -rn "compact:\|modern:" frontend/components/ui` empty; the
  2026-10-15 grep gate unchanged; no `addEventListener("keydown"` outside `use-global-shortcuts.ts` except the long-standing Esc of `sla-celebration.tsx`.
- [ ] Isolated stack: Classic queue / All Tickets / detail diff vs the previous build = **0 px** when both runs use one
  frozen browser clock (`context.clock.set_fixed_time`; otherwise the SLA countdown ticks between runs); Modern
  assertions (tabs + numeric counts, "N of M tickets", scroll loads the next 25, J J Enter opens the 2nd ticket, `/`
  search narrows, F shows chips, Esc closes Find, Custom filter tab, no page scroll) + axe serious/critical = 0 on the
  Modern queue and All Tickets, light and dark.

### Modern interface — step B4 docked ticket / workbench (added 2026-11-05)

Step B4 (plan §14; mockup `ui-designs/workbench-v7-2026-11.html`). **Frontend only, no migration.** Modern on lg+ only;
Classic and screens under 1024px keep separate queue and ticket pages. Backup: `backups/pre-modern-b4-2026-11-05/files.tgz`.

**Routing**
- [ ] `p/[projectKey]/layout.tsx` (still the access guard) renders `ModernWorkbench` with the queue when Modern + lg+ and
  the segment isn't `new`: `/p/KEY` = queue only (the layout does not render `page.tsx`), `/p/KEY/NUMBER` = queue + the
  ticket card, `/p/KEY/new` = today's full page. New `all/layout.tsx` + `all/[ticketId]/page.tsx`: Modern All Tickets rows
  open `/all/NUMBER` (docked); Classic rows keep `/p/KEY/NUMBER?from=all`; a shared `/all/NUMBER` link in Classic or on a
  phone renders the full ticket page with an "All tickets" back link.
- [ ] The queue element keeps its place in the tree: opening, paging (J/K, ← →) and closing tickets never reloads the list
  (rows loaded by scrolling stay, filters and scroll stay). The queue's URL-sync only writes the query string while
  `pathname === scope.queuePath` (never onto a ticket URL); closing pushes the queue path and the queue re-adds its params.

**Workbench + card**
- [ ] Grid under the top bar: list 440px + card (`m-2.5 ml-0`, rounded, lifted) on the `--wb-stage` ground (60% mix of
  `--muted` and `--card`: a full `--muted` stage put P2 chips at 4.48:1). No page scroll.
- [ ] Docked list: view dropdown (the Classic `SavedViewsMenu`) + count, Find and Filters; columns fixed to status dot ·
  Pri · ID · Summary · SLA pill (`table-fixed`); the open row `aria-current="true"` (white + brand bar), other rows fade to
  the secondary ink until the list is hovered (globals.css rule under the Modern selector); J/K from the card keep the
  open row scrolled into view. The queue's sr-only title becomes an h2 (the ticket title is the page's h1).
- [ ] Card header: row 1 = number chip · project › type | ← i of N → (disabled with a reason at the ends or when the
  ticket isn't in the loaded rows) … watchers · attachments · ⋯ | details panel `]` · maximise `[` (green) · close Esc
  (red); row 2 = the 20px title (2 lines max, pencil edits); row 3 = status · priority · the workflow's buttons / Send for
  approval … requestor · created; row 4 = `SlaHorizon` (resolution clock; wall-clock time left, no business target beside
  it). 3px priority hairline on top. Body = the same main column and details rail as the full page (`mainColumn`,
  `sideRail`), each scrolling on its own; details panel 320px with `--side-label-w: 6rem`; stale pill inside the card.
- [ ] Keys (Modern, docked): J/K next/previous (loads the next batch past the last loaded row), `]` panel (remembered in
  `itsm-wb-panel`), `[` maximise, Esc close (not while editing the title), R reply, N internal note. Leaving with an
  unsent reply (J/K, ← →, Esc, ✕) asks "Discard your unsent reply?" and stays on Cancel. The queue's `/`, F, Enter keep
  working (page key maps merge, the ticket's win).
- [ ] Classic ticket page markup unchanged: the render was split into shared pieces (`printPortal`, `summaryBlock()`,
  `watchAttach`, `transitionButtons`, `moreMenu`, `mainColumn`, `sideRail`, `stalePill`, `overlays`) and the page layout
  re-assembles them; re-inlining them reproduces the old JSX exactly (checked 2026-11-05) apart from the `/all` Move URL.

**Gates**
- [ ] Docker `tsc` + `next build` green; grep gates unchanged; `--side-label-w` falls back to 8rem (Classic rows identical).
- [ ] Isolated stack: Classic queue / All / ticket = 0 px vs the previous build with a frozen clock and the account's saved
  interface reset (`POST auth/preferences/ {ui_preference: ""}` — else `InterfaceSync` puts the "new" run in Modern);
  Modern docked checks (open, J/K, → button, `]`, `[`, green restore, R + draft guard, Esc keeps "50 of 52", ✕, All
  Tickets `/all/NUMBER`, phone full page, Classic `/all/NUMBER` back link) + axe serious/critical = 0 light and dark
  (except the known metadata `<dl>` `definition-list`, BUG_LOG 2026-10-29, also in Classic).

### Batch 2026-11-05c — Modern default, menu fixes, queue preview, SLA pause on approval, capture rules, spell check (added 2026-11-05)

Backup `backups/pre-batch-2026-11-05c/files.tgz`. Migrations: `itsm_approvals 0005_approval_pause_sla` (two
`pause_sla` booleans) and `itsm_rbac 0018_interface_default_modern` (default only, no data change). Plan:
`~/.claude/plans/can-you-check-the-graceful-blum.md`.

**Modern is the default**
- [ ] `GET itsm/auth/interface/` → `ui_default: "modern"` when the org has no row (and on the public schema). An org that
  saved a row keeps what it saved.
- [ ] A fresh browser (no `itsm-ui`, no account choice) opens Modern; `InterfaceSync` writes the resolved value to `itsm-ui`
  on every resolve, so an org that keeps Classic flashes Modern at most once per browser.
- [ ] Profile menu → Interface → Classic switches at once, is saved on the account (`/auth/me/` `ui_preference`) and
  survives a reload. Admin form: Modern is the pre-selected default, Classic is "the previous layout".
- [ ] Preview/QA scripts: a Classic run must pin Classic on the account (`POST auth/preferences/ {ui_preference:
  "classic"}`) and in `itsm-ui`; resetting the preference to "" now gives Modern. The e2e specs pin Classic in setup.

**Menu (rail)**
- [ ] Pin: icon only, `aria-label` "Pin menu open" / "Unpin menu" + `aria-pressed`, tooltip; same x/y folded and open.
- [ ] No flicker: with the rail folded, hover the avatar, click it, move across the name, into the menu and down its
  items — the rail stays 240px the whole time (sampled every 50 ms). Same for the helpdesk switcher (⊞) in the menu head.
  Esc closes the menu and leaves focus on the trigger (rail open, keyboard); a click outside folds the rail.
  Mechanism: rail menus pass `onOpenChange={rail.hold}`; focus opens the rail only when `:focus-visible`.
- [ ] Logo: first row of the menu head (inside and outside a helpdesk). Folded: a 40px box showing the logo's left end
  (GridCrest = the round mark). Open / pinned: the whole logo. No logo → company name (transparent while folded); no
  branding → the OneDesk mark once. The Modern top bar has no logo; Classic headers and the portal are unchanged.

**Queue (Modern)**
- [ ] Status chips stay on one line at 1240px wide; a long name ("Waiting on Vendor Response") ends in "…" inside a 104px
  chip; the chip tooltip has the full name. Classic chips unchanged (`truncate` is passed only by the Modern cells).
- [ ] Hover a ticket number 0.4 s → card with number · status, the summary and up to 6 lines of the description
  (`description_preview`, plain text, ≤ 300 chars + "…", email CSS never shown). Works in the docked list too. Classic:
  no card.

**Transition capture fields follow the field's layout rule (GridCrest "Put on Hold")**
- [ ] The note editor's label is the transition's **Note heading** ("Reason to hold"), never "Resolution note".
- [ ] A screen field with a "show when …" rule on the ticket's layout (type layout, else project default) follows it live:
  hidden until the condition matches (Pending Reason = other → Reason appears, required), readonly → disabled, not
  required. Values are the ticket's current ones, overlaid by what's picked in the sheet; `status` = the target status.
- [ ] Server: `engine._screen_rule_states` — a hidden / locked mandatory field is not required (no 422) and a submitted
  value for it is dropped; the stored value is kept. No rule → required as before. `available-transitions` returns
  `visibility_rule` per screen field. Tests: `itsm_workflows.tests.ScreenFieldLayoutRuleTests` (11).

**Pause SLA while waiting (approval policy)**
- [ ] Project settings → Approval: each policy card has a **Pause SLA while waiting** switch (off by default) + ⓘ.
- [ ] A request started under a policy with it on (transition, create transition, catalog, admin start, Send for
  approval) pauses First response, Resolution and Assignment; `GET tickets/{id}/sla/` → `pause_reason: "approval"`;
  the ticket's SLA panel reads "Paused — awaiting approval"; the queue shows Paused.
- [ ] Approve / reject without a Rejected transition / withdraw / cancel (project move) resume them; a rejection that moves
  the ticket to Rejected stops them. A pause from an Exclude-from-SLA status or a `pause_sla` step stays (labelled pauses:
  `SLAPauseInterval.reason = "approval"`). A waiting status that pauses + the flag = one pause window. Flipping the policy
  never changes a request already in flight. With the flag off nothing changes.
- [ ] Activity: "paused the SLA timer while awaiting approval" / "resumed the SLA timer after the approval". The ticket
  `due_date` follows the resumed resolution clock. Tests: `itsm_approvals.tests.ApprovalSlaPauseTests` (16) +
  `SentApprovalSlaPauseTests` (3); `itsm_sla` suite unchanged.

**Spell check (browser built-in, Classic and Modern)**
- [ ] The rich-text editor has `spellcheck="true"` while editable and `"false"` when disabled (attributes are a function of
  `disabledRef`); summary, text / multi-line custom fields, transition text fields, approval reasons, descriptions and
  the KB title set `spellCheck`.
- [ ] Off (`spellCheck={false}`): queue Find, ⌘K, people searches, `Input type="search"` (primitive default), helpdesk /
  project keys, mailbox host / user / folder / OAuth ids / SMTP host / user, asset tag.
- [ ] Help Center → "Spelling and grammar while you type" (Chrome / Edge / Firefox settings). Headless browsers have no
  dictionary: QA checks the attributes; squiggles are confirmed in a real browser.

**Gates**
- [ ] Backend tests (throwaway PG): `itsm_sla itsm_approvals itsm_workflows itsm_tickets itsm_rbac itsm_core accounts`
  green; `makemigrations --check` clean.
- [ ] Docker `tsc` + `next build` green.
- [ ] Isolated stack: the checks above + Classic queue / All / ticket = 0 px vs the previous build (frozen clock, account
  pinned to Classic on both) + axe serious/critical = 0 on the Modern queue, docked ticket and transition sheet.

### Reporting — Ticket Data columns follow `applies_to` per project (added 2026-10-15)

Backend-only (`apps/itsm_reporting/services/reports.py::ticket_data`); no migration. Deployed to
onedesk prod 2026-10-15 ~03:17 UTC.

- [ ] Reports → Ticket Data → project = an **Incident** project: Impact, Urgency, Business impact, Users
      affected, Service downtime, Major incident, Resolution code, Root cause, Workaround provided,
      Resolution notes all present (screen + Excel + CSV).
- [ ] Same with a **Request** project: none of the above except **Resolution notes**; the project's own
      custom fields (`cf_…`) still appear even when empty.
- [ ] **All projects** (Incident + Request in scope): the Incident-only columns are present (union).
- [ ] A helpdesk whose only projects are Request-type → All projects hides the Incident-only columns.
- [ ] Fields tab of the Request project agrees with the export (no Impact/Urgency there either).
- [ ] Rows never carry a key that is not in the column manifest (Excel header count = row cell count).
