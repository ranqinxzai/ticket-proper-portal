# itsm-fields — API Contracts

**Status: models, REST API, and `field_service` (`services/fields.py`) are all built.** Shapes below
follow the live serializers and model fields.

Base: `/api/v1/itsm/`.

## Field definitions — `itsm.fields`
### `GET|POST field-definitions` · `.../{id}`  filter `?project=&field_type=`
`{ id, project, key, name, description, field_type, is_system, is_multi, config, default_json,
options:[FieldOption] }`.

## Field options — `itsm.fields`
### `GET|POST field-options` · `.../{id}`  filter `?field=`
`{ id, field, value, label, color, sort_order, is_active }`.

## Field layouts — `itsm.fields.layouts`
### `GET|POST field-layouts` · `.../{id}`  filter `?project=&ticket_type=`
`{ id, project, ticket_type, name, items:[{ field, sort_order, is_hidden, is_mandatory, section,
visibility_rule }] }`.
### `GET field-layouts/resolve/?project=&ticket_type=`
Returns the applicable layout (specific-or-default, via `field_service.get_layout`); when none
exists, returns `{ id: null, items: [] }`.

## Field layout items — `itsm.fields.layouts`
### `GET|POST field-layout-items` · `.../{id}`  filter `?layout=`
`{ id, layout, field, sort_order, is_hidden, is_mandatory, section, visibility_rule }`.

## Custom-field values on a ticket (via `field_service`)
Read/written alongside the ticket (e.g. embedded in the ticket detail payload or a dedicated
`tickets/{id}/fields/` action). `field_service` does typed read/write + mandatory validation; a
missing mandatory layout field surfaces as a `422` per-field error consistent with the transition
validator.

## Error codes (intended)
- `400` — duplicate `(project, key)` field, `(field, value)` option, or `(layout, field)` item;
  value failing a `config` constraint.
- `403` — Agent attempting field/layout writes.
- `422` — missing mandatory custom field on create/edit.
