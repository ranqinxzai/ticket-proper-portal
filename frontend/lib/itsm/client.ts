/**
 * JWT API client for the ITSM platform.
 *
 * - Stores `itsm_access` / `itsm_refresh` / `itsm_user` in localStorage.
 * - Adds `Authorization: Bearer <access>` to every request.
 * - On 401, transparently refreshes the access token (single-flight) and
 *   retries the original request once.
 *
 * Base URL: `process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000/api/v1'`.
 * ITSM endpoints live under `/itsm/`; non-itsm endpoints (e.g. `/users/`) pass
 * `{ itsm: false }`.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000/api/v1";

const ACCESS_KEY = "itsm_access";
const REFRESH_KEY = "itsm_refresh";
const USER_KEY = "itsm_user";
const ORG_KEY = "itsm_org";

// ---- org (tenant) resolution ----------------------------------------------
// Every org lives under a `/t/<org>` path segment, and its API under
// `/api/v1/t/<org>/...`. The active org is resolved in priority order:
//   1. an explicit override set by the auth provider (`setApiOrg`),
//   2. the leading `/t/<org>` segment of the current URL,
//   3. the last org persisted to localStorage.
const ORG_RE = /^\/t\/([a-z][a-z0-9_-]*)/;

let orgOverride: string | null = null;

/** Set (or clear) the active org. Persisted so it survives a hard reload that
 * lands before the provider mounts (e.g. a background refresh on `/`). */
export function setApiOrg(slug: string | null) {
  orgOverride = slug;
  const s = safeStorage();
  if (!s) return;
  if (slug) s.setItem(ORG_KEY, slug);
  else s.removeItem(ORG_KEY);
}

/** Resolve the active org slug, or null when none is known. */
export function getApiOrg(): string | null {
  if (orgOverride) return orgOverride;
  if (typeof window !== "undefined") {
    const m = ORG_RE.exec(window.location.pathname);
    if (m) return m[1];
  }
  return safeStorage()?.getItem(ORG_KEY) ?? null;
}

export class ItsmAuthError extends Error {
  constructor(message = "Session expired") {
    super(message);
    this.name = "ItsmAuthError";
  }
}

export class ItsmApiError extends Error {
  status: number;
  /** Field-level errors from a 422 / 400 ({field: [msg]}). */
  fieldErrors?: Record<string, string[]>;
  constructor(message: string, status: number, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "ItsmApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

// ---- token storage --------------------------------------------------------

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const tokenStore = {
  get access(): string | null {
    return safeStorage()?.getItem(ACCESS_KEY) ?? null;
  },
  get refresh(): string | null {
    return safeStorage()?.getItem(REFRESH_KEY) ?? null;
  },
  setTokens(access: string, refresh?: string) {
    const s = safeStorage();
    if (!s) return;
    s.setItem(ACCESS_KEY, access);
    if (refresh) s.setItem(REFRESH_KEY, refresh);
  },
  setUser(user: unknown) {
    safeStorage()?.setItem(USER_KEY, JSON.stringify(user));
  },
  getUser<T>(): T | null {
    const raw = safeStorage()?.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  clear() {
    const s = safeStorage();
    if (!s) return;
    s.removeItem(ACCESS_KEY);
    s.removeItem(REFRESH_KEY);
    s.removeItem(USER_KEY);
  },
};

// ---- error extraction -----------------------------------------------------

function extractError(text: string, status: number): ItsmApiError {
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object") {
      const fieldErrors =
        data.errors && typeof data.errors === "object"
          ? (data.errors as Record<string, string[]>)
          : undefined;
      if (typeof data.detail === "string") {
        return new ItsmApiError(data.detail, status, fieldErrors);
      }
      const firstKey = Object.keys(data)[0];
      if (firstKey) {
        const v = (data as Record<string, unknown>)[firstKey];
        const msg = Array.isArray(v) ? String(v[0]) : typeof v === "string" ? v : JSON.stringify(v);
        const bag: Record<string, string[]> = {};
        for (const [k, val] of Object.entries(data)) {
          if (Array.isArray(val)) bag[k] = val.map(String);
          else if (typeof val === "string") bag[k] = [val];
        }
        return new ItsmApiError(`${firstKey}: ${msg}`, status, fieldErrors ?? bag);
      }
    }
  } catch {
    /* not JSON */
  }
  return new ItsmApiError(text || `Request failed (${status})`, status);
}

// ---- refresh (single-flight) ----------------------------------------------

let refreshInFlight: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refresh = tokenStore.refresh;
  if (!refresh) return null;
  const org = getApiOrg();
  try {
    const res = await fetch(`${API_BASE}/t/${org}/itsm/auth/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access?: string; refresh?: string };
    if (!data.access) return null;
    tokenStore.setTokens(data.access, data.refresh);
    return data.access;
  } catch {
    return null;
  }
}

function refreshAccess(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Callback fired when refresh fails and the session is unrecoverable. */
let onAuthFailure: (() => void) | null = null;
export function setOnAuthFailure(cb: (() => void) | null) {
  onAuthFailure = cb;
}

// ---- core request ---------------------------------------------------------

type RequestOpts = {
  /** Prefix the path with `/itsm`. Default true. */
  itsm?: boolean;
  /** Skip the Authorization header (used by the login call). */
  anon?: boolean;
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOpts = {},
  isRetry = false,
): Promise<T> {
  const { itsm = true, anon = false } = opts;
  const isForm = body instanceof FormData;
  const org = getApiOrg();
  // Org-scoped requests target `/t/<org>/...`; without a resolved org we fall
  // back to the legacy unscoped path (the console uses its own client).
  const prefix = org ? `${API_BASE}/t/${org}` : API_BASE;
  const url = `${prefix}${itsm ? "/itsm" : ""}${path}`;

  const headers: Record<string, string> = {
    ...(isForm ? {} : { "Content-Type": "application/json" }),
  };
  const access = tokenStore.access;
  if (!anon && access) headers["Authorization"] = `Bearer ${access}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    cache: "no-store",
  });

  if (res.status === 401 && !anon && !isRetry) {
    const newAccess = await refreshAccess();
    if (newAccess) {
      return request<T>(method, path, body, opts, true);
    }
    tokenStore.clear();
    onAuthFailure?.();
    throw new ItsmAuthError();
  }

  if (!res.ok) {
    const text = await res.text();
    throw extractError(text, res.status);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** GET a binary response (file download) with the same auth + 401-refresh
 * handling as `request`. Returns the blob plus the server-suggested filename
 * (from Content-Disposition), if any. */
async function getBlob(
  path: string,
  opts: RequestOpts = {},
  isRetry = false,
): Promise<{ blob: Blob; filename: string | null }> {
  const { itsm = true } = opts;
  const org = getApiOrg();
  const prefix = org ? `${API_BASE}/t/${org}` : API_BASE;
  const url = `${prefix}${itsm ? "/itsm" : ""}${path}`;

  const headers: Record<string, string> = {};
  const access = tokenStore.access;
  if (access) headers["Authorization"] = `Bearer ${access}`;

  const res = await fetch(url, { method: "GET", headers, cache: "no-store" });

  if (res.status === 401 && !isRetry) {
    const newAccess = await refreshAccess();
    if (newAccess) return getBlob(path, opts, true);
    tokenStore.clear();
    onAuthFailure?.();
    throw new ItsmAuthError();
  }
  if (!res.ok) {
    throw extractError(await res.text(), res.status);
  }

  const cd = res.headers.get("Content-Disposition");
  const filename = cd ? (/filename="?([^"]+)"?/.exec(cd)?.[1] ?? null) : null;
  return { blob: await res.blob(), filename };
}

export const itsmClient = {
  get: <T>(path: string, opts?: RequestOpts) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>("POST", path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>("PATCH", path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>("PUT", path, body, opts),
  del: <T>(path: string, opts?: RequestOpts) => request<T>("DELETE", path, undefined, opts),
  upload: <T>(path: string, form: FormData, opts?: RequestOpts) => request<T>("POST", path, form, opts),
  /** Download a file. Triggers a browser "save" using the server filename
   * (overridable via `fallbackName`). */
  download: async (path: string, fallbackName?: string, opts?: RequestOpts) => {
    const { blob, filename } = await getBlob(path, opts);
    saveBlob(blob, filename ?? fallbackName ?? "download");
  },
};

/** Trigger a browser download for an in-memory blob. No-op outside the browser. */
export function saveBlob(blob: Blob, filename: string) {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const ITSM_API_BASE = API_BASE;

/** Build a query string from a record, dropping empty/nullish values. */
export function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Normalize a paginated or bare-list response into an array. */
export function pickResults<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && "results" in (r as object)) {
    return (r as { results: T[] }).results ?? [];
  }
  return [];
}
