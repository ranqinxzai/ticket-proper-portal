/** Types for Asset Management v1 (`backend/apps/itsm_assets`). */

export type AssetStateType = "available" | "in_use" | "maintenance" | "retired" | "missing";

export const ASSET_STATE_TYPES: { value: AssetStateType; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "in_use", label: "In use" },
  { value: "maintenance", label: "Under maintenance" },
  { value: "retired", label: "Retired" },
  { value: "missing", label: "Missing" },
];

/** Active = counts in the active totals and is auto-expired once its Expiry Date passes. */
export const ACTIVE_STATE_TYPES: AssetStateType[] = ["available", "in_use", "maintenance"];

export type AssetFieldType = "text" | "number" | "date" | "checkbox" | "dropdown" | "multiselect";

export const ASSET_FIELD_TYPES: { value: AssetFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multiselect", label: "Multi-select" },
];

export type Ref = { id: string; name: string };
export type AssetUserRef = { id: number | string; username: string; full_name: string; email: string };

// ── Configuration ────────────────────────────────────────────────────────────

export type AssetStatus = {
  id: string;
  name: string;
  key: string;
  state_type: AssetStateType;
  state_type_label: string;
  color: string;
  description: string;
  sort_order: number;
  is_default: boolean;
  auto_expire_target: boolean;
  asset_count: number;
};
export type AssetStatusInput = Partial<
  Pick<AssetStatus, "name" | "state_type" | "color" | "description" | "sort_order" | "is_default" | "auto_expire_target">
>;

export type Vendor = {
  id: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  notes: string;
  is_active: boolean;
  asset_count: number;
};
export type Location = { id: string; name: string; code: string; address: string; is_active: boolean; asset_count: number };
export type Department = { id: string; name: string; code: string; is_active: boolean; asset_count: number };
export type VendorInput = Partial<Omit<Vendor, "id" | "asset_count">>;
export type LocationInput = Partial<Omit<Location, "id" | "asset_count">>;
export type DepartmentInput = Partial<Omit<Department, "id" | "asset_count">>;

export type AssetCategoryFieldLink = {
  id: string;
  category: string;
  field: string;
  field_name: string;
  field_key: string;
  field_type: AssetFieldType;
  field_is_active: boolean;
  is_required: boolean;
  sort_order: number;
};

export type AssetCategory = {
  id: string;
  helpdesk: string;
  /** null = top-level category; set = sub-category of that category. */
  parent: string | null;
  name: string;
  description: string;
  sort_order: number;
  is_active: boolean;
  /** Live assets using it (as category or sub-category). */
  asset_count: number;
  /** Fields linked at THIS node (a sub-category also inherits its parent's). */
  field_links: AssetCategoryFieldLink[];
};
export type AssetCategoryInput = Partial<
  Pick<AssetCategory, "helpdesk" | "parent" | "name" | "description" | "sort_order" | "is_active">
>;

export type AssetFieldOption = { id: string; value: string; label: string; sort_order: number; is_active: boolean };
export type AssetFieldOptionInput = { id?: string | null; value?: string; label: string; sort_order?: number; is_active?: boolean };

export type AssetField = {
  id: string;
  helpdesk: string;
  key: string;
  name: string;
  field_type: AssetFieldType;
  help_text: string;
  is_active: boolean;
  options: AssetFieldOption[];
  used_by: { category_id: string; name: string; is_required: boolean }[];
  value_count: number;
};
export type AssetFieldInput = Partial<Pick<AssetField, "helpdesk" | "name" | "field_type" | "help_text" | "is_active">> & {
  /** Full replacement list: existing options by id (label/order/active editable), new ones without id. */
  options_input?: AssetFieldOptionInput[];
};

/** One detail field as the asset form renders it (GET assets/form-fields/). */
export type AssetDetailField = {
  id: string;
  key: string;
  name: string;
  field_type: AssetFieldType;
  help_text: string;
  is_required: boolean;
  /** Linked on the parent category (not the sub-category itself). */
  inherited: boolean;
  options: { id: string; value: string; label: string }[];
};

// ── Assets ───────────────────────────────────────────────────────────────────

export type AssetStatusRef = Ref & { color: string; state_type: AssetStateType };

export type AssetListItem = {
  id: string;
  helpdesk: string;
  asset_tag: string;
  name: string;
  category: Ref;
  sub_category: Ref | null;
  status: AssetStatusRef;
  vendor: Ref | null;
  location: Ref | null;
  department: Ref | null;
  assigned_user: AssetUserRef | null;
  purchase_date: string | null;
  /** Decimal as a string, e.g. "45000.00". */
  purchase_cost: string | null;
  expiry_date: string | null;
  warranty_expiry_date: string | null;
  created_at: string;
  updated_at: string;
};

export type DetailValue = string | number | boolean | string[] | null;

export type AssetDetail = AssetListItem & {
  allotment_notes: string;
  allotted_at: string | null;
  /** {field key: value}: text/dropdown → string, number → string, date → "YYYY-MM-DD",
   *  checkbox → boolean, multiselect → string[] (option values). */
  details: Record<string, DetailValue>;
  detail_fields: AssetDetailField[];
  created_by: AssetUserRef | null;
  updated_by: AssetUserRef | null;
  source_import: { id: string; file_name: string } | null;
  expiry_passed: boolean;
};

/** POST assets/ (helpdesk required) and PATCH assets/{id}/ (any subset). */
export type AssetInput = {
  helpdesk?: string;
  name?: string;
  /** Blank on create = auto `<HD>-AST-00001`. */
  asset_tag?: string;
  category?: string | null;
  sub_category?: string | null;
  status?: string | null;
  vendor?: string | null;
  location?: string | null;
  department?: string | null;
  assigned_user?: number | string | null;
  allotment_notes?: string;
  purchase_date?: string | null;
  purchase_cost?: string | null;
  expiry_date?: string | null;
  warranty_expiry_date?: string | null;
  /** Full map of the detail fields that apply; omitted = keep current values. */
  details?: Record<string, DetailValue>;
};

export type AssetEventChange = { field: string; label: string; old: string | null; new: string | null; dropped?: boolean };
export type AssetEvent = {
  id: string;
  action:
    | "created"
    | "imported"
    | "updated"
    | "auto_expired"
    | "deleted"
    | "ticket_linked"
    | "ticket_unlinked"
    | "document_added"
    | "document_removed";
  action_label: string;
  actor: AssetUserRef | null;
  changes: AssetEventChange[];
  note: string;
  created_at: string;
};

/** Query params shared by the list, summary, report and export. Ids may be
 *  comma-separated; "none" matches an empty value. */
export type AssetFilters = {
  helpdesk?: string;
  search?: string;
  category?: string;
  sub_category?: string;
  status?: string;
  /** a state type, comma list, or "active" */
  state_type?: string;
  location?: string;
  department?: string;
  vendor?: string;
  assigned_user?: string;
  /** "expiring" (≤30 days) | "expired" | "covered" | "none" */
  warranty?: string;
  /** "expiring" (≤30 days) | "passed" | "none" */
  expiry?: string;
  purchased_from?: string;
  purchased_to?: string;
  import?: string;
};
export type AssetListParams = AssetFilters & { page?: number; page_size?: number; ordering?: string };

export type AssetGroupRow = {
  key: string;
  label: string;
  count: number;
  cost: string;
  percent?: number;
  color?: string;
  state_type?: AssetStateType;
};

export type AssetSummary = {
  today: string;
  window_days: number;
  total: number;
  active: number;
  active_cost: string;
  by_state_type: { key: AssetStateType; label: string; count: number }[];
  warranty_expiring: number;
  out_of_warranty: number;
  expiring: number;
  by_category: AssetGroupRow[];
  by_status: AssetGroupRow[];
  by_location: AssetGroupRow[];
  by_department: AssetGroupRow[];
  warranty_ending: {
    id: string;
    asset_tag: string;
    name: string;
    category: string;
    status: string;
    warranty_expiry_date: string;
    assigned_user: string | null;
  }[];
  recent: { id: string; asset_tag: string; name: string; category: string; status: string; status_color: string; created_at: string }[];
  has_statuses: boolean;
};

export type AssetGroupBy =
  | "category"
  | "sub_category"
  | "status"
  | "state_type"
  | "location"
  | "department"
  | "vendor"
  | "assigned_user";

export type AssetReport = { group_by: AssetGroupBy; rows: AssetGroupRow[]; total: { count: number; cost: string } };

// ── Import ───────────────────────────────────────────────────────────────────

export type AssetImportError = { column: string; message: string };
export type AssetImportFailedRow = { row_number: number; data: Record<string, string>; errors: AssetImportError[] };

/** Response of POST asset-imports/ (import) and asset-imports/validate/ (check only). */
export type AssetImportResult = {
  dry_run: boolean;
  /** Only when dry_run is false. */
  import_id?: string;
  total_rows: number;
  /** Check only: rows that would be created. Import: rows created. */
  valid_rows: number;
  failed_count: number;
  expired_count: number;
  /** {vendors|locations|departments: [names]} created (or that would be created). */
  will_create: Record<string, string[]>;
  warnings: string[];
  /** First 500 failed rows. */
  failed_rows: AssetImportFailedRow[];
};

export type AssetImportRun = {
  id: string;
  helpdesk: string;
  file_name: string;
  total_rows: number;
  created_count: number;
  failed_count: number;
  expired_count: number;
  created_masters: Record<string, string[]>;
  warnings: string[];
  created_by: AssetUserRef | null;
  created_at: string;
};
export type AssetImportRow = AssetImportFailedRow & { id: string };

// ── Linked tickets (Asset Management phase 2) ────────────────────────────────

/** One ticket raised against an asset (`GET assets/{id}/tickets/`, open first). */
export type AssetTicket = {
  id: string;
  ticket_number: string;
  summary: string;
  helpdesk_key: string | null;
  project_key: string | null;
  status_name: string | null;
  status_color: string | null;
  /** Status category key ("todo" | "in_progress" | "done" …). */
  status_category: string | null;
  priority: string;
  requestor: string | null;
  assignee: string | null;
  created_at: string;
  linked_at: string | null;
  is_primary: boolean;
};
export type AssetTicketsResponse = { count: number; open_count: number; results: AssetTicket[] };

/** The kinds of file kept against an asset (`AssetDocument.DocType`). */
export type AssetDocType = "invoice" | "warranty" | "manual" | "other";

/** A document on an asset. There is no file URL: files download only through the
 *  authenticated `assets/{id}/documents/{doc}/download/` action. */
export type AssetDocument = {
  id: string;
  doc_type: AssetDocType;
  doc_type_label: string;
  original_name: string;
  size_bytes: number;
  /** Decided by the server from the extension, never by the uploader. */
  content_type: string;
  note: string;
  uploaded_by: AssetUserRef | null;
  created_at: string;
};
