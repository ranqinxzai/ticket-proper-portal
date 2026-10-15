# itsm-fields

## Update (2026-10-14) — ONE Resolution Notes field: `resolution_notes` also applies to Request projects
- `resolution_notes` (`maps_to` → `Ticket.resolution_notes`) is now tagged
  `applies_to: ["incident", "problem", "service_request"]` (`GLOBAL_FIELDS` + data migration
  **`itsm_core/0012_resolution_notes_for_requests`**, idempotent per tenant). Request projects see it in
  the Fields catalog, the transition capture-field picker and the filter registry. The other ITIL defs
  stay hidden there, and custom projects are unchanged.
- **Why:** with it hidden, GridCrest's admin created a REQ-only **custom** `resolution_note`
  (value-backed) for the Request **Fulfil** screen. That gave two near-identically named notes, and the
  Ticket Data report showed them as two columns (one mostly blank). **Rule: never create a per-project
  custom copy of a standard ITIL field.** Use the global column-backed def, so the value lands in the
  Ticket column and the report's standard column.
- **Runtime note:** transition screens resolve keys to defs *without* `applies_to`
  (`_resolve_screen_fields` / engine `_screen_field_defs`), so a screen referencing a hidden global
  still works. `applies_to` only governs the admin catalog/picker/filter surfaces. If the picker doesn't
  list a field, the capture row shows its raw key.
- **Seed refresh gotcha:** `seed_system_fields` rewrites a global def's `config` back to `GLOBAL_FIELDS`
  on every run (and `ensure_project_layout` calls it on project create/seed). A hand-edited
  `applies_to` on a tenant's global def is silently reverted. Change the constant + ship a migration.
- Tests updated: `ITILFieldCatalogScopingTests`, `FilterFieldRegistryScopingTests` (`REQUEST_ALSO`),
  `ProblemFieldScopingTests.test_request_project_sees_none_of_the_tagged_set`; new
  `test_migration_0012_tags_resolution_notes_for_requests`.
- **Mode** (`mode`) is still a value-backed global (`FieldValue`). Email intake now sets it to `email`
  (see itsm-email 2026-10-14). Agent/portal tickets keep whatever the user picks.

## Update (2026-07-24b) — `incident_only` → **`config.applies_to` list** + Problem field set
- **The boolean `config.incident_only` is replaced by `config.applies_to: [<project_type>, …]`**
  (absent key ⇒ applies everywhere). Shared ITIL defs now carry
  `applies_to: ["incident","problem"]` — `impact`, `urgency`, `business_impact`, `resolution_code`,
  `root_cause`, `workaround_provided`, `resolution_notes`; incident-only keep `["incident"]` —
  `users_affected`, `service_downtime`, `major_incident`. Two **new problem-only globals**
  (`applies_to: ["problem"]`, both column-backed): **`workaround_notes`** ("Workaround", multiline →
  `Ticket.workaround_notes` — the KEDB workaround text, distinct from the `workaround_provided` bool)
  and **`investigation_reason`** (dropdown, locked options recurring_incidents / non_routine_incident /
  major_incident_review / trend_analysis / other → `Ticket.investigation_reason`). The shared
  `resolution_code` def gained options **`risk_accepted`** + **`wont_fix`** (SN parity; also valid for
  incidents).
- **`field_service`**: `incident_only_keys()` → **`inapplicable_global_keys(project_type)`** —
  positive filter `config__has_key="applies_to"` (the JSON-NULL trap rule still applies: never
  `.exclude` on the JSON lookup), membership tested in Python. `hide_inapplicable_globals` reads the
  project's type once and excludes by key — Request/custom behavior unchanged (they see none of the
  tagged set). Same two consumers as before (`FieldDefinitionViewSet`, `filter_fields`).
- **Layout**: `PROBLEM_LAYOUT_SPEC` + `PROBLEM_PRIORITY_PLACEMENT` in `itsm_core/seed.py`;
  `ensure_project_layout` branches `elif project_type == "problem"` — sections **Problem Assessment**
  (impact/urgency/priority-relocated/investigation_reason/business_impact), **Root Cause & Workaround**
  (root_cause/workaround_notes/workaround_provided), **Resolution Details** (resolution_code/
  resolution_notes); all agent-only (`portal_visible=False`), non-mandatory.
- **Existing tenants**: data migration **`itsm_core/0011_problem_fields_applies_to`** (depends on
  `itsm_tickets/0010_ticket_problem_fields` for the columns) retags `incident_only` → `applies_to`,
  creates the two new defs + options, and appends the two resolution codes. ⚠️ It must land with the
  code — deployed code reads `applies_to`, so un-retagged data would leak ITIL fields into every
  request/custom picker until a seed run.
- **`MAPPED_COMPILE`** (itsm-tickets `filter_fields.py`) gained `workaround_notes` (text) +
  `investigation_reason` (choice) so the new fields filter against their columns (offered ⇒ works).
  Tests: `ProblemFieldScopingTests`, `ProblemColumnFilterCompileTests` (itsm_tickets).

## Update (2026-07-24) — Custom-field queue columns are sortable
- `custom_field_payload` now emits **`ordering_key: "cf:<key>"`** on a value-backed field of an orderable
  type (`field_service.CF_SORTABLE_TYPES`; a `maps_to` field is excluded — it isn't a `cf:` column). This
  is the same registry entry the queue column pickers already consume, so the flag rides existing plumbing
  (`FilterFieldMeta.ordering_key` was already in the TS type). The queue makes a `cf:` header clickable
  **iff** this key is present, and the server resolves `?ordering=cf:<key>` to a display-ordered subquery
  (`field_service.custom_sort_subquery`). See **itsm-core** (the rule + expression) and **itsm-tickets**
  (`TicketViewSet._annotate_cf_ordering`, the `CF_ORDERING_LIMIT`, combined-queue ambiguity drop).

## Update (2026-07-16b) — Filter registry: condition on what's CONFIGURED + `maps_to` compiles to the column
- **Symptom (`int`/ONE/DEV):** the queue filter picker ("More filters") listed **21** custom fields where
  only **4** were DEV's — reported as "showing fields from all helpdesk".
- **NOT a scoping bug (verified live).** `resolve_helpdesk_scope(su,"ONE")` → `[ONE]`, projects → `['DEV']`;
  `filter_fields` already clamps (`views.py:194-200`) and a superuser test asserts HR's `cf:hronly` never
  leaks into `?helpdesk=IT`. The real cause: **`FieldDefinition` has no helpdesk FK** — `project=null` is
  global to the whole **tenant**, so all ~17 global `maps_to` system defs showed in every project's picker.
- **Rule now applied (the one the Fields tab already had):** `custom_field_payload` calls
  **`get_field_definitions(project, applicable_only=True)`** — the `incident_only` ITIL defs are hidden from
  **non-Incident** projects. Because `filter_fields_payload_multi` calls it **per project**, the combined
  union surfaces ITIL only when ≥1 **Incident** project is configured in that helpdesk. One rule, both scopes.
- **Rule now SHARED, not duplicated.** The incident_only logic moved into `field_service`
  (**`hide_inapplicable_globals(qs, project)`** + `incident_only_keys()`, accepts a Project **or** a uuid str);
  `FieldDefinitionViewSet.get_queryset` was refactored to call it. The **JSON-exclude trap** (positive filter
  first, then `.exclude(project__isnull=True, key__in=…)`) now lives in exactly one place.
- **De-duplicated, not dropped.** A `maps_to` global whose key is already a **built-in** filter
  (`priority/requestor/assignee/assigned_group/source/summary`) is no longer listed under "Custom fields" —
  the **Standard** entry remains and is the one that always compiled correctly. No capability lost.
- **`maps_to` filters now WORK** (`query_builder._compile_custom`): a column-backed field compiles against the
  **Ticket column**, not `FieldValue`. Key that matches a built-in → delegates to
  `_compile_builtin(BUILTIN_COMPILE[key])` (so a **legacy SavedFilter** holding `cf:priority`, which silently
  matched nothing, now behaves like its Standard twin); otherwise via the new **`MAPPED_COMPILE`** registry
  (`filter_fields.py`, keyed by the maps_to column → `{path, kind}`) + new `boolean`/`number` kinds that
  `_compile_builtin` never needed. Paths come only from those registries — never from client input.
- **Security:** the `?project=<uuid>` branch now runs `is_project_accessible` → **403** (it previously
  disclosed any helpdesk's field metadata to any authenticated user).
- **Verified live on `int`:** ONE/DEV **21 → 5** (`category, description, mode, module, type`); helpdesk
  **IT** (has `ITINC`) keeps the ITIL set → **13**; Standard stays 16. Tests: `FilterFieldRegistryScopingTests`
  + `MappedColumnFilterCompileTests`. No migration.

## Update (2026-07-16) — Bugfix: column-backed (`maps_to`) fields must not be queue-column options
- **Symptom (reported on `int`/DEV):** the project **Columns** tab listed ~17 "unrelated" `CUSTOM`
  rows — Assigned Group, Assigned Technician, Priority, Requestor, Description, Impact, Urgency,
  Major Incident, Business Impact, the whole ITIL/Resolution set…
- **Root cause:** the column pickers were built from `custom_field_payload`, the **filter** registry,
  which returns every field def visible to the project — including the **global `is_system` fields with
  `config.maps_to`**. Those keep their value on the **Ticket column** and have **no `FieldValue` row**
  (`set_values` skips `maps_to`), so as a `cf:` column they'd render **permanently blank** *and*
  duplicate the equivalent built-in column. This is the same **column-vs-value render rule** as the
  2026-07-02 Impact-Assessment bug — re-learned in the column picker.
- **Fix:** `custom_field_payload` now tags a column-backed entry with **`maps_to`** (additive — the
  filter bar is unchanged); the frontend gates every column picker on the shared predicate
  **`isColumnEligibleCf(f)` = `f.key.startsWith("cf:") && !f.maps_to`** (`queue-columns.tsx`), used by
  BOTH `QueueColumnEditor` and `ticket-queue.tsx`'s `columnUniverse`. New
  **`filter_fields.column_cf_keys(projects)`** (value-backed only) backs the two write validators, so a
  forged `cf:impact` is dropped server-side. `cfLabels` still covers all `cf:` keys so a legacy stored
  key renders a sane header. Verified on `int`/DEV: offered 22 → **4** (Category, Mode, Module, Type);
  17 `maps_to` excluded; `attachments` already excluded by `NO_VALUE_TYPES`.
- ~~**⚠️ Known pre-existing (NOT fixed here):** those same `maps_to` fields are still offered as
  **filters**, and `query_builder._compile_custom` resolves a `cf:` condition against `FieldValue` — so
  filtering by `cf:impact` matches **nothing**.~~ **RESOLVED 2026-07-16** — see the filter-registry
  update below (compile to the Ticket column + condition the registry).

## Update (2026-07-15) — Custom fields selectable as queue columns (project + helpdesk)
- Custom fields (`cf:<key>`, from `custom_field_payload`) can now be chosen as **ticket-queue columns**,
  not just filters. The per-project **Columns** tab (`column-layout-editor.tsx`, refactored into a shared
  `QueueColumnEditor`) fetches the scope's fields via `ticketsApi.filterFields({project}|{helpdesk})` and
  lists each `cf:` field as a toggleable, reorderable row (a `custom` badge distinguishes them). Selected
  `cf:` keys persist into `Project.queue_columns` / new `Helpdesk.combined_queue_columns`; the queue renders
  them via the existing `renderQueueCell` + `?cf=` batch (`field_service.custom_column_values` — option
  **labels**, user **names**, blank where absent). Stale/foreign `cf:` keys are dropped server-side by
  `filter_fields.clean_queue_columns` (+ shared `QUEUE_COLUMN_KEYS`) in the two write serializers. See
  **itsm-tickets** / **itsm-projects** / **itsm-helpdesks** (2026-07-15).

## Update (2026-07-03) — custom-field reconciliation on a project move
`ticket_service.move_ticket` re-homes value-backed `FieldValue`s when a ticket changes project. Rule
(also the `move-options` preview): a **project-scoped** source field auto-maps to the target **only**
when key **and** `field_type` match **and** (for `OPTION_TYPES`/cascade) every stored option value
exists in the target field's active options; otherwise the value is **dropped** (source `FieldValue`
soft-deleted). **Global** (`project=null`) fields carry over untouched (shared definition). Source
rows are always soft-deleted and matched values re-written via `field_service.set_values` onto the
**target** field — so there's never an orphaned or duplicate-`key` `FieldValue`. The per-project
`category` cascade is dropped (re-set on the moved ticket). See **itsm-tickets** (2026-07-03).

## Purpose
The dynamic custom-field engine + layout designer. Beyond the standard ITIL columns on
`Ticket`, admins define typed custom fields per project/ticket-type and arrange them on a
layout; each ticket stores one typed `FieldValue` row per field. The models live in
**`itsm_core`** (`models/fields.py`); the REST API + `field_service` are BUILT (API + service live).

## Update (2026-07-02) — field catalog reused for workflow transition capture screens
- The [[itsm-workflows]] **Transition settings** dialog now lets admins attach **capture fields** to
  any transition (e.g. Resolve → Root cause / a custom Resolution type), picking from this engine's
  **project catalog** via `fieldsApi.list(project.id)` and marking each Mandatory/Optional. Fields are
  **defined here (Fields tab) first**, then referenced by `field_key`; there is no inline field
  creation in the workflow editor. Supported picker types: text, multiline, number, date, dropdown,
  radio, checkbox (others deferred).
- Captured values persist through **this engine**: the workflow `engine.transition()` routes
  column-backed (`config.maps_to`) screen fields to the Ticket column and value-backed custom fields to
  **`field_service.set_values`** (a `FieldValue` row + `field_changed` audit — `set_values` already
  skips `maps_to`/attachment). So a custom field captured on a transition shows on the ticket like any
  other custom field. See itsm-workflows SKILL/API_CONTRACTS (2026-07-02).

## Update (2026-07-02) — ITIL Incident fields in the catalog + Impact Assessment / Resolution sections
- **`GLOBAL_FIELDS`** (`itsm_core/seed.py`) gained ten column-backed (`config.maps_to`) system fields:
  `impact` (4 opts), `urgency` (3 opts), `business_impact`, `users_affected`, `service_downtime`,
  `major_incident`, `resolution_code`, `root_cause`, `workaround_provided`, `resolution_notes`. Like the
  other `maps_to` fields they never store a `FieldValue` — the value lives on the `Ticket` column.
- **Incident-only layout.** New `INCIDENT_LAYOUT_SPEC` + a branch in `ensure_project_layout` place an
  **Impact Assessment** and a **Resolution Details** section (all agent-only `portal_visible=False`,
  non-mandatory) when `project.project_type == "incident"`, and **relocate** the existing `priority`
  layout item into Impact Assessment (agent-only, non-mandatory) — a single item, not duplicated
  (`INCIDENT_PRIORITY_PLACEMENT`).
- **Self-heal hardened.** `ensure_project_layout` now **always** calls `seed_system_fields()`
  (idempotent) rather than the old `exists()` shortcut: a data migration that pre-creates *some* global
  system fields (the ITIL set) would otherwise satisfy `exists()` and skip seeding the base catalog.
- Data migration **`itsm_core/0006_itil_incident_fields`** creates the defs/options and backfills the two
  sections onto existing Incident projects (per tenant via `migrate_schemas --tenant`).
- **`config.incident_only` scoping.** The ten ITIL defs are **global** (`project=null`, like `priority`),
  so they'd otherwise appear in *every* project's Fields catalog. Each carries `config.incident_only=True`
  and **`FieldDefinitionViewSet.get_queryset`** hides `incident_only` globals from **non-Incident**
  projects' Fields list + layout palette (`priority` stays visible everywhere — it has no flag). Backfill
  migration **`0008_itil_fields_incident_only`** tags existing globals. ⚠️ Exclude by resolving the flagged
  **keys** first, then `.exclude(project__isnull=True, key__in=…)` — a direct
  `.exclude(project__isnull=True, config__incident_only=True)` drops *every* global (JSON `->` on a
  missing key is NULL, and `NOT(TRUE AND NULL)` is NULL → filtered out).

## Update (2026-07-01) — Custom fields in the combined cross-project queue
- **Union filter registry.** `itsm_tickets/services/filter_fields.py` gained
  **`filter_fields_payload_multi(projects)`** — builtins + the UNION of every project's
  `custom_field_payload`, deduped by `cf:<key>`. On a key collision the **first** project's
  definition wins (matches `query_builder._compile_custom`, which resolves a `cf:<key>` filter
  against the lowest `project_id`'s `FieldDefinition`); same-key/same-type **options are merged**,
  same-key/**different-type** is dropped (unambiguous compile). `TicketViewSet.filter_fields` serves
  this when there's no `?project` (scoped to the resolved helpdesk + accessible projects).
- **Batched, display-ready column values.** New **`field_service.custom_column_values(ticket_ids, keys)`**
  (`itsm_core/services/fields.py`) returns `{ticket_id: {key: display}}` in ONE `FieldValue` query
  (plus one options query) — used by the combined queue's `?cf=` columns so the list keeps its
  no-N+1 guarantee (the list serializer still omits `get_values`). Unlike the raw `_serialize` the
  **Ticket-Data export** uses, `_display` resolves **option labels** (not stored values), a **user's
  name** (not id), and joins multi-values (cascade ` › `, multiselect `, `). A `(ticket, field)` with
  no row → no entry → the cell renders blank (a field absent from a row's project is naturally empty).
- See **itsm-tickets** (2026-07-01) for the queue/UX and **itsm-dashboards** for the combined prefs.

## Backend app path
Models: `backend/apps/itsm_core/models/fields.py` (engine owned by itsm_core).
API/service (BUILT): a `field-definitions` / `field-options` / `field-layouts` / `field-layout-items`
surface plus a `field-layouts/resolve/` action, backed by `field_service` (`services/fields.py` —
typed read/write + mandatory validation).

## Key concepts
- **`FieldDefinition`** — a custom field: `project` (null = global), `key`, `name`, `field_type`,
  `is_system`, `is_multi`, `config` JSON (decimals/regex/min/max/show_time…), `default_json`.
  Types: text, multiline, **richtext**, number, date, datetime, dropdown, multiselect, checkbox,
  radio, user_picker, group_picker, **cascade**, **attachment**. Unique `(project, key)`.
- **`FieldOption`** — choices for `OPTION_TYPES` (dropdown/multiselect/radio/**cascade**);
  `value`/`label`/`color`/`sort_order`/`is_active`, plus **`parent`** (self-FK) + **`level`**
  (1-based) for cascade trees. Unique `(field, value)`.
- **`FieldValue`** — the CellValue: one row per `(ticket, field)`, unique. Typed columns
  `value_text/number/date/bool/user/json`; multi-value types (`MULTISELECT`, `CASCADE`) use
  `value_json` (cascade stores the ordered path, e.g. `["hardware","laptop"]`).
- **`FieldLayout`** — per `(project, ticket_type)` (ticket_type null = project default); unique
  `(project, ticket_type)`.
- **`FieldLayoutItem`** — a field placed on a layout: `sort_order`, `is_hidden` (hides from BOTH the
  agent + portal form), **`portal_visible`** (default `True`; shown on the end-user Service Portal
  request form — *independent* of `is_hidden`, so a field can be agent-only), `is_mandatory`
  (Required), `section`, **`region`** (`main` left / `sidebar` right — `LayoutRegion`), **`width`**
  (`full` / `half` — `FieldWidth`, half only meaningful in `main`), `visibility_rule` JSON. Unique
  `(layout, field)`. Rich-text fields (`FORCE_MAIN_FULL_TYPES`) are coerced to `region=main,
  width=full` and sidebar items to `width=full` — enforced in `FieldLayoutItemSerializer.validate`
  (and locked in the designer UI). The rule shape is
  `{action: "show"|"readonly", field, operator: "eq"|"neq", value}` (e.g. show this field only
  when `status eq on_hold`); `field` may be a custom-field key or a built-in attribute like
  `status`. Enforcement is form-time (dynamic-form milestone); the designer just stores it.

## Per-field settings (config.* — BUILT, config layer)
The Fields tab opens a per-field **Settings** dialog (`components/settings/field-settings-dialog.tsx`)
with Basic + Advanced groups:
- **Basic** — Required (→ the field's `FieldLayoutItem.is_mandatory` in the project's default
  layout, created on demand), **Tooltip** (`config.tooltip`), **Hint text** (`config.hint`).
- **Advanced** — **Regex** (`config.regex` + `config.regex_message`, text-like types only),
  **Conditional rule** (→ `FieldLayoutItem.visibility_rule`, show/read-only when another field
  matches).
Intrinsic props (tooltip/hint/regex) live on `FieldDefinition.config` (shared for global fields);
Required + the rule are per-project (the layout item). No migration — `config` and `visibility_rule`
are JSON already exposed (writable) by the serializers.

## Standard field catalog (system fields) — BUILT
Every project gets a **minimum configuration** in its Fields + Layout tabs, seeded by
`apps.itsm_core.seed`:
- **Global `is_system` `FieldDefinition`s** (`project=null`) for the standard fields: `summary`,
  `description` (richtext), `priority`, `mode`, `requestor`, `assigned_group`, `assignee`,
  `source`, `attachments`. Column-backed ones carry **`config.maps_to`** = the `Ticket` column
  (e.g. `priority` → `priority`, `description` → `description_html`) — the future dynamic form
  routes them to the column instead of a `FieldValue`, and `set_values` **skips** any key with
  `maps_to` or a `NO_VALUE_TYPES` type (attachment) so they never double-store.
- **Per-project `category`** cascade field (own tree per project; `config.levels` + `depth`,
  ≤ `MAX_CASCADE_DEPTH=7`).
- `seed_system_fields()` creates/refreshes the global catalog (+ options for priority/source/mode;
  priority & source are `locked_options`, code-derived). `ensure_project_layout(project)` ensures
  the per-project Category field + a default `FieldLayout` (ticket_type=null) placing all 10 fields
  with section/required/hidden/**portal_visible** defaults (`source` is `is_hidden`; requestor/
  assigned_group/assignee/source are `portal_visible=False`, everything else `True` — mirrors
  migration `0005`'s backfill). `backfill_layouts()` loops all
  projects. Called from `seed_itsm` (catalog before projects, backfill after), `itsm_projects.seed`,
  and `ProjectViewSet.perform_create` (new custom projects). All idempotent; layout items use
  get_or_create so admin overrides survive re-seeds.

## Frontend path / pages (BUILT — config layer)
Project settings **Fields** tab (`components/settings/fields-editor.tsx`) lists project + global
fields, locks `is_system` (no delete), and edits choices for value-backed fields (dropdown options;
**cascade tree** via `components/settings/cascade-options-editor.tsx` — define levels + nodes).
Column-backed system fields (`config.maps_to`) keep read-only choices. **Layout** tab
(`components/settings/layout-editor.tsx`) is a **WYSIWYG canvas** that mirrors the form: a Main pane
(left, `lg:col-span-2`) and Sidebar pane (right) at the same 2:1 proportions, fields rendered as
cards (faux control `FieldPreview` per type) inside **bordered section boxes** (both columns).
**Drag-and-drop** (`@dnd-kit`; grip handle per card, `DragOverlay` floating preview): reorder within a
group and move across sections/columns — each `SectionGroup` is a `useDroppable`; `onDragEnd`
recomputes region/section/sort_order and PATCHes only changed items (rich-text can't drop into the
sidebar). **Section headings are editable in place** (`SectionHeader` renames every field in that
region+section); each column header has a **＋ Section** button (adds a local empty section — persists
once a field is dragged in). Card hover controls: move column (`PanelLeft`/`PanelRight`) + remove;
footer has Width (Full/Half — Main only) + Required/Hidden/**Portal** (Portal = `portal_visible`, shown
on the end-user request form). (Field name uses `min-w-0 flex-1 truncate`
so the label always shows even in the narrow sidebar.) System fields show a `sys` badge and can't be removed; rich-text
column/width are locked. Seeded default: Summary/Description/Category/Attachments in Main;
Priority/Mode/Requestor/Group/Technician/Source in the Sidebar. (Sub-components `FieldCard`,
`WidthToggle`, `FieldPreview`, etc. are module-top-level.)

**Layout-driven create form (BUILT).** `components/tickets/ticket-create-form.tsx` resolves the
layout (`layoutsApi.resolve(project, ticketType)`) + field defs and renders controls per type
(text→input, **richtext→`RichTextEditor`** (TipTap, see below), multiline→textarea, dropdown/radio,
cascade→dependent selects, user_picker→async search via
`usersApi.search`, group_picker→`groupsApi.list`, attachment→file input). It renders a **two-pane form** — Main column (left, ~2/3) with half/full-width fields in a 2-col
grid, Sidebar column (right, ~1/3) stacked full-width — honouring `region`/`width`, order,
sections, `is_mandatory` (skipped when an option field has no options yet), `is_hidden`, and the
`visibility_rule` (show / read-only; conditions on absent fields like `status` never match at
create). Column-backed fields (`config.maps_to`) map to top-level create keys; value-backed ones
go in `custom_fields`; attachments upload after create via `ticketAttachmentsApi.upload`; Source is
hidden and defaults to `agent`. *(2026-06-23: the standalone **Type** dropdown was removed from this
form — `ticketType` is fixed to the project's default type and still feeds `layoutsApi.resolve`, but
it's no longer a user control. The form now renders exactly the resolved layout. See itsm-tickets.)*

**Rich-text editor (BUILT).** `components/ui/rich-text-editor.tsx` — a shared TipTap editor
(`@tiptap/react` + `StarterKit` + `Underline`/`Link`/`Placeholder`) with a **formatting toolbar**
(bold / italic / underline / strike / H2·H3 / bullet+numbered lists / quote / inline code / link /
clear-format / undo·redo). Emits HTML via `onChange`; an empty doc normalises to `""` (so Required
validation still fires and no bare `<p></p>` is stored). SSR-safe (`immediatelyRender:false`);
all sub-components are module-top-level (focus stability). Used for the `richtext` field on the
**create form**, the detail-view **Description** editor, and inline custom `richtext` fields. There is
**no `@tailwindcss/typography` plugin** — rich-text typography (lists/headings/quote/code/links) for
BOTH the live editor (`.ProseMirror`/`.rte-content`) and rendered output (`.prose …`) is styled by
hand in `app/globals.css` (`@layer components`); without those rules `prose` classes are no-ops and
lists/headings render flat. The server still sanitises every richtext body on save.

**Layout-driven detail view (BUILT — read + edit).** `components/tickets/ticket-detail.tsx` resolves
the same layout and renders the ticket in the Main (left) / Sidebar (right) arrangement, grouped by
section — Description as a prose block, Attachments as a file list, column-backed fields from the
Ticket columns and value-backed (mode/category/custom) from `custom_fields` (cascade joined with
" › ", dropdowns mapped to option labels). Summary stays the page title (not duplicated as a field);
Status/Type/Workflow/Created sit in a fixed meta block above the sidebar field groups, then SLA +
Approval panels. **`FieldView` is editable in place** when the user has `itsm.tickets:update`:
column-backed fields save via `ticketsApi.update` (PATCH → `ticket_service.update_ticket`) and custom
value-backed fields via `ticketsApi.setFields` (POST `set-fields` → `field_service.set_values`),
round-tripping the same value shapes the create form writes. Priority→select, assignee/requestor→
async user pickers, group/group_picker→group select, **description→`RichTextEditor`** (toggle; seeded
from the stored HTML), summary→inline
header editor, richtext custom→`RichTextEditor` (commit-on-blur), dropdown/radio/checkbox/date/number/
multiline/multiselect/cascade→type-dispatched controls (`CustomFieldEdit`); user_picker custom +
attachments + Source stay read-only; status is workflow-driven. Custom `richtext` values are
sanitised on write by `field_service._coerce` (so the read view renders them with
`dangerouslySetInnerHTML` safely, like the Description column). See the itsm-tickets skill for the server write path. All editable controls are
module-top-level (React focus stability).

## Frontend path / pages (planned)
**Field & Layout Designer** (dnd-kit) under `admin/.../fields`; `DynamicTicketForm` /
`FieldControl` registry per type, with a runtime Zod schema built from the layout.

## API clients
`field-definitions`, `field-options`, `field-layouts`, `field-layout-items` (plus the
`field-layouts/resolve/` action). Custom-field values read/written alongside the ticket via
`field_service`.

## RBAC module codes
- Field definitions/options → **`itsm.fields`**.
- Layouts → **`itsm.fields.layouts`**.
Agent: read-only on `itsm.fields`; Supervisor: full.

## Key files
- `backend/apps/itsm_core/models/fields.py` — all engine models + `FieldType`, `OPTION_TYPES`,
  `MULTI_VALUE_TYPES`, `NO_VALUE_TYPES`, `MAX_CASCADE_DEPTH` (BUILT).
- `backend/apps/itsm_core/services/fields.py` — `field_service` (BUILT): `get_field_definitions`,
  `get_values`, `set_values` (skips `maps_to`/value-less keys), `get_layout`, `validate_required`
  (keyed by field key; **skips a mandatory option field that has no active options** so an unconfigured
  catalog can't deadlock creation — mirrors the create form's client guard; takes **`portal_only`** to
  also skip `portal_visible=False` mandatory fields on the portal path; used by the portal
  Create-Request intake — see itsm-tickets).
  `_coerce` runs `richtext` values through `sanitize_html` (bleach) on write — the only custom type
  rendered as HTML on the client.
- `backend/apps/itsm_core/seed.py` — standard catalog: `GLOBAL_FIELDS`, `LAYOUT_SPEC`,
  `seed_system_fields`, `ensure_project_layout`, `backfill_layouts`, `run`.
- `serializers.py` / `views.py` / `urls.py` (BUILT; `FieldOptionSerializer` exposes `parent`/`level`).
- Migration `0003_fieldoption_level_fieldoption_parent_and_more` — adds `parent`/`level` + new types.
- Migration `0005_fieldlayoutitem_portal_visible` — adds `portal_visible` (default `True`) + a RunPython
  backfill flagging picker fields (user/group) + privileged `maps_to` (assignee/assigned_group/
  requestor/source) to `False`, preserving the pre-flag portal field set. Multi-tenant: itsm_core is a
  TENANT app, so this runs once per tenant schema via `migrate_schemas --tenant`.

## Portal visibility (`portal_visible`)
The end-user Service Portal request form (`PortalRequestForm`) shows a field only when its layout item
is `portal_visible` (and not `is_hidden`, and its `visibility_rule` passes). **The same flag now also
gates the portal request-*detail* (read-only):** `PortalTicketViewSet.retrieve` clamps the layout to
`portal_visible` items and returns a `field_values` map, so the Track-request page shows exactly the
fields a requestor may see, filled in, in the project's layout (`components/portal/portal-field-display.tsx`).
The agent create form ignores `portal_visible` (agents see everything not `is_hidden`). Enforcement is
two-layered:
- **Server** — the portal intake `layout` action (`itsm_tickets/portal.py`) strips non-`portal_visible`
  items before they reach the requestor; the `create` action additionally force-ignores any
  `_ALLOWED_MAPS_TO`-excluded column (assignee/assigned_group/requestor/source) regardless of the flag
  (defence in depth — a requestor can never set assignment even if a flag is misconfigured). It also
  calls `field_service.validate_required(..., portal_only=True)`, which **skips mandatory fields with
  `portal_visible=False`** — otherwise a field marked Required + Portal-off would be hidden from the
  requestor yet block every submission (a deadlock). Agents validate the full set (`portal_only=False`).
- **Client** — `portal-request-form.tsx` also drops `portal_visible === false` (safety net + fallback).
Admins toggle it in the Layout designer (the **Portal** switch per field card).
