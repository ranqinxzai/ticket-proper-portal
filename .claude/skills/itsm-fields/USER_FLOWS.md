# itsm-fields — User Flows

## Flow A — Supervisor defines a custom field
1. In the Field Designer, create a `FieldDefinition` (e.g. key `affected_service`, type dropdown,
   scoped to INC).
2. Add `FieldOption`s (value/label/color) for the dropdown.
3. The field is now available to place on a layout.

## Flow B — Arrange a layout
1. Open the Layout Designer for `(INC, Incident)`.
2. Drag the field into a section; set `is_mandatory`, `sort_order`, optional `visibility_rule`
   (e.g. show only when `priority equals critical`).
3. Save → a `FieldLayout` + `FieldLayoutItem`s persist.

## Flow C — Agent fills custom fields on create
1. The create wizard renders `DynamicTicketForm` from the layout, building a runtime Zod schema
   (mandatory items → required).
2. `FieldControl` picks the input per `field_type`.
3. On submit, `field_service` validates mandatory items and writes one typed `FieldValue` per field
   (multi-value → `value_json`). A missing mandatory field → 422 per-field error.

## Flow D — Conditional fields
A field with `visibility_rule {field:"priority", equals:"critical"}` shows only when that condition
holds, both in the form and the detail panel.
