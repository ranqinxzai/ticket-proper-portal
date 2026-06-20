# itsm-fields — Architecture

## Layout
```
itsm_core/models/fields.py   # FieldDefinition, FieldOption, FieldValue, FieldLayout, FieldLayoutItem  (BUILT)
# BUILT:
#   services/fields.py        # field_service: get_values / set_values / get_layout / validate_required (typed)
#   serializers + views + urls (field-definitions / field-options / field-layouts / field-layout-items + resolve)
```
The engine models live in `itsm_core` (not a separate app) because they're foundational and the
Ticket FK lives close to the rest of the base layer. This skill documents them as a logical module.

## Design decisions
- **CellValue pattern (one typed row per (ticket, field)).** `FieldValue` has dedicated typed
  columns (`value_text/number/date/bool/user/json`) plus a unique `(ticket, field)` constraint, so
  a field's value is queryable by its natural type and a ticket can't hold two values for one field.
  Standard ITIL fields stay on `Ticket`; only the custom layer uses this engine, keeping the hot
  Ticket table lean and letting the dynamic layer be queried independently.
- **Multi-value via `value_json`.** `MULTISELECT` (and any `is_multi` field) stores its list in
  `value_json`; `MULTI_VALUE_TYPES`/`OPTION_TYPES` constants drive which storage column + whether
  options apply.
- **Definitions are project-scoped (or global).** `FieldDefinition.project = null` = a field
  available to all projects; otherwise scoped to one. Unique `(project, key)`.
- **Layouts bind fields to (project, ticket_type).** A `FieldLayout` with `ticket_type = null` is
  the project default; a per-type layout overrides. `FieldLayoutItem` carries order, hidden,
  mandatory, section grouping, and a `visibility_rule` for conditional display.
- **Mandatory + visibility are layout concerns, not field concerns.** The same field can be optional
  on one layout and mandatory on another; `field_service` (`services/fields.py`, built) validates
  mandatory items via `validate_required` when a ticket is created/edited, and the frontend builds a
  runtime Zod schema from the layout.
- **`config` JSON per field type.** Validation knobs (decimals, regex, min/max, show_time) live in
  `FieldDefinition.config` so adding a constraint doesn't need a migration.

## Performance note (highest-risk area in the plan)
Custom-field joins (`FieldValue`) and multiselect filtering are a hot-path risk; the plan calls for
prefetch + GIN indexes on `value_json` when this engine is wired into the queue/filters. Indexes on
`(project, field_type)`, `field`, and `ticket` exist today.
