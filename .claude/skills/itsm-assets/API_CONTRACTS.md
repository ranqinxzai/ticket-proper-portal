# itsm-assets: API Contracts

Base `/api/v1/t/<org>/itsm/`. All prefixes start with `asset` (the ITSM apps share one namespace; `statuses/` belongs to workflows).

**Scoping (rule 15):** reads go through `resolve_helpdesk_scope` (`?helpdesk=` narrows, never widens). Writes and downloads that target a helpdesk resolve it with `_require_helpdesk`: missing → 400, unknown → 404, not yours or inactive → 403. Another helpdesk's asset → 404.

**Errors:** asset validation → 400 `{"detail": "Please fix the highlighted fields.", "errors": {field: [msg], "details.<key>": [msg]}}`. Config → DRF `{field: [msg]}`; delete-in-use → 400 `{"detail": ["N assets use this …"]}`.

## Assets — module `itsm.assets`
| Method + path | Notes |
|---|---|
| `GET assets/` | Paginated (25, `page_size` ≤ 500). Filters (ids comma-separated, `none` = empty): `category`, `sub_category`, `status`, `state_type` (type, list or `active`), `location`, `department`, `vendor`, `assigned_user`, `import`, `warranty` (`expiring` ≤30 d · `expired` · `covered` · `none`), `expiry` (`expiring` · `passed` · `none`), `purchased_from/to`, `search` (name, tag, user, detail text). `ordering` keys in `services/filters.ORDERING` (bad keys ignored). DRF filter backends are off for this view. |
| `GET assets/{id}/` | List shape + `allotment_notes`, `allotted_at`, `details` {key: value}, `detail_fields` (the form definitions), `created_by`, `updated_by`, `source_import`, `expiry_passed`. |
| `POST assets/` | `helpdesk` required. Body: name, asset_tag (blank = auto `<HD>-AST-00001`), category, sub_category, status (blank = default), vendor, location, department, assigned_user, allotment_notes, purchase_date, purchase_cost, expiry_date, warranty_expiry_date, `details` {key: value}. 201 → detail shape. |
| `PATCH assets/{id}/` | Any subset. `details` omitted = keep current values (still validated against the category); present = full map for the applicable fields. `helpdesk` ignored. |
| `DELETE assets/{id}/` | Soft delete + `deleted` event. Needs `itsm.assets:delete` (Admin, Supervisor). |
| `GET assets/{id}/history/` | Latest 200 `AssetEvent`s. |
| `GET assets/summary/` | Dashboard: totals, `by_state_type`, `warranty_expiring` / `out_of_warranty` / `expiring` (active assets, 30-day window), `by_category` / `by_location` / `by_department` (top 10 + "N more"), `by_status` (colour, state type), `warranty_ending` (10), `recent` (5). Accepts the list filters. |
| `GET assets/report/?group_by=` | `category` (default) · `sub_category` · `status` · `state_type` · `location` · `department` · `vendor` · `assigned_user` → `{rows:[{key,label,count,cost,percent}], total:{count,cost}}`. Accepts the list filters. |
| `GET assets/export/?helpdesk=&group_by=` | xlsx: Summary sheet (grouped) + Assets sheet (every column + every active detail field, frozen header, real date/number cells, formula-safe). Up to 20,000 rows. |
| `GET assets/form-fields/?category=&sub_category=` | The detail fields that apply: `[{id,key,name,field_type,help_text,is_required,inherited,options}]`. |

**Validation (service, shared with import):** name required ≤200; tag ≤64, unique ignoring case (create/edit lock + re-check); category in this helpdesk and top-level; sub-category a child of it; inactive masters/categories can't be newly picked (an existing one survives other edits); `in_use` needs `assigned_user` or `department`; expiry/warranty not before purchase; **past expiry + active status refused when either was changed in this request**; detail values typed (bad number / unknown choice = error), required fields enforced (a required dropdown without options is skipped).

## Import — module `itsm.assets.import`
| Method + path | Notes |
|---|---|
| `GET asset-imports/template/?helpdesk=` | xlsx: Instructions, Assets (headers + header comments + list drop-downs, warning style), Lists, Fields by category. |
| `POST asset-imports/validate/` | Multipart `helpdesk`, `file`, `create_missing` (0/1). Check only — nothing saved, no record. 200 → result. |
| `POST asset-imports/` | Same body. Good rows saved, failed rows kept. 201 → result with `import_id`. |
| `GET asset-imports/` | History (paginated). |
| `GET asset-imports/{id}/` · `…/rows/` · `…/failed-rows/` | Run · paginated failed rows · xlsx of failed rows (uploaded columns + `Errors`, formula-safe; re-uploadable). |

Result: `{dry_run, import_id?, total_rows, valid_rows, failed_count, expired_count, will_create:{vendors|locations|departments:[names]}, warnings:[], failed_rows:[{row_number, data, errors:[{column,message}]}] (first 500)}`.
- `create_missing=1` also needs `itsm.assets.config:create` (403 otherwise).
- File errors → 400 `{"detail", "errors": {"file": [...]}}`: not xlsx, > 10 MB, > 150 MB unpacked, > 5,000 rows, no Asset Name / Category column, empty.

## Configuration — module `itsm.assets.config` (`AssetLookupPermission`)
GET is allowed with **`itsm.assets:read` OR `itsm.assets.config:read`** (the lists feed the form pickers); writes follow `itsm.assets.config` + the HTTP method. All unpaginated.

| Path | Notes |
|---|---|
| `asset-statuses/` | Moving `is_default` / `auto_expire_target` clears the old one. Target must be `retired`. Can't delete the default or a status in use. `asset_count` annotated. |
| `asset-vendors/`, `asset-locations/`, `asset-departments/` | `?active=1`, `?search=`. Delete in use → 400 (deactivate instead). `asset_count`. |
| `asset-categories/` | `?helpdesk=`, `?active=1`. Body: helpdesk, parent, name, description, sort_order, is_active. Two levels max; parent/helpdesk immutable. Delete refused when any asset uses it or its children; otherwise children + links go too. Includes `field_links`. `POST asset-categories/load-starter/ {helpdesk}` → `{fields, categories, links}` (idempotent). |
| `asset-fields/` | Body: helpdesk, name, field_type, help_text, is_active, `options_input` (full list; existing by id: label/order/active editable, value never changes; missing → soft-deleted). Type can't change once values exist. Delete: soft delete + unlink, values kept hidden. Includes `options`, `used_by`, `value_count`. |
| `asset-category-fields/` | `?category=`. category + field must share a helpdesk; no duplicates. PATCH `is_required`, `sort_order`. Hard delete. |
| `asset-users/?search=` | `{id, username, full_name, email}`, active non-bot users. Exists because `/users/` needs `itsm.tickets:read`. |

Config writes are recorded in the admin audit log (`AUDITED_AREAS["itsm.assets.config"]`). Asset and import writes are not (they have their own history).

## Phase 2 (2026-10-23) — tickets
| Method + path | Notes |
|---|---|
| `GET assets/{id}/tickets/` | `{count, open_count, results:[{id, ticket_number, summary, helpdesk_key, project_key, status_name, status_color, status_category, priority, requestor, assignee, created_at, linked_at, is_primary}]}` — live links, open first then newest, ≤500, clamped by helpdesk + per-user project whitelist. |
| `POST tickets/` | `assets: [asset ids]` (order = primary first). 400 `{"asset": [msg]}` for another helpdesk's / unknown asset; required-field 400 `{"asset": ["Asset is required."]}`. |
| `GET/POST tickets/{id}/assets/` · `POST …/assets/unlink/` · `POST …/assets/primary/` | Body `{assets:[ids]}` / `{asset: id}` + optional `expected_updated_at` (409 `stale_write`). Writes need `itsm.tickets` **update**. Response `{assets:[…], updated_at}`; item = `{link_id, id, asset_tag, name, category, sub_category, status{name,color,state_type}, location, assigned_user, is_primary, is_deleted}`. |
| `GET portal/request-intake/my-assets/?project=` | The caller's own active assets in that project's helpdesk. Portal create takes `fields.asset = [ids]`; ids not allotted to the caller → 400. |

