# itsm-assets: DB Schema

App label `itsm_assets` (TENANT app, per org). Migrations:
- `0001_initial`: every table below. No existing table changes.
- `0002_default_statuses`: the six default statuses (skipped if the org already has any).
- `0003_rbac_modules`: the three `itsm.assets*` modules plus explicit grants for every live role (create-only). Depends on `itsm_rbac/0014_backfill_enforced_module_grants`.

Uniqueness counts **live** rows only (`condition=Q(is_deleted=False)`) and names ignore case (`Lower(...)` expression constraints). DRF does not build validators for expression constraints, so every serializer checks `iexact` itself and the views turn a racing `IntegrityError` into a 400.

## Org-wide tables (no helpdesk FK)

### `AssetStatus` (`BaseModel`)
| Field | Type | Notes |
|---|---|---|
| `name` | CharField(60) | unique ignoring case |
| `key` | SlugField(60) | auto from the name, read-only, unique |
| `state_type` | CharField(20) | `available` · `in_use` · `maintenance` · `retired` · `missing` (`StateType`) |
| `color` | CharField(16) | `#rrggbb`, default `#64748b` |
| `description` | CharField(255) | |
| `sort_order` | PositiveInt | default 100 |
| `is_default` | bool | partial unique (one live default) |
| `auto_expire_target` | bool | partial unique; must be a `retired` type |

`ACTIVE_STATE_TYPES` = available, in_use, maintenance: counted as active and auto-expired.

### `Vendor`, `Location`, `Department` (`BaseModel`)
- **Vendor:** name (150, unique), contact_person, email, phone, website, address, notes, is_active.
- **Location:** name (unique), code (30), address, is_active. Flat list in v1.
- **Department:** name (unique), code, is_active.

## Per-helpdesk tables

### `AssetCategory` (`BaseModel`)
| Field | Type | Notes |
|---|---|---|
| `helpdesk` | FK Helpdesk | PROTECT |
| `parent` | FK self | null = category; set = sub-category. Max two levels (serializer). Immutable after create. |
| `name` | CharField(100) | unique per (helpdesk, parent) ignoring case, **`nulls_distinct=False`** so two top-level names can't clash |
| `description`, `sort_order`, `is_active` | | |

### `AssetField` (`BaseModel`) + `AssetFieldOption` (`BaseModel`)
- **AssetField:** helpdesk, key (slug 80, auto, unique per helpdesk), name (unique per helpdesk ignoring case), `field_type` (`text`, `number`, `date`, `checkbox`, `dropdown`, `multiselect` — the user-attribute set), help_text, is_active.
- **AssetFieldOption:** field (CASCADE), value (100, unique per field ignoring case, never changes once created), label, sort_order, is_active.

### `AssetCategoryField` (`UUIDModel` + timestamps, hard-deleted)
category (CASCADE), field (CASCADE), is_required, sort_order. Unique (category, field). A sub-category inherits its parent's links; when both levels link the same field the sub-category's link wins.

### `Asset` (`BaseModel`)
| Group | Fields |
|---|---|
| General | `name` (200), `asset_tag` (64, unique org-wide ignoring case), `vendor` FK, `category` FK (top-level), `sub_category` FK (child of `category`), `status` FK |
| Location | `location` FK |
| Allotment | `assigned_user` FK User (SET_NULL), `department` FK, `allotment_notes` (≤2,000), `allotted_at` (set when user/department changes, cleared when both empty) |
| Purchase | `purchase_date`, `purchase_cost` Decimal(14,2) ≥ 0, `expiry_date`, `warranty_expiry_date` |
| Other | `helpdesk` FK (PROTECT, never changes), `source_import` FK AssetImport (SET_NULL), `created_by`, `updated_by` |

Masters and categories use PROTECT, but soft delete never fires PROTECT, so `destroy()` checks "in use" explicitly. Indexes: (helpdesk, status / category / location / department / assigned_user), `expiry_date`, `warranty_expiry_date`.

### `AssetFieldValue` (`UUIDModel` + timestamps, hard-deleted)
asset (CASCADE), field (PROTECT), `value_text` / `value_number` Decimal(24,6) / `value_date` **DateField** / `value_bool` / `value_json` (multiselect list). Unique (asset, field). Values of a deactivated or deleted field are kept (hidden); values of a live field that no longer applies are deleted on save and recorded in history.

### `AssetEvent` (`UUIDModel`, append-only)
asset, actor (null = System), `action` (`created`, `imported`, `updated`, `auto_expired`, `deleted`), `changes` `[{field, label, old, new, dropped?}]` (display values, so renames/deletes don't rewrite history), note (255), created_at. Index (asset, -created_at).

### `AssetTagSequence` (plain model)
helpdesk (OneToOne PK), last_number. Locked with `select_for_update`; allocation skips numbers already used by typed-in tags.

### `AssetImport` (`UUIDModel` + timestamps) + `AssetImportRow` (`UUIDModel`)
- **AssetImport:** helpdesk, file_name, total_rows, created_count, failed_count, expired_count, `created_masters` `{vendors|locations|departments: [names]}`, `headers` (as uploaded), `warnings`, created_by.
- **AssetImportRow:** one per FAILED row: import_run (CASCADE), row_number (Excel row), `data` `{header: cell text}`, `errors` `[{column, message}]`.
- The uploaded file is not stored (`/media` is public — BUG_LOG S1).

## Phase 2 (2026-10-23)
- `itsm_assets/0004`: `AssetEvent.action` gains `ticket_linked` / `ticket_unlinked` (note = "TICKET · summary").
- `itsm_tickets/0012`: **`TicketAsset`** (`BaseModel`: ticket CASCADE `asset_links`, asset PROTECT `ticket_links`, `position` (0 = primary), `added_by`; unique (ticket, asset) among live rows; index (asset, is_deleted)) and **`Ticket.primary_asset`** (FK Asset, SET_NULL, `primary_tickets`).
- `itsm_core/0017` (choices: `FieldType.asset_picker`, `AuditEvent` `asset_linked`/`asset_unlinked`) and `0018` (the global `asset` field + layout items; visible only where the helpdesk has asset categories).

