/**
 * Asset Management v1 hover help. Written from the backend, not the plan:
 * backend/apps/itsm_assets/services/{asset_service,summary,filters,importer,details,tags}.py,
 * serializers.py, views.py and scheduler.py (2026-10-19).
 *
 * - "Active" = a status whose state type is Available, In use or Under maintenance
 *   (`ACTIVE_STATE_TYPES`).
 * - "Today" is the date in the org's default business-calendar time zone (UTC when there
 *   is none) — `parsing.org_today`. An Expiry Date "has passed" when it is before today.
 * - The expiry sweep is an APScheduler cron at minute 5 of every hour (UTC clock).
 */

import type { AssetGroupBy, AssetStateType } from "../assets-types";

const ACTIVE = "Available, In use or Under maintenance";

/** One line per state type (status badges, the statuses editor, dashboard tiles). */
export const ASSET_STATE_HELP: Record<AssetStateType, string> = {
  available: "Available: in stock and ready to allot. Counts as active.",
  in_use:
    "In use: allotted to someone. An In use status needs a User or a Department on the asset. Counts as active.",
  maintenance: "Under maintenance: temporarily out of service (for example in repair). Counts as active.",
  retired: "Retired: end of life, kept for the records (for example Expired or Disposed). Not active.",
  missing: "Missing: the asset can't be found (for example Lost). Not active.",
};

export const ASSET_HELP = {
  // asset-category-nav.tsx: counts = asset_count (live assets, every status)
  navTree:
    "Browse assets by category and sub-category. The numbers count every asset in it, whatever its status. Asset List itself still shows all assets.",
  // ── Concepts ───────────────────────────────────────────────────────────────
  stateType:
    "Every status maps to one fixed state type: Available, In use, Under maintenance, Retired or Missing. Filters, the dashboard and the expiry rules work on the state type, so you can rename statuses freely.",
  active: `Active means the status's state type is ${ACTIVE}.`,
  statusBadge: (name: string, state: AssetStateType) => `Status: ${name}\n${ASSET_STATE_HELP[state] ?? ""}`,

  // ── Dashboard ──────────────────────────────────────────────────────────────
  total: "Every asset in this helpdesk, whatever its status. Deleted assets aren't counted.",
  stateTile: (state: AssetStateType) =>
    `${ASSET_STATE_HELP[state] ?? ""}\nAssets whose status has this state type. Click to list them.`,
  activeCost:
    "Sum of the Purchase Cost of active assets. Assets without a cost count as 0. There is no currency: amounts are added as entered.",
  warrantyExpiring:
    `Active assets (${ACTIVE}) whose Warranty Expiry Date is today or in the next 30 days.`,
  outOfWarranty:
    `Active assets (${ACTIVE}) whose Warranty Expiry Date is before today. Assets with no warranty date aren't counted.`,
  expiring:
    `Active assets whose Expiry Date is today or in the next 30 days. Once the date has passed, the hourly job moves them to the Expired status.`,
  attention: "Live counts that need follow-up. Click a tile to list the assets.",
  byCategory: "Assets per category, largest first. Only the top 10 are shown; the rest are grouped as “N more”.",
  byStatus: "Assets per status, in the order set under Configuration → Statuses, in each status's colour.",
  byLocation: "Assets per location, largest first (top 10). “No location” = assets without one.",
  byDepartment: "Assets per department, largest first (top 10). “No department” = assets without one.",
  warrantyEnding: "The 10 active assets whose warranty ends soonest (today or in the next 30 days).",
  recent: "The 5 assets created most recently, by hand or by an import.",
  noCategories:
    "Assets need a category, and categories belong to this helpdesk. Add your own, or load the IT starter set (Computer, Server, Printer, Network, Monitor and Mobile, each with its own detail fields).",
  noStatuses:
    "No asset statuses exist yet, so assets can't be saved. Add at least one under Configuration → Statuses.",

  // ── List / filters ─────────────────────────────────────────────────────────
  search:
    "Matches the asset name, asset tag, the allotted user's name or username, and text in the detail fields. Combined with the filters.",
  filterStateType:
    "Filter by state type rather than by status. “Active” = Available, In use and Under maintenance together.",
  filterWarranty:
    "Ending in 30 days = warranty ends today or in the next 30 days. Ended = before today. Covered = today or later. No date = no Warranty Expiry Date.",
  warrantyColumn:
    "Amber: the warranty ends within 30 days. Red: it has ended. Dates are judged on the organisation's calendar date.",
  noneOption: "Assets with this left empty.",

  // ── Form ───────────────────────────────────────────────────────────────────
  assetTag:
    "Leave it blank and the next number is used, like IT-AST-00001. Tags are unique across the whole organisation, ignoring upper/lower case. A deleted asset's tag can be used again.",
  category:
    "Decides which detail fields the asset has. Only active categories of this helpdesk are listed.",
  subCategory:
    "Optional. A sub-category adds its own detail fields on top of its category's. If both link the same field, the sub-category's Required setting wins.",
  status:
    "Leave the default if unsure. An In use status needs a User or a Department. An active status can't be saved with an Expiry Date that has passed.",
  vendor: "Who supplied it. Vendors are shared by all helpdesks (Configuration → Vendors).",
  location: "Where it is. Locations are shared by all helpdesks (Configuration → Locations).",
  user: "The person it is allotted to. Changing the User or Department records the allotment time.",
  department: "The department it is allotted to. Departments are shared by all helpdesks.",
  allotmentNotes: "Free text about the allotment, up to 2,000 characters.",
  purchaseCost: "An amount with up to 2 decimals. There is no currency field.",
  expiryDate:
    "When the asset's life ends. Once an hour, active assets whose Expiry Date has passed move to the Expired status (the status marked as the Expired target). History records it as done by System.",
  warrantyExpiry: "When the warranty ends. Used by the warranty tiles, filters and the warranty column. Can't be before the purchase date.",
  details:
    "Fields set up for the chosen category and sub-category under Configuration → Categories & Fields. Fields from the category are marked “From <category>”.",
  expiryPassed: (date: string) =>
    `The expiry date (${date}) has passed — pick a retired status such as Expired, or change the date.`,
  inUseNeedsOwner: (status: string) => `“${status}” needs a User or a Department.`,
  categoryChange:
    "The new category may have different detail fields. Values of fields that don't apply to it are removed when you save, and History records what was removed.",

  // ── History ────────────────────────────────────────────────────────────────
  history: "Every change to this asset: who made it (System = the hourly expiry job), when, and the old and new values. The newest 200 changes are shown.",
  droppedValue: "Removed because the field no longer applies to the asset's category.",

  // ── Import ─────────────────────────────────────────────────────────────────
  importOverview:
    "Create-only: every row becomes a new asset; a row whose Asset Tag already exists is an error. Good rows are saved and bad rows are skipped. Failed rows are kept on the import so you can download them, fix them and upload just those. Up to 5,000 rows and 10 MB per file.",
  template:
    "An Excel file with the right columns (required ones marked *) and this helpdesk's detail fields, plus sheets with instructions, the valid categories, statuses, vendors, locations and departments, and which fields each category has.",
  createMissing:
    "Vendors, locations and departments that aren't in their lists yet are created (shared by all helpdesks). Without it, such a row fails.",
  createMissingNoPerm:
    "Needs the Asset Configuration → Create permission, because it adds vendors, locations and departments for every helpdesk.",
  checkOnly: "Checks every row and shows what would happen. Nothing is saved.",
  importRun: "Saves the good rows now. Failed rows are skipped and kept on the import for download.",
  blankStatus:
    "A row with a blank Status gets the default status, or Expired when its Expiry Date has passed.",
  failedRows:
    "The failed rows with the same columns plus an Errors column. Fix them in Excel and upload the file again.",
  noFailedRows: "Every row was imported — there are no failed rows to download.",
  expiredCount: "Rows with a blank Status and an Expiry Date that had passed, imported as Expired.",
  mastersCreated: "Vendors, locations and departments this import created because “Create missing” was ticked.",
  importHistory: "Every import into this helpdesk, newest first. Check-only runs aren't recorded.",

  // ── Report ─────────────────────────────────────────────────────────────────
  groupBy: "Counts the filtered assets per value of this field. Empty values get their own row, such as “No location”.",
  percent: "Share of the filtered assets in this group.",
  groupCost: "Sum of the Purchase Cost of the assets in this group (no currency; blanks count as 0).",
  export:
    "Downloads an Excel workbook with two sheets: Summary (grouped as shown) and Assets (every column, including detail fields). Up to 20,000 assets.",

  // ── Configuration ──────────────────────────────────────────────────────────
  sharedMasters:
    "Shared by all helpdesks: changes here show up in every helpdesk's asset forms, filters and imports.",
  perHelpdesk: "Categories and detail fields belong to this helpdesk only.",
  categoryTree:
    "Two levels: categories and their sub-categories. A category or sub-category can't be deleted while assets use it — deactivate it instead (existing assets keep it; new assets can't pick it).",
  categoryLevel: "A category can't change level or move to another category. Create it again where you need it.",
  inheritedFields: (parent: string) =>
    `Fields linked on “${parent}” apply to this sub-category too. Change them on “${parent}”.`,
  overridden: "Also linked on this sub-category, so this sub-category's Required setting is used.",
  required: "Required: the asset can't be saved (or imported) without a value. A dropdown with no options can't be required.",
  reorder: "Order of the field on the asset form.",
  unlink:
    "Removes the field from this node immediately. Assets keep their values until each one is next saved; then values for fields that no longer apply are removed.",
  fieldsLibrary:
    "Every detail field of this helpdesk. Link a field to any number of categories. Inactive fields are hidden from forms; their values are kept.",
  fieldType:
    "Text, number, date, checkbox, dropdown or multi-select. The type can't change once assets have values for the field.",
  fieldTypeLocked: "Assets already have values for this field, so its type can't change. Create a new field instead.",
  fieldOptions:
    "Choices for a dropdown or multi-select. Renaming an option keeps its stored value, so assets that use it keep it. Removing an option hides it from forms.",
  fieldActive: "Inactive fields are hidden from asset forms and imports. Their values are kept and come back when you turn it on again.",
  fieldDelete:
    "Removes the field from every category. Values already saved are kept (hidden) in the database and stay in History.",
  valueCount: "How many assets have a value saved for this field.",
  starterSet:
    "Adds Computer, Server, Printer, Network, Monitor and Mobile with typical detail fields (Service Tag, OS, RAM, IP address…). Anything that already exists is left as it is.",
  statusDefault: "Used when a new asset (or an import row) has no status. There is always exactly one default.",
  statusExpiredTarget:
    "The status the hourly job moves active assets to once their Expiry Date has passed (once an hour). Only a Retired-type status can be the target, and only one at a time.",
  statusExpiredTargetOnlyRetired: "Only a Retired-type status can be the Expired target.",
  statusOrder: "Order used in pickers, the dashboard and the report.",
  statusDelete:
    "A status can't be deleted while assets use it, or while it's the default. Move the assets first, or make another status the default.",
  masterDeleteInUse: (count: number, noun: string) =>
    `${count} ${count === 1 ? "asset uses" : "assets use"} this ${noun}, so it can't be deleted. Deactivate it instead — existing assets keep it, new assets can't pick it.`,
  masterActive: (noun: string) =>
    `Inactive ${noun}s are hidden from asset forms and can't be picked for new assets. Existing assets keep them.`,
  assetCount: "Assets (in any helpdesk) that use this item.",
} as const;

/** Group-by choices of the Asset Report (`summary.GROUPS`). */
export const ASSET_GROUP_BY: { value: AssetGroupBy; label: string }[] = [
  { value: "category", label: "Category" },
  { value: "sub_category", label: "Sub-category" },
  { value: "status", label: "Status" },
  { value: "state_type", label: "State type" },
  { value: "location", label: "Location" },
  { value: "department", label: "Department" },
  { value: "vendor", label: "Vendor" },
  { value: "assigned_user", label: "User" },
];

/**
 * Asset ↔ ticket links (phase 2). Written from backend/apps/itsm_tickets/services/
 * ticket_assets.py, itsm_tickets/views.py (create + tickets/{id}/assets/*),
 * itsm_tickets/portal.py (my-assets) and itsm_assets/views.py (assets/{id}/tickets/).
 */
export const ASSET_LINK_HELP = {
  field:
    "Assets linked to this ticket; the first is the primary. Defaults to the requestor's assets.",
  primary:
    "The primary asset is the first one linked. It is the one the Ticket Data report shows in its Asset column. Removing it makes the next asset primary.",
  makePrimary: (tag: string) => `Make ${tag} the primary asset`,
  remove: (tag: string) => `Unlink ${tag}`,
  requestorAssets:
    "Active assets (Available, In use or Under maintenance) of this helpdesk that are allotted to the requestor. Click one to link it. When a new ticket's requestor has exactly one, it is linked for you.",
  noRequestor: "Pick a Requestor to see the assets allotted to them.",
  finder:
    "Search every asset of this helpdesk, including unallotted, retired and missing ones, and link as many as you need.",
  finderSearch:
    "Matches the asset name, asset tag, the allotted user's name or username, and text in the detail fields. Combined with the filters.",
  needsAssetRead:
    "You need the Assets → Read permission to search assets. You can still keep the assets already linked.",
  needsUpdate: "You don't have permission to edit this ticket.",
  alreadyLinked: "Already linked to this ticket.",
  notAllotted: "Not allotted to anyone.",
  inactiveState: (label: string) => `${label}: this asset is not active. You can still link it, for example to record a fault on a retired device.`,
  deleted: "This asset has been deleted. The link is kept for the record.",
  portal:
    "Your own active assets in this helpdesk. Tick the ones this request is about; the first one you tick is the main one.",
  ticketsCard:
    "Tickets this asset is linked to, that you can open (your helpdesks and projects). Open tickets first, then newest. A ticket where this is the primary asset is marked Primary.",
  ticketsPrimary: "This is the ticket's primary asset (the first one linked).",
  layoutNote:
    "Tickets can link assets through the system “Asset” field. It is hidden on projects of helpdesks that had no asset categories; turn it on per project under Project settings → Layout.",
} as const;

/**
 * Asset documents (2026-10-31). Written from backend/apps/itsm_assets/services/documents.py
 * (`ALLOWED_TYPES`, `MAX_BYTES`, `NOTE_MAX`), permissions.AssetDocumentPermission and
 * views.AssetViewSet.documents / remove_document / download_document.
 */
export const ASSET_DOC_HELP = {
  card:
    "Files kept with this asset: its invoice, warranty card, manual and any other paperwork. Anyone who can view the asset can open them; anyone who can edit it can add or remove them. Every change is recorded in History.",
  types: "Invoice, Warranty card, Manual or Other. An asset can have several files of each type.",
  file: "PDF, image (PNG, JPG, GIF, WebP), Word, Excel or text file, up to 20 MB.",
  note: "Optional, up to 255 characters, for example the invoice number or the warranty period.",
  open: "PDFs and images open in a new tab. Other files download.",
  private:
    "Files are private to this app: they open only for signed-in users with access to the asset and have no public link.",
  remove: (name: string) => `Remove ${name}`,
  removeConfirm:
    "The file disappears from this asset and History records the removal. It isn't erased from the server, so your platform team can recover it if asked; there is no undo button.",
} as const;
