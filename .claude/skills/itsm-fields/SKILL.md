# itsm-fields

## Purpose
The dynamic custom-field engine + layout designer. Beyond the standard ITIL columns on
`Ticket`, admins define typed custom fields per project/ticket-type and arrange them on a
layout; each ticket stores one typed `FieldValue` row per field. The models live in
**`itsm_core`** (`models/fields.py`); the REST API + `field_service` are BUILT (API + service live).

## Backend app path
Models: `backend/apps/itsm_core/models/fields.py` (engine owned by itsm_core).
API/service (BUILT): a `field-definitions` / `field-options` / `field-layouts` / `field-layout-items`
surface plus a `field-layouts/resolve/` action, backed by `field_service` (`services/fields.py` —
typed read/write + mandatory validation).

## Key concepts
- **`FieldDefinition`** — a custom field: `project` (null = global), `key`, `name`, `field_type`,
  `is_system`, `is_multi`, `config` JSON (decimals/regex/min/max/show_time…), `default_json`.
  Types: text, multiline, number, date, datetime, dropdown, multiselect, checkbox, radio,
  user_picker, group_picker. Unique `(project, key)`.
- **`FieldOption`** — choices for dropdown/multiselect/radio (`OPTION_TYPES`); `value`/`label`/
  `color`/`sort_order`/`is_active`. Unique `(field, value)`.
- **`FieldValue`** — the CellValue: one row per `(ticket, field)`, unique. Typed columns
  `value_text/number/date/bool/user/json`; multi-value types (`MULTISELECT`) use `value_json`.
- **`FieldLayout`** — per `(project, ticket_type)` (ticket_type null = project default); unique
  `(project, ticket_type)`.
- **`FieldLayoutItem`** — a field placed on a layout: `sort_order`, `is_hidden`, `is_mandatory`,
  `section`, `visibility_rule` JSON (`{field, equals}` conditional show). Unique `(layout, field)`.

## Frontend path / pages (planned)
**Field & Layout Designer** (dnd-kit) under `admin/.../fields`; `DynamicTicketForm` /
`FieldControl` registry per type, with a runtime Zod schema built from the layout.

## API clients
`field-definitions`, `field-options`, `field-layouts`, `field-layout-items` (plus the
`field-layouts/resolve/` action). Custom-field values read/written alongside the ticket via
`field_service`.

## RBAC module codes
- Field definitions/options → **`itsm.fields`**.
- Layouts → **`itsm.fields.layouts`**.
Agent: read-only on `itsm.fields`; Supervisor: full.

## Key files
- `backend/apps/itsm_core/models/fields.py` — all engine models (BUILT).
- `backend/apps/itsm_core/services/fields.py` — `field_service` (BUILT): `get_field_definitions`,
  `get_values`, `set_values`, `get_layout`, `validate_required`. Plus `serializers.py` / `views.py` /
  `urls.py` (BUILT).
