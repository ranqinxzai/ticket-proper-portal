# Asset Management + Maintenance module — design and implementation plan

_Prepared 2026-10-15. Companion to `ROADMAP_2026-2027.md` (replaces the Q3 "Asset / CMDB"
line) and `PHASE0_IMPLEMENTATION_PLAN.md`. Scope modelled on Snipe-IT's asset tracking and
the ticket↔asset linking found in Jira Service Management / Freshservice, fitted to OneDesk's
existing engines (field engine, notification outbox, scheduler, RBAC, portal, standard
projects). Sizes: S ≤ 3 days, M ≤ 2 weeks, L ≤ 6 weeks._

## 0. What the user asked for, and what is filled in
Asked: assets linked to tickets; pick the requestor's asset while creating a ticket; asset
history; AMC (annual maintenance contract) expiry reminders; AMC scope.
Filled in (needs confirmation, marked **[confirm]** below): asset lifecycle and
check-out/check-in, categories/models/vendors/locations, warranty as well as AMC, preventive
maintenance schedules, consumables/licences, QR labels, CSV import, portal "My assets",
reports and RBAC. Everything is scoped **per helpdesk** like projects are.

---

## 1. Concepts and vocabulary

| Term | Meaning in OneDesk |
|------|--------------------|
| **Asset** | A single tracked thing with an asset tag: laptop, printer, server, AC unit, UPS, projector, vehicle. Has a lifecycle status and (optionally) an assigned user or location. |
| **Asset Model** | Make + model template (e.g. "Dell Latitude 5440"): category, manufacturer, default warranty months, default custom-field set, image. Assets inherit from it. |
| **Category** | Hierarchical type (Hardware → Laptop). Decides which custom fields apply and which icon shows. |
| **Vendor** | Supplier / AMC provider / manufacturer. One entity, three roles via flags. |
| **Location** | Site → Building → Floor → Room tree. Assets and users can both have a location. |
| **Contract** | A **Warranty** (from manufacturer, per asset, from purchase date) or an **AMC** (from a vendor, covers many assets, has a *scope*, cost, SLA, renewal). Both have start/end dates and feed reminders. |
| **AMC scope** | What the contract covers: covered asset list (explicit or by category/location), service types (preventive visits per year, breakdown calls, parts included/excluded, on-site vs carry-in, response/resolution hours), exclusions, contact person, escalation matrix. Stored structured + free text. |
| **Maintenance plan** | A recurring preventive-maintenance (PM) schedule on an asset or a group of assets: every N days/months, or a fixed date list. Each due occurrence generates a **maintenance ticket**. |
| **Maintenance record** | The outcome of one maintenance event (preventive, breakdown, upgrade, inspection): what was done, by whom (vendor/agent), cost, downtime, parts, next due. Always linked to a ticket. |
| **Asset history** | Append-only timeline per asset: created, status changes, assignment/check-out/check-in, location moves, field edits, contracts attached, tickets linked, maintenance done, imported, retired. |

---

## 2. Data model (new app `apps/itsm_assets`, TENANT schema)

All models extend `itsm_core` `BaseModel` (UUID pk, timestamps, soft delete). Every
business row carries `helpdesk` FK so the existing `accessible_helpdesk_ids_cached`
clamping pattern applies unchanged.

```
AssetCategory      helpdesk, parent (tree), name, icon, code, is_active
Manufacturer       helpdesk?, name, support_url, support_phone, support_email          (tenant-global, helpdesk nullable)
Vendor             helpdesk?, name, roles{supplier,amc_provider,manufacturer}, contacts JSON, gst/tax id, address, notes
Location           helpdesk?, parent (tree), name, code, kind{site,building,floor,room,other}, address, timezone
AssetModel         helpdesk, category, manufacturer, name, model_number, default_warranty_months,
                   image, spec JSON (cpu/ram/…), eol_date, notes
Asset              helpdesk, asset_tag (unique per helpdesk, auto "HD-AST-000123" via TicketSequence-style
                   counter, overridable), name, model (AssetModel), category (denorm from model, overridable),
                   serial_number (unique per helpdesk, nullable), status (see §3), condition{new,good,fair,poor,damaged},
                   assigned_to (User, nullable), assigned_group (Group, nullable), location (nullable),
                   purchase_date, purchase_cost, currency, invoice_number, po_number, supplier (Vendor),
                   warranty_months, warranty_until (computed, stored), eol_date,
                   depreciation_months (nullable → straight-line book value), salvage_value,
                   parent_asset (nullable; a docking station under a laptop, a blade in a chassis),
                   image, qr_token (opaque, for labels), notes_html/notes_text,
                   last_audit_at, next_pm_due (denorm from plans), retired_at, retire_reason
AssetFieldValue    EAV like itsm_core FieldValue — REUSE `itsm_core.models.fields` by adding an
                   `applies_to="asset"` scope + `category` FK on FieldDefinition (see §6)
AssetAssignment    asset, user?, group?, location?, checked_out_at, checked_out_by, expected_return_at,
                   checked_in_at, checked_in_by, condition_out, condition_in, note, acknowledgement{pending,accepted,declined}
Contract           helpdesk, kind{warranty,amc,lease,support,licence}, reference_no, name, vendor,
                   start_date, end_date, auto_renew, renewal_notice_days, cost, currency, billing{one_time,monthly,quarterly,yearly},
                   status{draft,active,expiring,expired,renewed,cancelled} (derived nightly),
                   scope JSON (see §4), scope_text, documents (attachments), owner (User), notes
ContractAsset      contract, asset, covered_from, covered_until (defaults to contract dates), notes
ContractRule       contract, match JSON {category_ids, location_ids, model_ids} — auto-cover rule, evaluated nightly
MaintenancePlan    helpdesk, name, kind{preventive,inspection,calibration,audit}, applies_to {asset_ids | category/location/model rule},
                   recurrence{every_n_days, every_n_months, cron-ish day-of-month, fixed_dates[]}, lead_days (create ticket N days before due),
                   project (which project receives the generated ticket), ticket_type, default_group, assignee, priority,
                   checklist JSON [{text, required}], contract (optional; "covered by AMC #…"), is_active, last_generated_for
MaintenanceRecord  asset, ticket, kind{preventive,breakdown,upgrade,inspection,relocation,other}, performed_at, performed_by_user?,
                   performed_by_vendor?, cost, parts JSON, downtime_minutes, checklist_result JSON, outcome{completed,partial,failed,deferred},
                   next_due_at, notes_html, contract (which AMC covered it)
AssetEvent         asset, actor, action (see §7), payload JSON, ticket? — the asset history (append-only; explicit log_event, no signals)
Consumable         helpdesk, name, category, qty_on_hand, min_qty, unit, location, model_compat JSON   [confirm — v2]
Licence            helpdesk, name, vendor, seats_total, seats_used (derived), key (Fernet-encrypted), expiry_date, contract?   [confirm — v2]
LicenceSeat        licence, user?, asset?, assigned_at
AssetImportJob     helpdesk, file, status, rows_total/ok/failed, error_report, created_by
```

**Ticket link (in `itsm_tickets`, migration):**
```
TicketAsset        ticket, asset, role{affected,requested,replacement,related}, added_by, added_at
Ticket.primary_asset  (nullable FK; the one shown in queue column / SLA reports)
```
`TicketAsset` is a first-class link rather than a custom field so history, reports, bulk
queries and portal scoping work without parsing EAV values.

Indexes: `(helpdesk, status)`, `(helpdesk, assigned_to)`, `(helpdesk, location)`,
`(helpdesk, category)`, `warranty_until`, `Contract.end_date`, `MaintenancePlan.next_due`,
trigram/FTS on `asset_tag, name, serial_number` (ties into Q1 full-text work).

---

## 3. Asset lifecycle (status machine)

```
 ordered ──► in_stock ──► deployed ◄──► in_repair
                │            │              │
                │            ├──► lost/stolen│
                │            ▼              ▼
                └──────► retired ◄──────────┘ ──► disposed
```
- `in_stock` ↔ `deployed` is the check-out / check-in action (creates `AssetAssignment`,
  requires a user or location, optional expected return).
- `deployed → in_repair` happens automatically when a linked **incident** ticket with
  `TicketAsset.role=affected` transitions to a status whose category is *in progress* and
  the project has "asset goes to repair on incident" enabled; back to `deployed` on resolve.
  **[confirm]** Default off; it is a per-project toggle.
- `retired` requires a reason and clears assignment; `disposed` records method
  (sold/scrapped/returned-to-lessor/donated), certificate attachment and value recovered.
- Transitions are a small fixed table in `services/lifecycle.py` (not the ticket workflow
  engine; assets do not need per-tenant workflows **[confirm]**). Every transition writes an
  `AssetEvent`.

---

## 4. Contracts: Warranty and AMC

**Warranty** — per asset, derived: `warranty_until = purchase_date + warranty_months`
(model default, overridable). Optional manufacturer "extended warranty" is just a
`Contract(kind=warranty)` covering that asset.

**AMC** — a `Contract(kind=amc)` with a *vendor*, a *scope* and a coverage list.

`Contract.scope` JSON (edited through a structured form, mirrored into `scope_text` for
search/print):
```json
{
  "service_types": ["preventive", "breakdown", "parts", "onsite"],
  "preventive_visits_per_year": 4,
  "response_hours": 4, "resolution_hours": 48, "support_window": "business_hours|24x7",
  "parts_included": true, "parts_exclusions": ["consumables", "physical damage"],
  "labour_included": true, "travel_included": false,
  "coverage_rule": {"categories": [...], "locations": [...], "models": [...]},
  "exclusions_text": "...", "penalty_clause_text": "...",
  "vendor_contacts": [{"name": "", "phone": "", "email": "", "role": "escalation L1"}],
  "escalation_matrix": [{"level": 1, "after_hours": 4, "contact": "..."}]
}
```
`ContractAsset` rows are the explicit coverage. `ContractRule` adds assets automatically
(nightly job and on asset create) so "all printers at Delhi site" stays true as assets arrive.

**Coverage lookup** (`services/coverage.py: coverage_for(asset, at=today)`): returns active
warranty + active AMC(s) with their SLA hours and vendor contacts. Used by the ticket panel
("Covered by AMC #AMC-2026-07 · Acme Services · response 4 h · call +91…") and by the
maintenance record (which contract paid for it).

**Status roll-up nightly** (`assets.contracts_refresh`): `active → expiring` when
`end_date - today ≤ renewal_notice_days`; `→ expired` after `end_date`; `auto_renew` creates
the successor contract (same scope, +1 term) and links `renewed_from`.

**Cost view**: contract cost ÷ covered assets ÷ months = monthly cost per asset; shown on the
contract and in the "AMC cost vs breakdown spend" report.

---

## 5. Reminders and notifications

Three kinds of reminders, all through the **existing notification outbox** (it already allows
`ticket=NULL`, so asset-level notifications need no schema change) plus optional auto-tickets.

| Reminder | Trigger (nightly job `assets.reminders`, per tenant) | Default recipients | Default lead |
|----------|--------------------------------------------------------|--------------------|--------------|
| **AMC / contract expiring** | `end_date - today ∈ {90, 60, 30, 14, 7, 1, 0}` days, configurable per helpdesk | contract owner, helpdesk admins, asset custodians (per-user opt-in) | 90/60/30/7 |
| **Warranty expiring** | `warranty_until - today ∈ {60, 30, 7}` | asset custodian group / assigned agent | 30 |
| **Preventive maintenance due** | `MaintenancePlan` occurrence due within `lead_days` | plan's group/assignee | plan setting |
| **Check-out overdue** | `expected_return_at < today` and not checked in | assigned user (portal + email), their manager (via `User.manager`), asset custodian | 0 |
| **End-of-life reached** | `eol_date` reached | admins | 30 |
| **Low stock** (consumables, v2) | `qty_on_hand < min_qty` | custodian | — |

Implementation:
- New events appended to `EVENT_CHOICES` (`itsm_notifications/models.py`):
  `ContractExpiring`, `ContractExpired`, `WarrantyExpiring`, `MaintenanceDue`,
  `AssetCheckoutOverdue`, `AssetAssigned`, `AssetCheckedIn`.
- `itsm_notifications/services/bus.py` gets `emit_subject(event_type, *, subject, actor,
  context)` — the existing `_emit` with `ticket=None` and a generic deep link
  (`/agent/w/<hd>/assets/<id>` or `/contracts/<id>`). Scheme lookup falls back to a
  **helpdesk-level default scheme** (today schemes are per project) — add
  `NotificationScheme.helpdesk` nullable FK and `_scheme_for()` fallback. Recipient selectors
  gain `contract_owner`, `asset_custodian`, `asset_assignee`, `helpdesk_admins`.
- Dedupe key already exists: `event|subject_id|user|channel|discriminator`; discriminator =
  the lead-day bucket so the 30-day mail is sent once even if the job runs twice.
- **Auto-ticket option** (recommended default ON for AMC and PM): the reminder also creates a
  ticket in the helpdesk's **Maintenance** project (§9) via `ticket_service.create_ticket(
  source="system")` — new `Source.SYSTEM` — with the asset/contract pre-linked, assignee =
  contract owner / plan assignee, due_date = end_date. That gives SLA, queue visibility,
  dashboard counts and an audit trail for free, and avoids a second "reminders inbox".
- Scheduler: `apps/itsm_assets/scheduler.py` registers `assets.reminders` (daily 06:00 helpdesk
  timezone → run hourly, act when local hour == configured), `assets.contracts_refresh`
  (daily), `assets.pm_generate` (hourly, idempotent via `MaintenancePlan.last_generated_for`),
  `assets.coverage_rules` (daily). Registered in `run_scheduler.py`'s module list and in the
  Phase-0 heartbeat.

---

## 6. Custom fields on assets (reuse the field engine)

`itsm_core.FieldDefinition` currently binds to `project` (+ `applies_to` for ticket types).
Extend, don't fork:
- Add `FieldDefinition.scope = {ticket, asset}` (default `ticket`) and nullable
  `asset_category` FK (field shows for that category and its descendants).
- `FieldValue` gets a generic `asset` FK (nullable) alongside `ticket` with a check
  constraint "exactly one of ticket/asset".
- Reuse `field_service.set_values / get_values`, the Layout Designer (new layout kind
  `asset_detail`) and `DynamicTicketForm` → rename internally to `DynamicForm` with an
  `entity` prop. Cascading, user picker, attachment, date types all work unchanged.
- Seed per-category starter fields: Laptop (CPU, RAM, storage, OS, hostname, MAC),
  Printer (IP, pages/month), AC (tonnage, gas type), UPS (kVA, battery date), Vehicle (reg.
  no., insurance expiry). Insurance expiry on a vehicle is just a `date` field flagged
  `reminder_days=[30,7]` → the reminders job treats any date field with `reminder_days` as a
  reminder source (generic, no per-type code).

---

## 7. Asset history (`AssetEvent`)

Actions: `created, imported, field_changed, status_changed, checked_out, checked_in,
assignment_acknowledged, location_changed, contract_attached, contract_detached,
ticket_linked, ticket_unlinked, maintenance_recorded, audited, retired, disposed, note_added,
label_printed`.
Written only through `services/asset_service.py` (`log_asset_event`), same philosophy as
`itsm_core.log_event` (explicit, greppable, no signals). The asset page "History" tab merges
`AssetEvent` + linked tickets' key audit rows (created/resolved) + maintenance records into
one timeline, newest first, filterable by kind. Exportable to CSV/XLSX through the
existing `itsm_reporting/services/export.py`.

---

## 8. Ticket ↔ asset integration (the core ask)

**Create ticket (agent form and portal form)**
- When a requestor is chosen (agent form) or known (portal), the form fetches
  `GET assets/?assigned_to=<user>&status=deployed` and shows **"Affected asset"**: a chip
  list of that user's assets (tag · model · location) with a one-click select, plus a
  search box (tag / serial / name / model, FTS) for any asset in the helpdesk, and a "No
  asset / not listed" option. Multi-select allowed; the first becomes `primary_asset`.
- Portal: requestors can only pick **their own** assets or scan a QR (§11); search across
  the helpdesk is agent-only. **[confirm]**
- Selected asset pre-fills: `location` (if the project has a Location field mapped),
  `impact` suggestion (server-class category → high) — suggestion only.
- Catalog items of kind "hardware request" (e.g. "New Laptop") set `TicketAsset.role=requested`
  with no asset yet; on fulfilment the agent checks out an `in_stock` asset from the ticket
  ("Fulfil from stock" action) which creates the assignment and links it as `replacement`
  or `requested`.

**Ticket detail**
- New **Assets panel** (right column, above Linked issues): each linked asset card shows tag,
  model, status, assigned user, location, **coverage line** (warranty until / AMC name +
  vendor + response hours + contact button), open-ticket count for that asset, and actions
  *Open asset · Unlink · Mark in repair · Record maintenance · Replace with…*.
- "Record maintenance" opens the `MaintenanceRecord` form pre-filled with ticket, asset and
  the covering contract; saving writes the record, an `AssetEvent`, and an internal comment.
- Transition post-function `set_asset_status` (new, in `itsm_workflows` registry) and
  transition **field condition** "asset linked" (reuse existing `field_conditions`,
  key `assets.count ≥ 1`) so a Maintenance project can require an asset before "Start work".
- Queue: new sortable column `Asset` (primary asset tag) and filter `asset:` / `asset_model:`
  / `asset_location:` in the query builder (`services/query_builder.py` gains the join).
- Email intake: if the subject/body contains an asset tag pattern (`\b[A-Z]{2,5}-AST-\d+\b`)
  or a serial that matches, auto-link it (`itsm_email/services/routing.py` hook; logged).

**Asset page → tickets**
- "Tickets" tab: all tickets linked to this asset (open first), with repair count and
  mean time between failures (MTBF) computed from breakdown records.
- "New ticket for this asset" button pre-selects the asset and the requestor (= assigned user).

**Portal "My Assets"** (new nav item): list of assets assigned to the requester with status,
warranty/AMC coverage (read-only), *Report a problem* (→ create request with asset pre-linked),
*Acknowledge receipt* (for `AssetAssignment.acknowledgement=pending`, satisfies audit/hand-over
policy), *Request return/replacement*.

---

## 9. Maintenance project and workflows

Add a **standard project template** "Maintenance" to `itsm_projects/standard_projects.py`
(same mechanism as Problem Management): key base `MNT`, `project_type=maintenance` (new enum
value), ticket types *Preventive Maintenance*, *Breakdown*, *Inspection/Audit*,
*Relocation*, *Disposal*; workflow `Scheduled → Assigned → Vendor Engaged → In Progress →
Awaiting Parts → Completed → Verified → Closed` (+ `Deferred`), post-functions: `In Progress`
sets asset `in_repair`, `Completed` requires a `MaintenanceRecord` (field condition) and sets
asset back to `deployed`, `Closed` stamps `next_pm_due` from the record. No SLA by default;
the AMC's `response_hours/resolution_hours` can be applied as an SLA policy
`applies_to` rule "project=MNT and asset covered by contract X" **[confirm — v2]**.

`MaintenancePlan` generation (`assets.pm_generate`): for every active plan, compute the next
occurrence after `last_generated_for`; if `due - today ≤ lead_days`, create one ticket per
asset (or one grouped ticket per location when `group_by_location=true`) with the plan
checklist rendered as a task list in the description, link the assets, set `due_date`, and
advance `last_generated_for`. Completed records set `Asset.next_pm_due`. Missed occurrences
(plan created late) generate only the most recent one.

---

## 10. Import, labels, audit

- **CSV/XLSX import** (`POST assets/import/`): template download, column mapping UI, dry-run
  with per-row errors, upsert by `asset_tag` or `serial_number`, creates missing
  models/vendors/locations when "create lookups" is ticked. Runs synchronously up to 2 000
  rows, otherwise via the scheduler as an `AssetImportJob`. Reuses `openpyxl` already in
  requirements.
- **Bulk edit** on the asset list: status, location, assigned_to, custom field, attach to
  contract, add to plan (mirrors the ticket bulk pattern).
- **Labels**: `GET assets/<id>/label.svg|pdf` — QR encodes
  `https://<host>/t/<org>/a/<qr_token>` (short public resolver route that redirects to the
  agent asset page or the portal "report a problem" page based on login). Sheet print for a
  selection (Avery-style grid). Library: `segno` (pure-python QR, no native deps).
- **Physical audit**: "Start audit" for a location → agents scan tags on a phone browser
  (camera QR via `BarcodeDetector` API with manual fallback); found / missing / unexpected
  report; `last_audit_at` stamped; missing → `lost` after confirmation.

---

## 11. RBAC, scoping, portal

`itsm_rbac/registry.py` additions (seeded; Admin/Supervisor full, Agent read+update on
assets and create on maintenance records, Requestor read-own via portal):
```
("itsm.assets",            "Assets",                 "itsm", 260)
("itsm.assets.admin",      "Asset Configuration",    "itsm.assets", 261)   # categories, models, vendors, locations, fields
("itsm.assets.checkout",   "Check-out / Check-in",   "itsm.assets", 262)
("itsm.assets.contracts",  "Contracts & AMC",        "itsm.assets", 263)
("itsm.assets.maintenance","Maintenance Plans",      "itsm.assets", 264)
("itsm.assets.import",     "Import / Bulk",          "itsm.assets", 265)
("itsm.assets.dispose",    "Retire / Dispose",       "itsm.assets", 266)
("itsm.portal.assets",     "My Assets (portal)",     "itsm.portal", …)
```
Helpdesk scoping exactly as tickets: viewsets filter by `accessible_helpdesk_ids_cached`;
Manufacturer/Vendor/Location are tenant-global (nullable helpdesk) because sites and
vendors are shared across IT/HR/Facilities helpdesks **[confirm]**.
Financial fields (`purchase_cost`, contract `cost`) are hidden unless the role has
`itsm.assets.contracts:read`.

---

## 12. Reports and dashboard widgets

Added to `itsm_reporting/services/reports.py` (chart-ready JSON + CSV/XLSX through the
existing export path) and to the dashboard widget registry:
- Asset inventory by category / status / location / age band
- Assets per user (and users with >N assets), unassigned deployed assets (data quality)
- Warranty & contract expiry calendar (next 30/60/90 days) — also an "attention" tile
- AMC cost vs breakdown spend per vendor / per model (shows which models to stop buying)
- Preventive maintenance compliance (% of due PMs completed on time) per location/vendor
- Repair frequency / MTBF per model; top 10 "lemon" assets
- Depreciation / book value summary (straight-line) **[confirm]**
- Check-out overdue list; audit variance (missing/unexpected) per location
- Ticket volume by asset category (joins `TicketAsset`) — adds an asset dimension to the
  existing volume reports

---

## 13. API surface (DRF, `/api/v1/t/<org>/itsm/…`)

```
assets/                       CRUD, ?search ?status ?category ?location ?assigned_to ?model ?contract ?warranty_until_before
assets/{id}/history/          merged timeline
assets/{id}/tickets/          linked tickets
assets/{id}/checkout/  checkin/  transition/  (status machine)  label.svg  coverage/
assets/bulk/                  {ids, op, value}
assets/import/  import/{job}/ import/template.xlsx
asset-categories/ asset-models/ manufacturers/ vendors/ locations/   CRUD (+ tree endpoints)
contracts/  contracts/{id}/assets/  contracts/{id}/renew/  contracts/expiring/?days=90
maintenance-plans/  maintenance-plans/{id}/preview/ (next 12 occurrences)  /run-now/
maintenance-records/          CRUD (ticket-scoped create)
tickets/{id}/assets/          GET list · POST {asset, role} · DELETE {asset}
tickets/{id}/fulfil-from-stock/  {asset, role}
portal/assets/  portal/assets/{id}/acknowledge/  portal/assets/{id}/report/
a/<qr_token>                  public resolver (redirect), rate-limited
```
All documented in the existing drf-spectacular schema.

---

## 14. Frontend

Agent workspace (`app/t/[org]/(agent)/agent/w/[helpdeskKey]/assets/…`):
- `assets/` list — reuse the ticket queue shell (`ticket-queue.tsx` patterns: column picker,
  saved filters, sort, URL state, live poll); columns tag, name, model, category, status,
  assigned to, location, warranty, AMC, next PM, open tickets. Bulk bar from Phase 0 §4a.
- `assets/new`, `assets/[id]` — header (tag, status chip, lifecycle actions), tabs
  *Details* (layout-designer driven) · *Assignment* · *Contracts* · *Maintenance* ·
  *Tickets* · *History* · *Files*.
- `assets/contracts/`, `assets/contracts/[id]` — scope editor (structured form + rich text),
  covered assets table with add-by-rule, cost, renewal, documents, reminder preview.
- `assets/maintenance/` — plans list + calendar view (month grid of due occurrences),
  plan editor with occurrence preview.
- `assets/import`, `assets/audit`.
- Settings (`settings-nav.tsx` new group "Assets"): Categories, Models, Manufacturers,
  Vendors, Locations, Asset Fields & Layout, Reminder defaults, Label template.
- Workspace nav (`workspace-nav.tsx`): "Assets" entry between All Tickets and Reports,
  gated on `itsm.assets:read`.
- Ticket detail: `components/tickets/asset-panel.tsx`; create form:
  `components/tickets/asset-picker.tsx` (chips + search); queue column `asset`.
Portal: "My Assets" nav item + `portal/assets/[id]` + acknowledge/report flows.
Shared: `components/assets/asset-chip.tsx`, `coverage-line.tsx`, `status-badge` variant,
`qr-scanner.tsx`.

---

## 15. Delivery plan

| Phase | Weeks | Scope | Exit criteria |
|-------|-------|-------|---------------|
| **A — Core registry** (L) | 1–5 | `itsm_assets` models + migrations, lifecycle, categories/models/vendors/locations, custom-field scope extension, asset list/detail/new, history, RBAC, CSV import, seed starter categories/fields | Create/import 500 assets; check-out/in; history correct; all scoped per helpdesk; 60+ tests |
| **B — Ticket integration** (M) | 6–8 | `TicketAsset`, asset picker in agent + portal create forms, asset panel on ticket, queue column + filters, email auto-link, portal My Assets + acknowledge, QR labels + resolver | Ticket created from portal with own asset; asset page shows the ticket; QR scan opens report form |
| **C — Contracts, AMC, reminders** (M) | 9–11 | Contract/ContractAsset/ContractRule, scope editor, coverage lookup on ticket panel, nightly status roll-up, reminders through outbox (+ helpdesk-level scheme), auto-ticket into Maintenance project, expiry report + attention tile | 90/30/7-day AMC mails delivered once each; ticket auto-created with asset + contract linked; coverage line correct |
| **D — Maintenance** (M) | 12–14 | Maintenance standard project + workflow, plans + generator, records from ticket, PM calendar, PM compliance + MTBF + AMC-cost reports, asset status automation on incident/maintenance | Monthly PM plan creates tickets on time; completing one records maintenance and sets next due |
| **E — Polish / v2** (M) | 15–16 | Physical audit mode, depreciation, consumables & licences **[confirm]**, bulk label sheets, dashboard widgets, Playwright coverage | Audit of one location end to end |

Roughly 4 months for A–D with one engineer, 10–11 weeks with two (A and the frontend
shell parallelise). Sits in the roadmap's Q2–Q3 window; recommend starting right after
Phase 0 since it is the feature clients are asking for.

Dependencies: Phase 0 §1 (signed media URLs) must land first — asset images, invoices and
contract PDFs are attachments. Q1 full-text search makes the asset picker fast; until then
the picker uses `icontains` on tag/serial/name with the helpdesk index.

---

## 16. Decisions to confirm

1. **Per-helpdesk assets with tenant-global vendors/locations/manufacturers** (recommended), or
   fully tenant-global assets visible to all helpdesks?
2. **Requestors pick only their own assets** on the portal (recommended) — or search all?
3. **Auto-ticket for AMC expiry and PM due** ON by default, into a per-helpdesk Maintenance
   project (recommended), or notifications only?
4. **Fixed asset lifecycle** (recommended) vs. configurable per tenant via the workflow engine.
5. Include **depreciation**, **consumables**, **licences** in v1, or v2 as planned?
6. **Asset-driven SLA** (AMC response/resolution hours become an SLA policy) — v2?
7. **Asset tag format** default `<HELPDESKKEY>-AST-000001`; allow import of existing tags (yes).
8. Who receives AMC reminders by default: contract owner + helpdesk admins (recommended) —
   add the vendor contact as an external email recipient too?
9. Incident → asset `in_repair` automation default **off** per project (recommended).

## 17. Risks
- **Scope creep toward a full CMDB** (CI relationships, discovery agents). Keep v1 to
  tracked assets + `parent_asset`; no discovery, no service maps.
- **Reminder storms** at go-live when hundreds of old contracts import as `expiring` →
  import marks historical contracts `expired` without emitting; reminders start the day
  after import.
- **Field-engine extension** touches a core table (`FieldValue`). Ship behind a migration
  with the check constraint and a full `itsm_core` test pass before Phase A ends.
- **Portal exposure**: asset endpoints must clamp to `assigned_to=request.user` for
  requestors; covered by the same intake-and-read-path tests pattern used for portal tickets.
