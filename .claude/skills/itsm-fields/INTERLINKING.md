# itsm-fields — Interlinking

## Owned by / depends on
- **itsm-core** — the models physically live in `itsm_core/models/fields.py` and extend `BaseModel`.
- **itsm-projects** — `FieldDefinition.project`, `FieldLayout.project`/`ticket_type` scope fields
  and layouts.
- **itsm-tickets** — `FieldValue.ticket`; the create wizard + ticket detail render the layout and
  read/write values.
- **itsm-groups** / **accounts.User** — `group_picker` / `user_picker` field types and
  `FieldValue.value_user` reference groups/users.

## Depended on by
- **itsm-tickets** — the `DynamicTicketForm` and ticket-detail fields panel are built from a layout;
  mandatory validation happens on create/edit.
- **itsm-workflows** — `TransitionScreenField.field_key` references a `FieldDefinition.key` (or a
  core field); transition screens collect those values.
- **itsm-templates** — a ticket template can prefill custom field values.
- **itsm-reporting / itsm-dashboards** — group-by / filter on custom fields (the perf-
  sensitive path).

## Note
This is the dynamic layer only. Standard ITIL fields are columns on `Ticket` (see itsm-tickets) and
are not part of this engine.
