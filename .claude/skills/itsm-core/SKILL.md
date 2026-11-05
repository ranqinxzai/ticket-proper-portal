# itsm-core

## Update (2026-10-29) — `strip_non_content` before bleach
- `services/html.strip_non_content(raw)` removes `head/style/script/title/xml/template/noscript` blocks **with their contents** (case-insensitive, multi-line), plus an unclosed `<style>`/`<script>` to the end of the input.
- `sanitize_html` and `html_to_text` call it before `bleach.clean`, which stays the security boundary.
- Why: bleach's `strip=True` keeps the text inside a removed tag, so Outlook-on-the-web head CSS reached ticket descriptions (itsm-email 2026-10-29b).
- Tests: `itsm_core/tests_html.py`. Also used by `itsm_email/services/scrub._has_visible_content`.

## Update (2026-10-19) — Asset Management touch-points
- `AUDITED_AREAS` gains `itsm.assets.config` ("Asset configuration"). The asset register and imports are not audited there (they keep `AssetEvent` / `AssetImport` history).
- `seed_itsm` step "Default asset statuses" (`apps.itsm_assets.seed.run`); `run_scheduler.py` starts `apps.itsm_assets.scheduler`.
- New `_CODING_RULES` **22** (xlsx/CSV formula guard) and **23** (scheduler jobs use the in-memory job store — every `DjangoJobStore` scheduler runs every due job; the existing SLA / notifications / email schedulers still do, see docs/BUG_LOG.md 2026-10-19).
- See **itsm-assets**.

## Update (2026-10-18) — Bug-fix batch: `AdminAuditEvent` + audit mixin, three new hooks, `FieldLayout.sections`, required-field helpers
- **Admin & security audit log (G8).**
  - New append-only `AdminAuditEvent` (TENANT; migration `0015_admin_audit_event`). Fields: `created_at`, `actor` (SET_NULL), `actor_label`, `action`, `area`, `object_type/id/repr`, `changes[{field,label,old,new,redacted}]`, `extra`, `ip_address`, `user_agent`.
  - Migration 0015 also adds the `AuditEvent.Action` values `approval_requested` / `approval_approved` / `approval_rejected`.
  - `services/audit.py`: `record_event`, `record_change`, `log_admin_event(request, action, *, area=, obj=, extra=, actor=, actor_label=)`, `audited_save`.
  - `AUDITED_AREAS` is an **exact-match** module-code allowlist: no ticket, comment, canned, template, saved-view, dashboard or KB traffic. `EXTRA_AREAS` = auth + audit.
  - Redaction: `EncryptedField` + names matching `password|secret|token|api_key|private_key|credential|_enc`.
  - IP from `X-Forwarded-For[-AUDIT_TRUSTED_PROXY_HOPS]` (default 2). Config writes are recorded `on_commit`; nothing is written in public.
  - **`audit_mixin.AdminAuditMixin`** is the base of `ItsmModelViewSet` + `MemberViewSet`. It snapshots in `initial()` and diffs in `finalize_response()`; semantic custom-action names; probes and no-op updates skipped.
  - `AuthAuditMixin`: login / login_failed, password_changed/_failed, SSO callback failures. `ConsoleUserAuditMixin`: "Platform admin: <name>". Password reset logs `password_reset_requested` (`emails_sent`) / `password_reset` / `_failed`.
  - Viewer API: `GET itsm/audit-events/` (`date_from/date_to/actor/area/action/q`), `/facets/`, `/export/` (CSV, 10k cap, `X-Audit-Export-Total/-Truncated`, formula-escaped, logged). Module `itsm.admin.audit` (migration `0016_audit_module`).
  - FE: `admin/audit-log/page.tsx`, `components/admin/audit-log.tsx`, `auditLogApi`, `AUDIT_HELP`.
- **Hooks:**
  - **`hooks.begin_approval(ticket, workflow, *, user=None)` does NOT swallow errors.** Call it inside the write's transaction; an `ApprovalStartError` (400) rolls the write back. The deliberate exception to rule 12.
  - **`hooks.sla_priority_changed(ticket, old, new, *, start_missing=True)`**: call it post-commit from every write that changes `Ticket.priority` (or go through `update_ticket`).
  - **`hooks.send_password_reset_email(user, reset_url, valid_minutes) -> bool`**: queues via `itsm_notifications.services.system_emails`. It never raises.
- **Fields.**
  - `FieldLayout.sections` (JSON list, migration `0014_fieldlayout_sections`).
  - `services/fields.py` gains `visibility_state(rule, values)` and `has_choices(field)`. `validate_required(..., portal_only, columns)` now honours rules (see itsm-fields).
- **Open:**
  - no retention purge or throttle on `AdminAuditEvent`
  - report exports and console org create/delete aren't logged
  - `emails_sent` reveals whether a reset address matched (admin-only)
- Batch context: `docs/BUG_LOG.md` "2026-10-18 — Bug-fix batch"; QA: `docs/QA_CHECKLIST.md` "Bug-fix batch (added 2026-10-18)".

## Update (2026-10-18b) — Automation hook, `set_values` return value, `automation_applied` audit
- **`hooks.automation_dispatch(event, ticket, *, actor, changed_fields, from_status, to_status)`** lazy-imports `itsm_automation.services.dispatcher` (rule 12).
  - Call it at the END of a write's post-commit callback.
  - The dispatcher records its own failures, because `_safe` hides them.
- **`field_service.set_values(..., *, notify_automation=False)`** now **returns the keys whose value changed**.
  - With `True`, it also queues `automation_dispatch("ticket_updated", changed_fields=["cf:<key>"…])` on commit.
  - Only the agent `set-fields` view passes `True`. Create, transition screens and move must not, or `ticket_updated` would fire before `ticket_created` and again on every transition.
- **`AuditEvent.Action.AUTOMATION_APPLIED`** (`automation_applied`, migration `0013_alter_auditevent_action`).
  - Payload: `{rule_id, rule_name, actions:[detail…]}`.
  - Actor: the per-tenant `automation-bot` user.
- See **itsm-automation**.

## Update (2026-10-18) — Shared hover-help primitives (frontend)
- **New shared UI primitives:**
  - `components/ui/hint.tsx`: `Hint` (Radix tooltip for one control). A disabled child is auto-wrapped in a focusable span, and `KeepChildState` strips the tooltip's `data-state` so Radix children keep theirs.
  - `components/ui/icon-button.tsx`: `IconButton`; `label` is both the aria-label and the tooltip.
  - `components/ui/info-tip.tsx`: `InfoTip`, the ⓘ. It opens on tap and has a 24px hit area.
  - `components/ui/tooltip.tsx`: `TooltipContent` is now portalled.
- **Copy catalogue:** `frontend/lib/itsm/help/`, with `fields`, `sla`, `status`, `format`, `queue`, `ticket`, `dashboard`, `reports`, `settings`, `admin` and `portal`.
- Primitives: `ui/hint.tsx` (`Hint`), `ui/icon-button.tsx` (`IconButton`), `ui/info-tip.tsx` (`InfoTip`); copy in `lib/itsm/help/*`. Rules + verification: `docs/QA_CHECKLIST.md` "Hover help / tooltips (2026-10-18)". Behaviour mismatches found (not fixed) are listed in `docs/BUG_LOG.md` 2026-10-18 — tooltips describe the REAL behaviour.

## Update (2026-07-24) — `field_service` owns custom-field queue-column *sortability*
Sorting the ticket queue by a `cf:<key>` column needs a display-ordered ORM expression. Both the rule
(*which* custom types can sort) and the expression live here so the filter registry and the queue
queryset agree:
- **`CF_SORTABLE_TYPES`** (`services/fields.py`) — the orderable custom types: text, multiline, number,
  date, datetime, checkbox, dropdown, radio, user_picker. **Excludes** multiselect / cascade /
  group_picker (multi-value — a joined list has no sane order), richtext (HTML blob) and attachment
  (`NO_VALUE_TYPES`). `filter_fields.custom_field_payload` reads it to decide whether to publish an
  `ordering_key`; `TicketViewSet` reads it before annotating. The single source — don't hand-test a type.
- **`custom_sort_subquery(key, field_type)`** — returns a correlated `Subquery` (or `None` for an
  unorderable type) that sorts by what the **cell displays**, not the raw store: dropdown/radio → the
  `FieldOption.label` (via a nested subquery on the stored `value_text`), user_picker → the user's
  `full_name`/`username`, else the typed `value_*` column. Correlates on `ticket` + `field__key`, so it
  unions per-project defs in the **combined** queue exactly like the column itself. A ticket with no
  value sorts NULL (Postgres: last on ASC). See **itsm-tickets** / **itsm-fields** (2026-07-24).

## Update (2026-07-16) — `field_service` owns the "which globals apply to this project?" rule
`FieldDefinition.project=null` means **global to the whole tenant** (there is no helpdesk FK), so every
surface that answers *"which fields are present on this project?"* must apply the same exclusion rule.
It now lives here, once, in `services/fields.py`:
- **`incident_only_keys()`** — keys of the global ITIL defs tagged `config.incident_only`.
- **`hide_inapplicable_globals(qs, project)`** — drops those from a **non-Incident** project's queryset.
  Accepts a `Project` **or** a pk/uuid string (the filter registry passes the raw `?project=` param).
- **`get_field_definitions(project, ticket_type=None, *, applicable_only=False)`** — the existing accessor
  gained `applicable_only`; default `False` keeps every other caller (create form, layout, `set_values`,
  move, print) byte-for-byte unchanged.
⚠️ The **JSON-exclude trap** is encapsulated here: resolve the flagged keys with a **positive** filter, then
`.exclude(project__isnull=True, key__in=keys)`. A direct `.exclude(project__isnull=True,
config__incident_only=True)` drops **every** global — `config -> 'incident_only'` is NULL on defs lacking the
key, and `NOT(TRUE AND NULL)` is NULL → filtered out. Consumers: `itsm_core.FieldDefinitionViewSet`
(Fields tab + layout palette) and `itsm_tickets.filter_fields` (queue filter registry + column pickers).
See **itsm-fields** (2026-07-16b).

## Purpose
The shared foundation every other ITSM app builds on: the abstract `BaseModel`
(UUID PK + timestamps + soft delete), the append-only audit feed (`AuditEvent` +
`log_event`), the HTML sanitizer, the cross-engine hook layer, the dynamic
custom-field engine models, and the `seed_itsm` management command. It owns no
HTTP surface of its own (no urls/views) — it's a library other apps import.

## Update (2026-07-03) — audit actions for the move-ticket feature
`AuditEvent.Action` gained **`ticket_moved`** and **`approval_cancelled`** (migration
`0010_alter_auditevent_action`; the CharField doesn't enforce choices, but the enum + migration
state stay in sync). `ticket_moved` carries a rich payload (old/new project key + number, status/type
map, dropped/remapped fields). No change to `log_event` itself. See **itsm-tickets** (2026-07-03).

## Backend app path
`backend/apps/itsm_core/`

## Key concepts
- **`BaseModel`** — `UUIDModel + TimeStampedModel + SoftDeleteModel`. The workhorse base
  for almost every ITSM model. Abstract (no table). Default manager hides soft-deleted rows;
  `all_objects` reaches them. `soft_delete(user=)` / `restore()`. **`soft_delete` does NOT cascade**
  to related rows — so retirement of a parent container (e.g. a Helpdesk) uses a `status='archived'`
  flag rather than soft delete.
- **Org/department hook (realized).** The reserved single-org hook is now the separate
  **itsm_helpdesks** app: a membership-based Helpdesk (department/workspace) layer that owns Projects
  and supplies the `accessible_helpdesk_ids` row-level scope every ticket-facing query is clamped to.
- **`AuditEvent` + `log_event()`** — one append-only row per ticket activity, written ONLY by
  explicit `log_event` calls (no signals). `payload` is JSON and can carry the previous value.
  **Audit payloads are self-describing** (so the activity feed renders without extra lookups): write
  sites store **human-readable labels captured at change time**, not just raw ids — e.g. `update_ticket`
  /`assign` add `old_label`/`new_label` (user/group display names) to `assigned`/`requestor_changed`/
  `group_changed`, `status_changed` stores `from`/`to` status **names**, the field engine's
  `field_changed` stores `{old, new, name}` (the field's display name). Capturing the label at write
  time is deliberate: the trail stays correct even if the user/group is later renamed. (Activity-feed
  renderer: `frontend/components/tickets/ticket-detail.tsx` `activityVerb`/`activityDetail`.)
- **HTML sanitizer** — `sanitize_html()` (bleach whitelist) + `html_to_text()` (plain mirror).
  Run on every rich body before save.
- **Cross-engine hooks** — `hooks.py` lazily nudges the SLA + notification engines; no-ops if
  an engine isn't installed yet; swallows errors so side-effects never break a write.
- **Dynamic field engine models** — `FieldDefinition`/`FieldOption`/`FieldValue`/`FieldLayout`/
  `FieldLayoutItem` (documented in the **itsm-fields** skill; models live here).
- **`seed_itsm`** — idempotent orchestrator that runs each app's seed in dependency order.

## Frontend path / pages
No dedicated frontend. Core utilities surface through other modules (the sanitized HTML is
rendered by ticket/comment views; audit events feed the ticket History tab).

## API clients
None. (No ViewSets, no urls.) Consumed in-process by the other apps.

## RBAC module codes
None of its own. (`AuditEvent` is exposed read-only through the **tickets** activity action under
`itsm.tickets`.)

## Key files
- `models/base.py` — `UUIDModel`, `TimeStampedModel`, `SoftDeleteModel`/`SoftDeleteManager`/
  `SoftDeleteQuerySet`, `BaseModel`.
- `models/audit.py` — `AuditEvent` (+ `Action` choices).
- `models/fields.py` — dynamic-field engine models (see **itsm-fields**).
- `models/__init__.py` — re-exports `BaseModel`, `AuditEvent`, the soft-delete mixins, field models.
- `services/audit.py` — `log_event()`.
- `services/html.py` — `sanitize_html()`, `html_to_text()`, the allow-lists.
- `services/hooks.py` — `sla_*` / `emit_event` hooks (the cross-engine seam).
- `services/__init__.py` — re-exports `sanitize_html`, `html_to_text`, `log_event`, `hooks`.
- `management/commands/seed_itsm.py` — idempotent seed orchestrator.
