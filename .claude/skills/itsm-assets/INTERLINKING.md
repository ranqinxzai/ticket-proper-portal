# itsm-assets: Interlinking

Since phase 2 (2026-10-23) tickets link to assets:
- **itsm-tickets**: `TicketAsset` + `Ticket.primary_asset` (migration `itsm_tickets/0012`, depends on `itsm_assets/0003`); write path `services/ticket_assets.py`; create (`create_ticket(assets=)`), ticket actions `assets/ · assets/unlink/ · assets/primary/`, portal `my-assets` + intake. `AssetEvent.ticket_linked/ticket_unlinked` are written from there.
- **itsm-fields / itsm-core**: the global `asset` system field (`FieldType.ASSET_PICKER` in `NO_VALUE_TYPES`, `maps_to="assets"`), seeded by `itsm_core/seed.py` and `0018`; `validate_required` now checks it (only attachments are skipped).
- **itsm-reporting**: Ticket Data columns `asset` / `all_assets`.
- `AssetViewSet.tickets` reuses `scope_ticket_queryset` + `scope_ticket_queryset_by_project` so the asset page never lists a ticket the caller can't open.

- **itsm-core**: `BaseModel` / `UUIDModel` / `TimeStampedModel`; `scheduler_boot.should_run_scheduler` + `run_scheduler.py` (assets entry); `seed_itsm` step "Default asset statuses"; `AdminAuditMixin` records config writes because `itsm.assets.config` is in `AUDITED_AREAS`.
- **itsm-rbac**: three modules in `registry.MODULES` (`ADMIN_MODULE_CODES` has `itsm.assets.config`; `AGENT_RW_MODULES` has `itsm.assets`; `AGENT_RO_MODULES` has `itsm.assets.config`; `MODULE_COPY` descriptions); `HasModulePermission` / `check_permission`; backfill migration `itsm_assets/0003`.
- **itsm-helpdesks**: `resolve_helpdesk_scope`, `accessible_helpdesk_ids_cached`, `_resolve_helpdesk_id` (rule 15); `Helpdesk.key` is the auto-tag prefix.
- **itsm-sla**: `BusinessCalendar` (default calendar's `timezone`) decides "today" for the expiry rule.
- **accounts**: `UserDirectorySerializer` + `system_usernames()` for the `asset-users/` picker; `User.full_name` / `email` for import lookups.
- **tenants**: `for_each_tenant` runs the hourly sweep in every org schema.
- **itsm-reporting**: no code dependency; the asset export copies its workbook style (brand header, frozen header row) and adds the formula guard the ticket export lacks.
- **itsm-fields**: deliberately NOT reused (see ARCHITECTURE). The user-attribute engine in `itsm_rbac` is the model.

See [[itsm-rbac]], [[itsm-helpdesks]], [[itsm-core]], [[itsm-reporting]].
