# itsm-assets: Bug Log

Gotchas found while building v1 (2026-10-19).

- **DRF auto-validators fight the "only one" flags.** `UniqueConstraint(fields=["is_default"], condition=…)` makes DRF 3.15 add a field-level `UniqueValidator`, so "make this the default" returned 400 before `save()` could move the flag. Fixed with `extra_kwargs={"is_default": {"validators": []}, …}`; `save()` clears the old flag in the same transaction.
- **DRF builds no validator for expression constraints** (`Lower("name")`, `Lower("asset_tag")`), so a duplicate would have been a 500. Every serializer checks `iexact`, and the asset views map `IntegrityError` to a 400.
- **`nulls_distinct=False` is needed on the category name constraint**: with `parent` NULL for top-level categories, Postgres treats NULLs as distinct and would allow two "Computer" categories.
- **Soft delete never triggers `on_delete=PROTECT`.** Status, master and category deletes check "in use" explicitly.
- **DRF's default `OrderingFilter` re-ordered the asset list by raw FK ids** (e.g. `?ordering=status`). The asset ViewSet sets `filter_backends = []`; `services/filters` does search, filters and ordering.
- **Export was 32 s for 4,500 rows**: `org_timezone()` ran a query per date cell. The time zone is now read once per export (~8 s, 14 queries).
- **openpyxl turns any string starting with "=" into a formula** (also in test fixtures). `xlsx.put` sets `data_type="s"` + `quotePrefix`; the test helper does the same for uploaded fixtures.
- **`DjangoJobStore` shared by several schedulers runs every job in each of them** (prod). The asset scheduler uses the in-memory store; the existing SLA / notifications / email schedulers still have the problem (docs/BUG_LOG.md 2026-10-19).
- **`/users/` needs `itsm.tickets:read`**, so a custom role with only asset permissions couldn't pick users. Added `asset-users/` (same minimal shape) gated on asset read.
- **A `<button role="combobox">` isn't named by its text** (axe `button-name`, critical) — the shared `UserSearchCombobox` trigger had no name. Added an optional `id` prop so the field's `<label htmlFor>` names it; the asset form passes `asset-user`. Other callers (groups, routing, email channel sheets) don't pass an id yet.
- **Expiry copy said ":05 every hour"** but the cron runs on the UTC clock (:35 in IST). The copy now says "once an hour".

Phase 2 (2026-10-23):
- **`validate_required` skipped every `NO_VALUE_TYPES` field**, so putting `asset_picker` there (to keep it out of FieldValue, screens, automation and queue columns) would have made a Required Asset field unenforceable. It now skips only attachments.
- **Create-time audit order:** the link rows are written inside `create_ticket`, but `asset_linked` is logged in its `_after`, after `ticket_created`, so Activity reads in the right order.
- **A `role="separator"` resize handle without `aria-valuenow`** (peer change in `workspace-chrome.tsx`, 2026-10-23) showed as a critical axe issue on every agent page; reported, and that session fixed it the same day (aria-valuenow from the stored/measured width).

