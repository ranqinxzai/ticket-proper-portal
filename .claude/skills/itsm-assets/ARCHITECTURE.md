# itsm-assets: Architecture

## Why a separate app
Assets are their own domain (register + configuration + import), so they follow the one-app-per-domain convention (`itsm_surveys`, `itsm_automation`). Nothing in the ticket path imports it; removing the app removes the Assets section and nothing else.

## Scope split (user decision 2026-10-18)
- **Per helpdesk:** `Asset`, `AssetCategory`, `AssetField` (+ options, links), `AssetImport`, `AssetTagSequence`. Every read is clamped by `resolve_helpdesk_scope` (rule 15); every write resolves its target helpdesk with `_require_helpdesk` (403 when not yours).
- **Org-wide:** `AssetStatus`, `Vendor`, `Location`, `Department` — set up once, shared by the IT, HR and Facility helpdesks. Editing them affects every helpdesk; the UI says so.

## One write path (rule 4)
`services/asset_service.py` is the only place assets are written:
- `validate_core(data, helpdesk=, today=, instance=, tag_check=)` — the business rules, shared verbatim with the importer.
- `create_asset` / `update_asset` / `delete_asset` — `@transaction.atomic`; tags under the advisory lock; detail values via `details.write_values`; history via `log_event` in the same transaction (rule 5: explicit, no signals; a rollback leaves no history).
- `expire_if_due` / `sweep_expired` — the expiry rule.
The views only parse input (`AssetWriteSerializer` = types + PK lookups) and map `AssetValidationError` → 400.

## Detail fields: a cousin of the user-attribute engine, not the ticket field engine
The ticket field engine (`itsm_core`) is tied to Ticket/Project in ~25 places (`FieldValue.ticket` non-null, project-scoped layouts, `applies_to`, queue/filter/report registries), and a project-less definition would leak onto every ticket surface. `services/details.py` copies the smaller `itsm_rbac.user_attr_service` pattern with three fixes: dates are `DateField`s, a bad number / unknown choice is an **error** (never a silent blank), and dropdown values are checked against live options.
- **Which fields apply:** the category's links + the sub-category's links; a field linked at both levels takes the sub-category link (required flag, order) but keeps the category's position.
- **`FieldResolver(helpdesk_id)`** loads fields, options and links once; the importer and template use it so there are no per-row queries.
- **Category change:** values of live fields that no longer apply are deleted and logged as `dropped` changes. Values of deactivated/deleted fields are kept (hidden) so re-activating a field brings them back.

## Asset tags
Unique org-wide ignoring case (expression index on `lower(asset_tag)`, live rows). Every tag write takes `pg_advisory_xact_lock(hashtext(current_schema()||':itsm_asset_tag'))` and re-checks; the index is the last guard (`IntegrityError` → 400). Auto tags `<HD>-AST-00001` come from `AssetTagSequence` (`select_for_update`, rule 9), skipping numbers already used by typed-in tags; an import allocates its block once.

## Expiry (user decision: auto-mark Expired)
- **Sweep:** `scheduler.py` registers `assets.expiry_sweep` (cron, minute 5 of every UTC hour — :35 in IST) → `for_each_tenant(sweep_expired)`. It claims rows with `SELECT … FOR UPDATE SKIP LOCKED`, re-checks each, and writes an `auto_expired` event only for rows that changed — safe to run twice at once.
- **In-memory job store, on purpose (rule 23).** Each existing ITSM scheduler adds its own `DjangoJobStore` on the same `django_apscheduler` table, so every scheduler runs every due job (prod log 2026-10-18: ~125 "maximum number of running instances" skips/hour, 3 per tick). The asset job is re-added at boot, so it needs no persistence.
- **"Today"** is the org's default business-calendar time zone (`parsing.org_today`, UTC fallback).
- **On save:** setting a past expiry together with an active status (or an active status on a past-expiry asset) is refused with a clear message. Saving an unchanged active asset whose date has just passed (sweep lag) marks it Expired immediately.
- **On import:** blank Status + past expiry → the Expired target; an explicit active status + past expiry → row error.

## Import pipeline (user decision: good rows saved, bad rows kept)
`services/importer.py`:
1. `read_workbook` — size cap (10 MB), zip-bomb check (150 MB unpacked), `load_workbook(read_only=True, data_only=True)`, rows counted while iterating (5,000 cap), `wb.close()`.
2. `_map_headers` — aliases (`Asset Name`/`Name`, `User`/`Allotted To`…), trailing `*` ignored, detail columns by field name or key, `Errors` column ignored (so the failed-rows file re-uploads), unknown columns → warnings.
3. `_validate_rows` — every lookup pre-loaded (`_Lookups`, `FieldResolver`, live tags), per-row parsing, then the shared `validate_core` and `validate_values(strict_unknown=True)` (a value for a field that doesn't apply is an error). Missing masters become unsaved placeholders when `create_missing` is on.
4. Commit — one transaction: tag lock + re-check (race → row fails), create missing masters (only for valid rows), allocate auto tags, `bulk_create` assets / values / events (`imported`) / failed rows. Measured: 5,000 rows in ~16 s (gunicorn timeout 120 s); export of 4,500 assets ~8 s with 14 queries.
The dry run (`validate/`) runs steps 1–3 only.

## Excel formula guard
`services/xlsx.put` writes every cell. Text starting with `= + - @ \t \r` is stored as plain text with Excel's quote-prefix flag, so it never runs as a formula and round-trips unchanged (no visible apostrophe) through the failed-rows file. This is `_CODING_RULES` rule 22.

## Permissions
Three modules (sort 260–262): `itsm.assets` (Screens), `itsm.assets.import` (Screens), `itsm.assets.config` (Settings). Lookup lists use `AssetLookupPermission` (GET with either Assets or Asset Configuration read). Registry entries are required: on a fresh org `0003_rbac_modules` only finds the `admin` role, and `seed_rbac` grants the rest. `0003` writes explicit rows for every live role including custom ones (FE `hasPerm` is exact-key).
