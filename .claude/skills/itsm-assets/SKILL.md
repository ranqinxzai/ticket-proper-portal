# itsm-assets

## Update (2026-10-31) — Asset documents (invoice, warranty card, manual, other)
GridCrest asked to keep an asset's invoice and other paperwork with the asset, in the right-hand rail. User decisions:
- **Types:** a fixed list of Invoice / Warranty card / Manual / Other, not configurable. Each file can have an optional note, and an asset can hold many files of each type.
- **Who:** anyone who can edit the asset adds and removes files; anyone who can view it downloads them.
- **Privacy:** files are private, with no public URL.

**Model and migration:**
- `AssetDocument(BaseModel)` has: `asset` (FK CASCADE, `documents`), `doc_type`, `file`, `original_name`, `size_bytes`, `content_type`, `note` (255) and `uploaded_by`.
- `AssetEvent.Action` gains `document_added` / `document_removed`; the note reads "Invoice · inv.pdf".
- Migration `itsm_assets/0005_assetdocument` is additive.

**Storage:**
- Files go to `media/itsm_private/asset_documents/<asset>/<uuid4hex><ext>`. The name on disk is random; the real name is kept only on the row.
- nginx `location ^~ /media/itsm_private/ { return 404; }` is in both `nginx/default.prod.conf` and `default.conf`, before `/media/`.
- ⚠️ The prod conf is a single-file bind mount. Editing it on the host replaces the inode, so the running `ticketprod-nginx` keeps the old file. On deploy, recreate or restart the container, then check with `docker exec ticketprod-nginx grep itsm_private /etc/nginx/conf.d/default.conf`.

**Write path:** `services/documents.py`.
- `validate_upload` rules:
  - `ALLOWED_TYPES` maps extension → Content-Type for pdf, png, jpg/jpeg, gif, webp, doc/docx, xls/xlsx and txt. **No html, svg or archives**, because PDFs and images open in a browser tab.
  - `MAX_BYTES` is 20 MB (nginx caps request bodies at 25M).
  - `NOTE_MAX` is 255.
- **The content type comes from the extension, never from the client.**
- `add_document` and `remove_document` each write the row and the `AssetEvent` in one transaction. Removal is a soft delete, and the file stays on disk (like ticket attachments).

**API:** actions on `AssetViewSet`. `get_object()` keeps rule 15, so another helpdesk's asset is a 404.
- `GET/POST assets/{id}/documents/`. The list is ordered Invoice → Warranty → Manual → Other, newest first within a type, and **has no file URL**.
- `DELETE assets/{id}/documents/{doc}/`.
- `GET assets/{id}/documents/{doc}/download/` returns a `FileResponse` as an attachment, with the stored type and `nosniff`.

**RBAC:** `permissions.AssetDocumentPermission`. Reads need `itsm.assets` read. POST and DELETE need `itsm.assets` **update**, not create/delete; otherwise Agents couldn't remove a file. No new module code.

**Frontend:**
- `components/assets/asset-documents.tsx` (`AssetDocuments`) sits between `AssetTickets` and `AssetHistory` on `assets/list/[assetId]/page.tsx`. Its `onChanged` bumps `historyKey`.
- **Add dialog:**
  - Type defaults to Invoice until the asset has one, then Other.
  - Client-side extension and size checks mirror the server's.
  - The `accept` list matches the allowlist.
- **Opening a file:**
  - **PDFs and images open in a new tab.** The tab is opened inside the click, because popup blockers allow only that, and then pointed at a blob URL from `assetsApi.documentBlob`.
  - Every other type downloads through `assetsApi.downloadDocument`, which uses `doc.original_name`. `getBlob`'s filename regex mis-reads Django's `filename*=` form for non-ASCII names.
  - In headless Chromium a PDF downloads in the new tab, because there is no viewer.
- **Removal** confirms first (`ConfirmDialog`).
- **Shared edits:**
  - `itsmClient.blob(path)` exposes `getBlob`.
  - `asset-history.tsx` has FilePlus/FileX icons.
  - The asset-form `<aside>` is now `aria-label="Tickets, documents and history"`. Two unnamed asides tripped axe `landmark-unique`; that was pre-existing.
- **Copy:** `ASSET_DOC_HELP` in `lib/itsm/help/assets.ts`, and the Help Center article `assets-documents`.

**Verified:**
- `tests/test_documents.py` (10 tests). They override MEDIA_ROOT to a temp dir, so they pass with the read-only test mount. The itsm_assets total is 79.
- Isolated `gcb-*` stack using the real `default.prod.conf`:
  - curl: 201 / 400 html / 403 viewer / 401 anonymous; `nosniff` and the bytes match; a direct `/media/itsm_private/…` returns 404 while normal `/media/` returns 200.
  - Playwright: card order, defaults, the 21 MB refusal, list order, History, image in a new tab, the txt download name, remove plus History, the viewer sees no Add/Remove, and axe is clean on the rail and the dialog.

**Not done:**
- No Documents column in the list, report or export.
- No restore UI; a removed file can be recovered only from the DB/disk.
- No per-asset count limit.
- Documents can't be added on the New asset page (save first).

## Update (2026-10-29) — Requestor's assets: top 3 + "Show N more"
- `asset-link-field.tsx` `RequestorSuggestions` shows the first `SUGGESTION_PREVIEW = 3` unlinked chips (asset-tag order), then a "Show N more" / "Show less" toggle (`aria-expanded`). This covers the ticket detail and the create form; a GridCrest requestor with 16 assets had filled the side rail. The linked list, the finder and the portal checkbox list are unchanged.

## Update (2026-10-24) — Sidebar category tree under Asset List (ManageEngine-style)
User asked: keep Asset List as "all assets", and add an expandable category → sub-category tree that lists assets for the chosen node, like ServiceDesk Plus's "All Assets" panel. Decisions: **in the left sidebar** (not a panel inside the page); **show counts**.
- **Frontend only. No API, model or migration change.**
  - `components/agent/workspace/asset-category-nav.tsx` (`AssetListNav`) replaces the expanded-sidebar Asset List `NavLink` in `workspace-nav.tsx`, inside `<Suspense>` because it reads `useSearchParams`.
  - The icon rail keeps the plain link.
- **Data:** one `assetCategoriesApi.list({helpdesk})` call, made when the tree opens and again on each navigation while open.
  - **Counts:** `AssetCategory.asset_count` (live assets as category + as sub-category). A top-level count already includes its sub-categories; every status counts; soft-deleted assets don't.
  - **No sub-category** node: shown when the category has subs, with count = parent − Σ subs.
  - **Inactive categories** stay listed while they hold assets.
- **Links:** `assets/list?category=<id>[&sub_category=<id>|none]` (the list's existing URL filters; the backend `filters.py` already handles `none`). Asset List itself stays unfiltered.
- **Active state:** a node is `aria-current` when the URL matches it; Asset List is current only with no category.
- **Open state:** the tree's open state is in localStorage `itsm-asset-tree-open` (try/catch). A `?category=` in the URL forces it open and expanded to that category.
- **List page:** the description shows the branch, e.g. "Computer › Laptop · Showing 1–2 of 2 assets".
- **No total on Asset List:** dropped, because at the 192px minimum sidebar width it truncated the label; the list header shows it.
- **Copy:** `ASSET_HELP.navTree` (toggle `detail`); Help Center `assets-find-add` → "Browse by category".
- **Verified:** Playwright 15/15 on an isolated stack (tree counts = filtered list totals at category / sub / No sub-category; aria-current; reload; persistence; 192px no overflow; axe clean; rail hides it).

## Update (2026-10-23) — Phase 2: assets linked to helpdesk tickets (deployed 2026-10-24)
User asked: an "Asset" system field; link assets while creating a ticket; default to the requestor's assets but allow any; filters in the picker; Asset in the Ticket Data report; the asset page lists its tickets. Decisions: **no on/off switch**; **several assets per ticket, first = primary**; filters live in the picker (no queue filter yet); **portal requestors pick only their own assets**.
- **Storage:** `itsm_tickets.TicketAsset(ticket, asset PROTECT, position, added_by)` (BaseModel, live-only unique (ticket, asset); unlink = soft delete, re-link = new row) + denormalised `Ticket.primary_asset` (position 0). Single write path `itsm_tickets/services/ticket_assets.py`: `resolve_assets(helpdesk_id, ids, owner=)`, `link_initial` (create), `link_assets` / `unlink_asset` / `make_primary` (stale-write guard, `updated_at` stamp, primary kept in sync), `asset_items`.
- **History both sides:** ticket `AuditEvent` `asset_linked` / `asset_unlinked` (payload `{assets:[{id,asset_tag,name}], primary?}`); asset `AssetEvent` `ticket_linked` / `ticket_unlinked` (note "TICKET · summary").
- **The field:** global system `FieldDefinition` `key="asset"`, type **`asset_picker`** (in `NO_VALUE_TYPES`: never a FieldValue, never a transition-screen field, never in automation / queue columns / filters), `config.maps_to="assets"`. Not creatable from the Fields tab. Default layout item: People section, sidebar, Portal on; **hidden unless the project's helpdesk has asset categories** (`seed.helpdesk_uses_assets`, migration `itsm_core/0018` for existing projects). Admins show/hide/require it per layout.
- **APIs:** `POST tickets/` `assets: [ids]`; `GET/POST tickets/{id}/assets/`, `POST …/assets/unlink/`, `POST …/assets/primary/` (`itsm.tickets` update); detail `assets[]`, list `primary_asset`; portal `GET portal/request-intake/my-assets/?project=` (own active assets) + intake `fields.asset` (owner-checked → 400 otherwise); `GET assets/{id}/tickets/` (rule-15 clamped, open first).
- **Report:** Ticket Data columns **Asset** ("TAG · Name", primary) and **All assets** (tags).
- **Frontend:** `components/assets/asset-link-field.tsx` (chips, Requestor's assets row, "Find another asset" dialog with Category / State / Location / Department / Assigned-to filters, portal checkbox variant); create form override (`isAssetField`, auto-select the requestor's only active asset until the agent edits the field); detail FieldView edit (link / unlink / primary diff with 409 handling); `components/assets/asset-tickets.tsx` card above History.
- Migrations: `itsm_tickets/0012`, `itsm_core/0017` (choices) + `0018` (field + layouts), `itsm_assets/0004` (choices). Tests: `itsm_tickets/tests_assets.py` (20).

## Purpose
**Asset Management v1 — basic IT assets** (built 2026-10-19; **deployed to onedesk prod 2026-10-20**, migrations `itsm_assets` 0001–0003 in every org; orgs start with no categories → **Load IT starter set**). Each helpdesk keeps an asset register in the workspace sidebar section **Assets** (Asset Dashboard · Asset List · Asset Report). An asset has five form sections — **General** (name, tag, vendor, category, sub-category, status), **Location**, **Allotment** (user, department, notes), **Purchase** (purchase date and cost, expiry date, warranty expiry date) and **Details** (fields decided by the category / sub-category, e.g. a Server shows Hostname / IP Address, a Printer shows Toner Model). Assets can be bulk-imported from Excel.

It is a cut-down Phase A of `docs/itsm/ASSET_MAINTENANCE_PLAN.md` (ticket links, AMC, maintenance and the portal come later). Approved plan: `~/.claude/plans/before-touching-any-code-fluttering-popcorn.md`.

**User decisions (2026-10-18):** per-helpdesk assets/categories/fields with org-wide statuses + Vendor/Location/Department masters; an Expiry Date that has passed auto-marks the asset Expired; import saves the good rows, skips the bad ones and keeps them on an import screen; import is create-only.

## Backend app path
`backend/apps/itsm_assets/` — a TENANT app (last in `TENANT_APPS`), routes mounted in `core/urls.py`.

## Key concepts
- **State types** (fixed `StateType`): `available`, `in_use`, `maintenance`, `retired`, `missing`. **Statuses** (`AssetStatus`, org-wide, configurable) each map to one. Defaults: In Stock (default, available), In Use, In Repair (maintenance), Expired (retired, **auto-expire target**), Disposed (retired), Lost (missing). Behaviour always branches on the state type, never on a status key.
- **Active** = available / in_use / maintenance. Counted as active on the dashboard and auto-expired.
- **Rules:** an `in_use` status needs a User or a Department; expiry / warranty dates can't precede the purchase date; a past Expiry Date can't be saved together with an active status (when either changed in that request).
- **Category tree:** category (top level) → sub-category; two levels; per helpdesk. **Detail fields** (`AssetField`, per-helpdesk library; text/number/date/checkbox/dropdown/multiselect) are linked to nodes by `AssetCategoryField` (required flag, order). A sub-category inherits its category's links; if both link a field, the sub-category's link wins.
- **Asset tag:** optional on create (blank → `<HD>-AST-00001`), unique org-wide ignoring case, reusable after delete.
- **History:** `AssetEvent` (created / imported / updated with old → new / auto_expired by System / deleted).
- **Import:** template → check only (dry run) or import → good rows saved, failed rows kept (`AssetImportRow`) → download failed rows (+ Errors column) → fix → re-upload.

## The write path
```
views.AssetViewSet.create/update/destroy ─┐
importer.run_import (bulk) ───────────────┼─► services/asset_service.validate_core (shared rules)
                                          │      + services/details.validate_values (typed details)
                                          │      + services/tags (advisory lock, auto tags)
                                          └─► Asset / AssetFieldValue / AssetEvent in one transaction
scheduler (cron :05 UTC hourly) → for_each_tenant(asset_service.sweep_expired)  (in-memory job store)
```

## Frontend
- **Sidebar** (`components/agent/workspace/workspace-nav.tsx`): section **Assets** with Asset Dashboard (`assets/dashboard`), Asset List (`assets/list`), Asset Report (`assets/report`), gated on `hasPerm("itsm.assets","read")`. Detail / new / imports live under `assets/list/…` so the List item stays lit.
- **Routes** `app/t/[org]/(agent)/agent/w/[helpdeskKey]/assets/`: `layout.tsx` (permission gate), `page.tsx` (→ dashboard), `dashboard`, `list`, `list/new`, `list/[assetId]`, `list/imports`, `list/imports/[importId]`, `report`.
- **Settings** `…/settings/assets/{categories,statuses,vendors,locations,departments}` + an "Asset Configuration" group in `settings-nav.tsx` and cards on `settings/page.tsx` (shown with `itsm.assets.config` read). Configuration is admin-only in the sidebar, so every Assets page also has a **Configure** button for users with config read.
- **Components** (`components/assets/`): `asset-form.tsx` (5 section cards; detail fields render through `AttributeInput` via an adapter; expiry notice with **Use Expired**; In-use hint; category-change confirm listing the values to be removed), `asset-history.tsx`, `asset-table.tsx` + `asset-filters.tsx` + `asset-pager.tsx` + `use-asset-url-state.ts` (filters, page, ordering and group_by in the URL), `asset-import-dialog.tsx`, `category-tree-editor.tsx` + `asset-field-dialog.tsx`, `asset-statuses-editor.tsx`, `asset-master-list.tsx` (Vendors / Locations / Departments), `asset-status-badge.tsx`, `asset-settings-gate.tsx` (read-only banner + "Shared by all helpdesks"), `use-asset-lookups.ts`, `asset-utils.ts`, `confirm-dialog.tsx`, `asset-back-link.tsx`.
- **Shared edits:** `report-views.tsx` gained an optional `actionLabel` (asset tiles say "View assets"); `user-search-combobox.tsx` gained optional `search` (the asset form uses `asset-users/`) and `id` (so a `<label htmlFor>` names the combobox — axe `button-name`).
- **Copy:** `lib/itsm/help/assets.ts` (rule 16); `MODULE_HELP` entries in `lib/itsm/help/admin.ts`; Help Center section `assets` (4 articles + 2 FAQs) in `lib/itsm/help-content.ts`.

## API clients
`lib/itsm/assets-api.ts`: `assetsApi` (list/get/create/update/delete/history/summary/report/export/formFields), `assetImportsApi` (list/get/rows/template/failedRows/validate/run), `assetStatusesApi`, `vendorsApi`, `locationsApi`, `departmentsApi`, `assetCategoriesApi` (+ `loadStarter`), `assetFieldsApi`, `assetCategoryFieldsApi`, `assetUsersApi`. Types: `lib/itsm/assets-types.ts`. Permission hook: `lib/itsm/asset-perms.ts` (`useAssetPerms`).

## RBAC module codes
| Module | Admin | Supervisor | Agent | Requestor / custom |
|---|---|---|---|---|
| `itsm.assets` (Screens) | CRUD | CRUD | read/create/update | none |
| `itsm.assets.import` (Screens) | CRUD | CRUD | none | none |
| `itsm.assets.config` (Settings) | CRUD | CRUD | read | none |
Asset documents (2026-10-31) have no module of their own: list/download = `itsm.assets` read, add/remove = `itsm.assets` **update** (`AssetDocumentPermission`).
Lookups (`asset-statuses/`, masters, categories, fields, `asset-users/`) are readable with either Assets or Config read. Import's "create missing" also needs Config create. Config writes are in the admin audit log.

## Key files
- `models.py` — every model + `StateType`, `ACTIVE_STATE_TYPES`, `FieldType`.
- `services/asset_service.py` — `validate_core`, `create_asset`, `update_asset`, `delete_asset`, `expire_if_due`, `sweep_expired`, `log_event`.
- `services/details.py` — `FieldResolver`, `coerce`, `validate_values`, `write_values`, `field_definition`.
- `services/tags.py` — `lock_tags`, `allocate`, `tag_taken`.
- `services/importer.py` — `read_workbook`, `_map_headers`, `_validate_rows`, `run_import`.
- `services/xlsx.py` — `put` (formula guard), `build_template`, `build_export`, `build_failed_rows`.
- `services/filters.py` (list filters + ordering), `services/summary.py` (dashboard + report), `services/starter.py` (IT starter set), `services/parsing.py` (dates, costs, booleans, `org_today`).
- `services/documents.py` — `ALLOWED_TYPES`, `MAX_BYTES`, `validate_upload`, `add_document`, `remove_document` (2026-10-31).
- `views.py`, `serializers.py`, `permissions.py` (`AssetLookupPermission`), `urls.py`, `scheduler.py`, `seed.py`.
- `tests/` — 69 tests (API, config, import, expiry + migrations).
- Touch-points: `itsm_rbac/registry.py`, `itsm_core/services/audit.py` (`AUDITED_AREAS`), `itsm_core/management/commands/seed_itsm.py`, `…/run_scheduler.py`, `core/settings.py`, `core/urls.py`.

## Deferred (later phases)
(Ticket↔asset links + pickers: done 2026-10-23; invoice / warranty / manual documents: done 2026-10-31, see the updates at the top.) Documents column / "has invoice" filter; queue filter/column on asset; email auto-link; check-out / acknowledgement; contracts / AMC + reminders; maintenance plans; portal "My assets"; QR labels; import updates and bulk edit; depreciation; currency; make/model master; location hierarchy.
