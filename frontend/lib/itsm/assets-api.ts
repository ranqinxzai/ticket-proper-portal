/** API client for Asset Management v1 (`/api/v1/t/<org>/itsm/asset*`). */

import { itsmClient, pickResults, qs, saveBlob } from "./client";
import type {
  AssetCategory,
  AssetCategoryFieldLink,
  AssetCategoryInput,
  AssetDetail,
  AssetDetailField,
  AssetDocType,
  AssetDocument,
  AssetEvent,
  AssetField,
  AssetFieldInput,
  AssetFilters,
  AssetGroupBy,
  AssetImportResult,
  AssetImportRow,
  AssetImportRun,
  AssetInput,
  AssetListItem,
  AssetListParams,
  AssetReport,
  AssetStatus,
  AssetStatusInput,
  AssetSummary,
  AssetTicketsResponse,
  AssetUserRef,
  Department,
  DepartmentInput,
  Location,
  LocationInput,
  Vendor,
  VendorInput,
} from "./assets-types";
import type { Paginated } from "./types";

export const assetsApi = {
  list: (params: AssetListParams = {}) =>
    itsmClient.get<Paginated<AssetListItem>>(`/assets/${qs(params)}`),
  get: (id: string) => itsmClient.get<AssetDetail>(`/assets/${id}/`),
  create: (body: AssetInput) => itsmClient.post<AssetDetail>("/assets/", body),
  update: (id: string, body: AssetInput) => itsmClient.patch<AssetDetail>(`/assets/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/assets/${id}/`),
  history: (id: string) => itsmClient.get<AssetEvent[]>(`/assets/${id}/history/`),
  /** Tickets linked to this asset that the caller can open (open first). */
  tickets: (id: string) => itsmClient.get<AssetTicketsResponse>(`/assets/${id}/tickets/`),
  /** Invoice, warranty card, manual and other files (Invoice first). */
  documents: (id: string) => itsmClient.get<AssetDocument[]>(`/assets/${id}/documents/`),
  uploadDocument: (id: string, file: File, docType: AssetDocType, note: string) => {
    const fd = new FormData();
    fd.append("doc_type", docType);
    fd.append("note", note);
    fd.append("file", file);
    return itsmClient.upload<AssetDocument>(`/assets/${id}/documents/`, fd);
  },
  removeDocument: (id: string, docId: string) => itsmClient.del<void>(`/assets/${id}/documents/${docId}/`),
  /** The file as a blob (typed by the server), fetched with the user's token. */
  documentBlob: async (id: string, docId: string) =>
    (await itsmClient.blob(`/assets/${id}/documents/${docId}/download/`)).blob,
  /** Save the file under its original name (the header's `filename*` form isn't parsed). */
  downloadDocument: async (id: string, doc: AssetDocument): Promise<void> => {
    const { blob } = await itsmClient.blob(`/assets/${id}/documents/${doc.id}/download/`);
    saveBlob(blob, doc.original_name || "document");
  },
  summary: (params: AssetFilters = {}) => itsmClient.get<AssetSummary>(`/assets/summary/${qs(params)}`),
  report: (params: AssetFilters & { group_by?: AssetGroupBy } = {}) =>
    itsmClient.get<AssetReport>(`/assets/report/${qs(params)}`),
  /** Excel: a Summary sheet (grouped) + an Assets sheet with every column. `helpdesk` is required. */
  export: (params: AssetFilters & { group_by?: AssetGroupBy; ordering?: string }) =>
    itsmClient.download(`/assets/export/${qs(params)}`, "assets.xlsx"),
  formFields: (params: { helpdesk?: string; category: string; sub_category?: string | null }) =>
    itsmClient.get<AssetDetailField[]>(`/assets/form-fields/${qs(params)}`),
};

export const assetImportsApi = {
  list: (params: { helpdesk?: string; page?: number; page_size?: number } = {}) =>
    itsmClient.get<Paginated<AssetImportRun>>(`/asset-imports/${qs(params)}`),
  get: (id: string) => itsmClient.get<AssetImportRun>(`/asset-imports/${id}/`),
  rows: (id: string, params: { page?: number; page_size?: number } = {}) =>
    itsmClient.get<Paginated<AssetImportRow>>(`/asset-imports/${id}/rows/${qs(params)}`),
  template: (helpdesk: string) =>
    itsmClient.download(`/asset-imports/template/${qs({ helpdesk })}`, "asset-import-template.xlsx"),
  failedRows: (id: string) => itsmClient.download(`/asset-imports/${id}/failed-rows/`, "failed-rows.xlsx"),
  /** Check only: validates every row, saves nothing. */
  validate: (helpdesk: string, file: File, createMissing: boolean) =>
    itsmClient.upload<AssetImportResult>("/asset-imports/validate/", importForm(helpdesk, file, createMissing)),
  /** Saves the good rows; failed rows are kept on the import record. */
  run: (helpdesk: string, file: File, createMissing: boolean) =>
    itsmClient.upload<AssetImportResult>("/asset-imports/", importForm(helpdesk, file, createMissing)),
};

function importForm(helpdesk: string, file: File, createMissing: boolean): FormData {
  const form = new FormData();
  form.append("helpdesk", helpdesk);
  form.append("file", file);
  form.append("create_missing", createMissing ? "1" : "0");
  return form;
}

export const assetStatusesApi = {
  list: async () => pickResults<AssetStatus>(await itsmClient.get("/asset-statuses/")),
  create: (body: AssetStatusInput) => itsmClient.post<AssetStatus>("/asset-statuses/", body),
  update: (id: string, body: AssetStatusInput) => itsmClient.patch<AssetStatus>(`/asset-statuses/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/asset-statuses/${id}/`),
};

function masterApi<T, I>(path: string) {
  return {
    list: async (params: { active?: boolean; search?: string } = {}) =>
      pickResults<T>(await itsmClient.get(`/${path}/${qs({ ...params, active: params.active ? 1 : undefined })}`)),
    create: (body: I) => itsmClient.post<T>(`/${path}/`, body),
    update: (id: string, body: I) => itsmClient.patch<T>(`/${path}/${id}/`, body),
    delete: (id: string) => itsmClient.del<void>(`/${path}/${id}/`),
  };
}

export const vendorsApi = masterApi<Vendor, VendorInput>("asset-vendors");
export const locationsApi = masterApi<Location, LocationInput>("asset-locations");
export const departmentsApi = masterApi<Department, DepartmentInput>("asset-departments");

export const assetCategoriesApi = {
  list: async (params: { helpdesk?: string; active?: boolean } = {}) =>
    pickResults<AssetCategory>(
      await itsmClient.get(`/asset-categories/${qs({ helpdesk: params.helpdesk, active: params.active ? 1 : undefined })}`),
    ),
  create: (body: AssetCategoryInput) => itsmClient.post<AssetCategory>("/asset-categories/", body),
  update: (id: string, body: AssetCategoryInput) => itsmClient.patch<AssetCategory>(`/asset-categories/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/asset-categories/${id}/`),
  loadStarter: (helpdesk: string) =>
    itsmClient.post<{ fields: number; categories: number; links: number }>("/asset-categories/load-starter/", { helpdesk }),
};

export const assetFieldsApi = {
  list: async (params: { helpdesk?: string } = {}) =>
    pickResults<AssetField>(await itsmClient.get(`/asset-fields/${qs(params)}`)),
  create: (body: AssetFieldInput) => itsmClient.post<AssetField>("/asset-fields/", body),
  update: (id: string, body: AssetFieldInput) => itsmClient.patch<AssetField>(`/asset-fields/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/asset-fields/${id}/`),
};

export const assetCategoryFieldsApi = {
  list: async (params: { helpdesk?: string; category?: string } = {}) =>
    pickResults<AssetCategoryFieldLink>(await itsmClient.get(`/asset-category-fields/${qs(params)}`)),
  create: (body: { category: string; field: string; is_required?: boolean; sort_order?: number }) =>
    itsmClient.post<AssetCategoryFieldLink>("/asset-category-fields/", body),
  update: (id: string, body: { is_required?: boolean; sort_order?: number }) =>
    itsmClient.patch<AssetCategoryFieldLink>(`/asset-category-fields/${id}/`, body),
  delete: (id: string) => itsmClient.del<void>(`/asset-category-fields/${id}/`),
};

export const assetUsersApi = {
  /** Active people (bots hidden), readable with Assets read — `/users/` needs ticket access. */
  search: async (search: string) =>
    pickResults<AssetUserRef>(await itsmClient.get(`/asset-users/${qs({ search, page_size: 25 })}`)),
};
