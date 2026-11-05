# itsm-automation: API Contracts

Base: `/api/v1/itsm/`. Permission (`ProjectSettingsPermission`):
- GET needs `itsm.projects:read`.
- POST, PATCH, PUT and DELETE need `itsm.projects:update`.
- Lists are clamped to the caller's accessible helpdesks and projects. A rule in another helpdesk returns **404**; creating or editing one there returns **403**.

## `GET automation-rules/?project=<id>&is_active=`
A paginated list (`pickResults`), ordered by `order`, then `created_at`. Each item has this shape:
```json
{ "id", "project", "name", "description", "is_active", "order",
  "triggers":   [{"type": "ticket_created", "config": {}},
                 {"type": "ticket_updated", "config": {"fields": ["assignee"]}},
                 {"type": "status_changed", "config": {"from_status_ids": [], "to_status_ids": ["<uuid>"]}}],
  "conditions": {"match": "all", "conditions": [{"field": "status", "op": "eq", "value": "<uuid>"},
                                                {"field": "assignee", "op": "is_not_empty"}]},
  "actions":    [{"type": "transition", "config": {"transition_id": "<uuid>", "keep_assignee": true}},
                 {"type": "set_field",  "config": {"field": "priority", "value": "p1"}},
                 {"type": "add_comment","config": {"canned_note_id": "<uuid>", "visibility": "private"}}],
  "stop_processing", "last_run_at", "run_count", "failure_count",
  "created_by", "created_by_name", "user_labels": {"<user id>": "Name"}, "created_at", "updated_at" }
```

## `POST automation-rules/` and `PATCH automation-rules/{id}/`
The body is the writable subset above. Validation runs against the rule's project, and any failure returns **400** `{field: msg}`:
- **`project`**
  - Required on create.
  - Immutable on PATCH.
- **`triggers`**
  - At least one, with no duplicate types.
  - `ticket_updated.fields` must be in the catalog's `update_fields`.
  - Status ids must be in the project's `default_workflow`.
- **`conditions`**
  - At most `MAX_CONDITIONS` (50).
  - Each one must compile with `query_builder._compile_condition`.
  - `"me"` is rejected.
- **`actions`**: 1 to 5. Per type:
  - `transition`: the id must be in the project's default workflow, and not the "(create)" transition (`from_status=null`, not global).
  - `set_field`
    - The field must be in the catalog's `set_fields`.
    - Priority, impact and urgency must be valid choices; an assignee must be an int or null; a group must be an existing UUID.
    - A dropdown or radio value must be an active option.
  - `add_comment`
    - Visibility must be `public` or `private`.
    - Provide either a shared `canned_note_id` or a non-empty `body_html`. The body is sanitized with `sanitize_html` on save.

## `DELETE automation-rules/{id}/`
Soft delete (`ItsmModelViewSet.perform_destroy`).

## `GET automation-rules/{id}/runs/`
The last 50 `AutomationRun`s, newest first:
`[{id, rule, ticket, ticket_number, event, status: success|failed|skipped, message, actions_result:[{type, status: done|skipped, detail}], created_at}]`.

## `GET automation-rules/catalog/?project=<id>`
```json
{ "triggers": [{"value","label"}], "actions": [{"value","label"}],
  "update_fields": [{"key","label","filter_key"}],
  "set_fields":    [{"key","label","filter_key","field_type"?}] }
```
- `filter_key` points at the `GET tickets/filter-fields/?project=` entry, which carries the type, options and `options_source` used for the value picker.
- A missing or invalid `project` returns 400; an inaccessible one returns 403.
