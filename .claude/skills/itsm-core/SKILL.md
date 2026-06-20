# itsm-core

## Purpose
The shared foundation every other ITSM app builds on: the abstract `BaseModel`
(UUID PK + timestamps + soft delete), the append-only audit feed (`AuditEvent` +
`log_event`), the HTML sanitizer, the cross-engine hook layer, the dynamic
custom-field engine models, and the `seed_itsm` management command. It owns no
HTTP surface of its own (no urls/views) — it's a library other apps import.

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
