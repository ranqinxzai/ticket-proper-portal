# ITSM Coding Rules & Conventions

Conventions every ITSM module follows. Grounded in real code under
`backend/apps/itsm_*`. **When the code and this doc disagree, the code wins.**

## 1. UUID primary keys everywhere
Every model PK is a `UUIDField(default=uuid.uuid4, editable=False)` via `UUIDModel`
(`backend/apps/itsm_core/models/base.py`). UUIDs are stable external identifiers that don't
leak row counts in URLs / webhooks / email deep-links. (Exception: `TicketSequence` is a plain
`models.Model` keyed by a OneToOne to `Project` — it's an internal counter, not an entity.)

## 2. `BaseModel` = timestamps + soft delete
Domain models extend `apps.itsm_core.models.BaseModel` = `UUIDModel + TimeStampedModel +
SoftDeleteModel`. That gives `id`, `created_at`/`updated_at`, and `is_deleted`/`deleted_at`/
`deleted_by`. The default manager (`objects`) is a `SoftDeleteManager` that returns only
`is_deleted=False`; use `Model.all_objects` to reach soft-deleted rows.

## 3. Soft-delete on destroy
`ItsmModelViewSet.perform_destroy` calls `instance.soft_delete(user=...)` when the model has
that method (all `BaseModel` subclasses), else a hard delete. **DELETE never removes the row.**
Querysets in ViewSets filter `is_deleted=False` explicitly as a belt-and-braces measure.
*Addendum (2026-10-29):* **soft delete hides a row only from its own `objects` manager.** A
child model's queryset (`SLATracker.objects…`, `ApprovalRequest.objects…`) and a forward FK
(`row.ticket`, which uses the base manager) still reach a deleted ticket. Filter
`ticket__is_deleted=False` (or `.exclude(ticket__is_deleted=True)` for a nullable FK) or check
`row.ticket.is_deleted`. Tickets are deleted only via `ticket_service.delete_ticket`, which also
quiets SLA clocks, approvals and queued mail (BUG_LOG 2026-10-29).

## 4. Services layer = single choke-points (NO business logic in views)
All multi-step writes go through a service so there is exactly one sanctioned write site:
- `itsm_tickets/services/ticket_service.py` — `create_ticket` / `assign` / `add_comment` / `delete_ticket`
- `itsm_tickets/services/numbering.py` — `generate_ticket_number`
- `itsm_workflows/services/engine.py` — `transition` (+ `available_transitions`)
- `itsm_groups/services.py` — `resolve_assignee` / `resolve_group_and_assignee` / round-robin
- (planned) `itsm_sla.services.sla_engine`, `itsm_notifications.services.bus` + `outbox`
ViewSets parse input, call the service, serialize the result. Services are `@transaction.atomic`.

## 5. Explicit `log_event` — NO Django signals
The audit feed (`itsm_core.AuditEvent`) is written **only** via explicit
`log_event(ticket, actor, action, payload=, field_key=)` calls at each write site
(`itsm_core/services/audit.py`). This is deliberate: greppable, and it lets us snapshot the
**previous** value in the payload (which `post_save` can't). There are **no signals** anywhere
in ITSM. If you add a write path, add the `log_event` call yourself.
*Addendum (2026-10-18):* the ticket feed is `AuditEvent`. Admin/config and security changes (roles, users, sign-ins, settings) go to the separate append-only **`AdminAuditEvent`** via `AdminAuditMixin` (rule 21). Don't log config edits with `log_event`.

## 6. Post-commit side-effects via `transaction.on_commit`
Audit logging, SLA clock ops, and notification emits are scheduled inside
`transaction.on_commit(...)` so a rolled-back write never logs/notifies. See
`ticket_service.create_ticket._after` and `engine.transition._after_commit`.

## 7. `bleach` sanitization on every rich body
Any HTML body (ticket description, comment, future canned note / email template) is run through
`sanitize_html()` on save and mirrored to a plain `*_text` field via `html_to_text()`
(`itsm_core/services/html.py`). Whitelist tags/attrs/protocols only; `@mention` spans carry
`data-type/data-id/data-label`. The frontend may then render stored markup safely.
*Addendum (2026-10-29):* bleach's `strip=True` keeps the TEXT inside a removed tag, so both functions
first run `strip_non_content` (drops `head/style/script/title/xml/template/noscript` with their
contents). Never call `bleach.clean` directly on user/email HTML. On screen, render long stored HTML
with `ExpandableHtml` (6 lines + Show more), not a bare `dangerouslySetInnerHTML` div.

## 8. `module_code` on every ViewSet
Every ITSM ViewSet sets a `module_code` (e.g. `itsm.tickets`) and uses
`HasModulePermission`. The base class is `apps.itsm_rbac.permissions.ItsmModelViewSet`.
HTTP method → CRUD action: GET/HEAD/OPTIONS→read, POST→create, PUT/PATCH→update, DELETE→delete.
A custom `@action` can override the module by setting `module_code` on the handler — used for
**private comments** (`itsm.tickets.comments_private`) and **bulk ops** (`itsm.tickets.bulk`).
Permissions inherit down the dot tree (closest ancestor with an explicit grant wins); superusers
bypass. See `itsm_rbac/services.check_permission`.

## 9. `select_for_update` for numbering & round-robin
Anything that hands out a sequential/shared value locks its row first:
- `numbering.generate_ticket_number` locks the per-project `TicketSequence` row.
- `groups.services.round_robin_pick` locks the per-group `GroupAssignmentState` cursor.
- `engine.transition` and `ticket_service.assign` re-fetch the ticket with `select_for_update`.
Always do this inside a transaction; never increment a shared counter without the lock.

## 10. Config snapshots on the Ticket (no stranded in-flight tickets)
`Ticket` stores `workflow` (and, when those engines land, `sla_policy`/`calendar`) chosen at
create time, so later config edits never strand open tickets. Workflows use copy-on-publish
versioning (`Workflow.version`) for the same reason.

## 11. Standard fields = first-class columns; custom = field engine
Indexed ITIL fields (status, priority, assignee, group, dates) are real columns on `Ticket`
for fast queue/SLA/reporting queries. Only the *custom* layer uses the dynamic field engine
(`itsm_core` `FieldDefinition`/`FieldValue`/`FieldLayout`) — one typed row per `(ticket, field)`.

## 12. Hooks pattern for cross-engine calls (no hard import deps)
Ticket/comment/workflow services nudge SLA + notifications through
`itsm_core/services/hooks.py`. Each hook **lazily imports** the target engine and
**no-ops if that engine isn't installed yet** (so the product works at every milestone), and
**swallows all errors** (an SLA/notification failure must never break a ticket write). When you
build an engine, expose the function the hook expects (`sla_engine.start_trackers`,
`bus.emit`, …) rather than importing the engine directly from the caller.
*Exception (2026-10-18):* `hooks.begin_approval` deliberately does NOT swallow errors. See rule 17.

## 13. Idempotent, order-sensitive seeding
`python manage.py seed_itsm` runs per-app `seed.run()` (or `registry.seed_rbac()`) in
dependency order and **skips any not-yet-implemented step**. Every seed uses
`get_or_create` / `update_or_create` and is safe to re-run. Order: RBAC → helpdesks →
workflows → SLA → notifications → groups (per-helpdesk service desk) → ticket-types/projects
(per-helpdesk ITINC/ITREQ/HRINC/HRREQ) → templates → email → helpdesk memberships.

## 14. DRF conventions
- Read vs write serializers split by `get_serializer_class` where they differ
  (`ProjectSerializer`/`ProjectWriteSerializer`, ticket list/detail/create).
- `filterset_fields` + `search_fields` + `ordering_fields` declared on the ViewSet.
- After any role/permission edit, call `invalidate_permission_cache()` (clears the 5-min
  permission cache).

## 15. Helpdesk row-level scoping lives in the SHARED services
Every **ticket-facing read is clamped to the requester's helpdesk memberships** — and the clamp
lives in the *shared* query layers, **not only** `TicketViewSet.get_queryset`, because saved
filters, widgets, reports, SLA trackers and bulk-by-filter all bypass that get_queryset.
- The single source of the scope is `itsm_helpdesks.services.accessible_helpdesk_ids(user)`:
  it returns **`None` for superusers** (sentinel = *unrestricted*, do **not** filter), else the ids
  of active helpdesks the user is an active member of. Treat `None` and `[]` differently — `[]`
  means "see nothing", `None` means "see everything". `accessible_helpdesk_ids_cached(request)`
  memoizes it per request.
- Thread that id list into the shared primitives rather than re-implementing the filter:
  `query_builder.build_q(..., accessible_helpdesk_ids=)` / `filtered_tickets(...)` AND a
  `project__helpdesk_id__in`; `itsm_reporting.services.reports._base` + `sla_compliance` and
  `widget_data` take `helpdesk_ids`; `TicketViewSet._bulk` (ids branch), `SLATrackerViewSet`
  (`ticket__project__helpdesk_id__in`) apply the same clamp; and object-level writes
  (ticket `create`, `links`, `apply_template`, comment `@mention` ids) **reject** an inaccessible
  project/target/template/member with **403/404** — never silently widen.
- The `?helpdesk=<id|key>` query param is **advisory only**: pass it through
  `resolve_helpdesk_scope(user, requested)`, which *intersects* it with the accessible set. It can
  **narrow** the view but **never widens** it and **never 403s** — an out-of-scope `?helpdesk`
  just yields that user's normal (possibly empty) scope. New ticket-facing query paths MUST go
  through these helpers; do not add a bare `project__helpdesk_id` filter off an unvalidated param.

## 16. Frontend: every control explains itself (hover help)
Frontend-only rule, added 2026-10-18. It applies to every screen, both the agent app and the portal.
- **Icon-only control:** use `IconButton` (`components/ui/icon-button.tsx`). Never use a bare `<Button size="icon" aria-label>`: an aria-label alone gives sighted users nothing.
- **Disabled control:** its tooltip says WHY. Use `IconButton disabledReason`, or a `Hint` (`components/ui/hint.tsx`) whose label switches on the condition. `Hint` wraps disabled children in a focusable span automatically.
- **Domain concept** (SLA, KPI, status category, settings switch, report column): add an `InfoTip` (`components/ui/info-tip.tsx`). Copy goes in `frontend/lib/itsm/help/<area>.ts`, written from the backend code, not from the intent. If the code is wrong, the copy states the real behaviour and the bug goes in `docs/BUG_LOG.md`.
- **Never add another `TooltipProvider` or a hand-rolled ⓘ.** Never wrap a Radix trigger in a raw `TooltipTrigger`; use `Hint`, which preserves the child's `data-state`.
- **Native `title`:** only for full text on truncated cells in dense rows.
- **Colour contrast:** text on a pale brand tint (`bg-primary/5–15`) uses `text-primary-ink`, never `text-primary` (AA). Don't fade real text with `text-muted-foreground/NN`; opacity is for decorative icons and separators only (2026-10-19).
- Details and verification: `docs/QA_CHECKLIST.md` → "Hover help / tooltips (2026-10-18)".

## 17. Approvals start inside the transaction (`hooks.begin_approval`)
Added 2026-10-18 (B1). A `request_approval` post-function, on a transition or on the create transition, starts its approval through **`hooks.begin_approval(ticket, workflow, user=)`**, called INSIDE the write's transaction (`engine.transition` step 6d, `begin_create_approvals`).
- This is the deliberate exception to rule 12's swallow-all. `begin_approval` does **not** swallow errors.
- When a stage has nobody who could decide it, `itsm_approvals` raises `ApprovalStartError` (a 400 `TransitionError`). The whole status change rolls back, and the ticket keeps its status.
- A missing, deleted or inactive approval workflow starts nothing.
- Never move approval start back into `on_commit` or behind `_safe`, or a broken stage freezes the ticket again.
- *Addendum (2026-10-24):* **Send for approval** (`itsm_approvals/services/send.py`) starts its request inside the same kind of transaction and moves the ticket into the waiting status with **`engine.move_for_approval`**. That is the only status write besides `engine.transition` (and the project move), and only `itsm_approvals` may call it. It shares `_status_change_effects` with `transition()`; never hand-roll status side-effects.
- *Addendum (2026-10-24):* an **On-fly** stage's approvers live on the request (`ApprovalRequestApprover`). Code that resolves approvers must pass the request (`resolve_approver_ids(stage, ticket, req)`). Without it, an On-fly stage resolves to nobody.

## 18. Postgres extensions live in `public`
Added 2026-10-18 (G6). Extensions are database-wide, but their objects live in ONE schema, and tenant migrations run once per schema with `search_path = <tenant>, public`.
- A bare `CREATE EXTENSION` (or Django's `TrigramExtension()`) in a TENANT app installs into the **first tenant's** schema, where every other org can't see it.
- Use `CREATE EXTENSION IF NOT EXISTS <ext> WITH SCHEMA public`, and `ALTER EXTENSION … SET SCHEMA public` if it already lives elsewhere. See `itsm_tickets/migrations/0011_search.py` (`install_pg_trgm`).
- Never drop the extension on reverse.
- `django.contrib.postgres` is in `SHARED_APPS`, needed for `OpClass`, trigram lookups and search indexes.

## 19. Priority writes call `hooks.sla_priority_changed`
Added 2026-10-18 (B8/C7). SLA targets are per priority, so every write that changes `Ticket.priority` must re-target the clocks.
- Go through `ticket_service.update_ticket` (bulk, automation `set_field`, impact×urgency and escalation already do).
- Otherwise, call `hooks.sla_priority_changed(ticket, old, new)` post-commit, plus `log_event(..., "priority_changed")`. Pass `start_missing=False` only where the clocks are deliberately kept, as in a project move.
- The workflow engine's `set_priority` post-function and screen priority field do this.

## 20. Interactive ticket edits carry `expected_updated_at` → 409 `stale_write`
Added 2026-10-18 (U17).
- The agent detail's inline PATCH and `set-fields` send `expected_updated_at` (the `updated_at` it loaded).
- `ticket_service.ensure_fresh` checks it on the `select_for_update` row and raises `StaleTicketError`. The view maps it to **409 `{code: "stale_write"}`** (400 on a bad token).
- **System writes never pass it:** automation, email, bulk, transition, assign, portal and data scripts. `None` = guard off.
- A new interactive edit surface should opt in. A new system writer must not.

## 21. Admin/config writes are audited centrally (`AdminAuditMixin`)
Added 2026-10-18 (G8). `itsm_core.audit_mixin.AdminAuditMixin` is a base of `ItsmModelViewSet` (and `MemberViewSet`). For an unsafe request whose module code is in **`itsm_core/services/audit.AUDITED_AREAS`**, it snapshots before and diffs after, writing an `AdminAuditEvent`. Secrets are redacted and no-op updates skipped.
- **New config ViewSet or module code:** decide whether it belongs in `AUDITED_AREAS`. It's an exact-match allowlist, kept free of ticket, comment, canned, template, saved-view, dashboard and KB traffic.
- **Admin/security writes outside a ViewSet** (auth views, console, password reset, scripts) call `audit.log_admin_event(request, action, area=, obj=, extra=)` explicitly.
- Nothing is written in the public schema.

## 22. Spreadsheet exports never let user text run as a formula
Added 2026-10-19 (Asset Management v1). Any xlsx/CSV that contains user-entered text (names, notes, imported cells) must neutralise values starting with `=`, `+`, `-`, `@`, a tab or a CR.
- **xlsx:** write cells through `itsm_assets.services.xlsx.put` (or the same two lines: `cell.data_type = "s"` + `cell.quotePrefix = True`). The value stays plain text in Excel, with no visible apostrophe, and round-trips unchanged when the file is uploaded again.
- **CSV:** prefix an apostrophe (`itsm_core/audit_api._csv_cell`).
- The ticket report export (`itsm_reporting/services/export.py`) predates this rule and doesn't guard yet (docs/BUG_LOG.md 2026-10-19).

## 23. New scheduler jobs use the in-memory job store
Added 2026-10-19. Never add another `DjangoJobStore`: every `BackgroundScheduler` that has one reads the same `django_apscheduler` table and runs every due job, so N schedulers run each job N times (seen in prod as three concurrent SLA sweeps). Re-add the job at boot (`replace_existing=True`) on the default memory store, make it idempotent (claim rows with `select_for_update(skip_locked=True)` and re-check), wrap it in `for_each_tenant`, start it from `AppConfig.ready()` behind `should_run_scheduler()`, and list the module in `run_scheduler.py`. Prefer a cron trigger: an interval job restarts its clock on every deploy. Example: `itsm_assets/scheduler.py`.

## 24. Modern interface styling goes behind `html[data-ui="modern"]`; Classic is never edited for looks
Added 2026-11-05 (Modern B1). The agent app has two interfaces the user switches between (profile menu →
Interface): **Classic** (today's UI) and **Modern** (the workbench redesign, `ui-designs/workbench-v7-2026-11.html`).
- A Modern-only look lives in `globals.css` under `html[data-app="agent"][data-ui="modern"]` (dark:
  `html.dark[…]`) or uses the `modern:` Tailwind variant (`:is(html[data-app="agent"][data-ui="modern"] &)`,
  specificity 0,3,0 like `compact:`; never inside `components/ui/*`).
- **Classic must stay pixel-identical**: don't change a `:root`/`.dark` token, a shared primitive's classes or
  a page's layout for the sake of Modern. Add a token (`--radius-xl`, `--shadow-soft`) whose `:root` value
  equals the old literal, and override it in the Modern block.
- The attributes are owned by `DENSITY_SCRIPT` (pre-paint) and `AgentShell` (`data-app` on soft navigation).
  React never renders them. Preference key `itsm-ui`; unset ⇒ modern (Modern is the default since 2026-11-05c; it was classic before). The portal, `/console` and login
  never get `data-app`, so Modern can't leak there.
- Layout steps (B2–B9, plan sections 11–12) render Modern-only components behind `useUi().ui === "modern"`
  and keep the Classic component tree as is.
- *Addendum (2026-11-05, B2):* **Geometry tokens** that Modern changes (`--header-h` 2.75rem, `--sidebar-w` 15rem,
  `--rail-w` 56px) are declared on BOTH `html[data-app="agent"][data-ui="modern"]` and `… [data-shell="agent"]` — the
  compact block sets them on the shell element and the nearest declaration wins. **Which interface:** read it only through
  `useUi()` (never `localStorage itsm-ui`); `InterfaceSync` owns the resolution (org policy `TenantInterfaceConfig` → user
  `ui_preference` → org default) and writes `itsm-ui`. **PageHeader** teleports title + actions into the Modern top bar
  (`HeaderSlotProvider`), so a page has one PageHeader, and a live-status description passes `descriptionInline`.
  **Shortcuts** go through `ShortcutsHost` / `useGlobalShortcuts` (mounted once in the agent layout; `useShortcuts()` is
  null in Classic) — don't add another global keydown listener. Rail items render one link in both states (label
  `sr-only` folded) so locators and screen readers see one stable element.
- *Addendum (2026-11-05, B3):* **page keys** (the queue's J/K, Enter, `/`, F) register through
  `usePageShortcuts(keys, enabled)` from `shortcuts-host.tsx`; the host's one listener runs them after the global keys,
  under the same typing / dialog / modifier guards (latest registration wins, so a docked ticket can sit over its
  queue). A key handler returns `false` to let the event through (Enter on a focused link or button). A Modern layout
  inside a shared component branches AFTER all hooks (`if (modern) return …` right before the Classic return), so the
  hook order never depends on the interface.
- *Addendum (2026-11-05, B4):* when Modern needs a different **layout** of the same content (the docked ticket), build the
  content once as element consts (and plain render functions for parameterised bits) and let each layout place them —
  never copy JSX into a second layout, never define components inside the component. Prove Classic unchanged by
  re-inlining the pieces and comparing with the old JSX, then by a 0 px screenshot diff. A Classic value that Modern
  must change goes through a CSS variable whose fallback is the old literal (`--side-label-w, 8rem`).
- *Addendum (2026-11-05c):* **Modern is the default** (`TenantInterfaceConfig.ui_default` default, the public default, the
  pre-paint script and `resolveUi` all fall back to modern); preview / QA scripts that need Classic pin it on the account
  (`POST auth/preferences/ {ui_preference: "classic"}`) — resetting to "" now gives Modern. **A Radix menu inside the rail**
  must hold the rail open: pass `onOpenChange={useRail().hold}` (modal menus set `pointer-events:none` on body, which fires
  `pointerleave`; without the hold the rail folds, the menu jumps and it flickers). The rail opens on focus only for
  `:focus-visible` focus.
- *Addendum (2026-11-05c):* **spell check** — an editable prose surface declares it (`RichTextEditor` does while editable;
  `spellCheck` on summary / text fields / reasons); search boxes and code-like inputs (keys, hosts, tags) set
  `spellCheck={false}` (`Input type="search"` defaults to off). It is the browser's checker; nothing is sent anywhere.
