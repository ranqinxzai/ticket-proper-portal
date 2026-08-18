# itsm-fields — Bug Log / Gotchas

- **Models, API, and service are all built.** `FieldDefinition`/`FieldValue`/`FieldLayout` are
  migrated tables, and the field serializers/views/urls plus `field_service` (`services/fields.py`)
  are live. The `field-definitions`/`field-options`/`field-layouts`/`field-layout-items` routes
  (and `field-layouts/resolve/`) are wired under `/api/v1/itsm/`.
- **Custom fields are NOT first-class columns.** Status/priority/assignee live on `Ticket`; custom
  fields live in `FieldValue`. The workflow `field_equals` condition reads a Ticket attribute, so it
  works on first-class fields, **not** on custom `FieldValue`s.
- **A `config.maps_to` field has NO `FieldValue` — read/write it on the Ticket column, both server AND
  client.** `set_values` skips any `maps_to` key (and `get_values` never returns one), so
  `ticket.custom_fields[key]` is **always absent** for a column-backed field. Any renderer that shows a
  layout field's value must special-case `maps_to` → `ticket[maps_to]` and fall back to `custom_fields`
  only for value-backed fields. The ITINC-2 bug (2026-07-02) was the ticket detail view reading the ITIL
  Impact-Assessment columns (impact/urgency/business_impact/users_affected/service_downtime/
  major_incident + resolution details) from `custom_fields` → they rendered blank though `create_ticket`
  persisted them. The create form (`ticket-create-form.tsx`) and routing editor already get this right
  (`if (cfg.maps_to) …` routes to a top-level payload key / skips custom_fields) — mirror that anywhere a
  field value is displayed or edited. See itsm-tickets BUG_LOG.
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
