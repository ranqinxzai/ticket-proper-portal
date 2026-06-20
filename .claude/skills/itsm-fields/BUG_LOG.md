# itsm-fields — Bug Log / Gotchas

- **Models, API, and service are all built.** `FieldDefinition`/`FieldValue`/`FieldLayout` are
  migrated tables, and the field serializers/views/urls plus `field_service` (`services/fields.py`)
  are live. The `field-definitions`/`field-options`/`field-layouts`/`field-layout-items` routes
  (and `field-layouts/resolve/`) are wired under `/api/v1/itsm/`.
- **Custom fields are NOT first-class columns.** Status/priority/assignee live on `Ticket`; custom
  fields live in `FieldValue`. The workflow `field_equals` condition reads a Ticket attribute, so it
  works on first-class fields, **not** on custom `FieldValue`s.
- **One value per (ticket, field).** `uniq_ticket_field` means writing a field re-uses/updates the
  single row; multi-value selections go into `value_json`, not multiple rows.
- **Pick the right typed column.** `field_service` maps `field_type` → the correct `value_*` column
  (via `_coerce`/`_serialize`); mixing them (e.g. storing a number in `value_text`) breaks typed queries.
- **Layout uniqueness can strand a type.** `(project, ticket_type)` is unique; a `ticket_type=null`
  layout is the project default. A type with no specific layout falls back to the default — make
  sure the default exists or the create form has no custom section.
- **Performance hot path.** Filtering the queue by a custom field (esp. multiselect/`value_json`)
  needs prefetch + GIN indexes (per the plan's risk list). Naive joins on `FieldValue` will be slow
  at scale.
- **`is_multi` and `MULTISELECT` must agree.** Storage routing keys off `MULTI_VALUE_TYPES`; an
  `is_multi` field of a non-multi type is contradictory — validate on definition save.
