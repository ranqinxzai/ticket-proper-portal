# itsm-fields

## Purpose
The dynamic custom-field engine + layout designer. Beyond the standard ITIL columns on
`Ticket`, admins define typed custom fields per project/ticket-type and arrange them on a
layout; each ticket stores one typed `FieldValue` row per field. The models live in
**`itsm_core`** (`models/fields.py`); the REST API + `field_service` are BUILT (API + service live).

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
