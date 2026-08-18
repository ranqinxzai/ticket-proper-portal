# itsm-core

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
