/**
 * JWT API client for the ITSM platform.
 *
 * - Stores `itsm_access` / `itsm_refresh` / `itsm_user` in localStorage.
 * - Adds `Authorization: Bearer <access>` to every request.
 * - On 401, transparently refreshes the access token (single-flight) and
 *   retries the original request once.
 * - Reuses the DRF error-extraction shape from lib/api.ts.
 *
 * Base URL: `process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000/api/v1'`.
 * ITSM endpoints live under `/itsm/`; the existing accounts endpoint
 * (`/users/`) sits at the NON-itsm base, so callers pass an `itsm: false`
 * flag for those.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000/api/v1";

const ACCESS_KEY = "itsm_access";
const REFRESH_KEY = "itsm_refresh";
const USER_KEY = "itsm_user";

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

// ---- error extraction (mirrors lib/api.ts) --------------------------------

function extractError(text: string, status: number): ItsmApiError {
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object") {
      // 422 / domain validation: {detail, errors:{field:[msg]}}
      const fieldErrors =
        data.errors && typeof data.errors === "object" ? (data.errors as Record<string, string[]>) : undefined;
      if (typeof data.detail === "string") {
        return new ItsmApiError(data.detail, status, fieldErrors);
      }
      // Bare DRF field errors: {summary: ["This field is required."]}
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
  try {
    const res = await fetch(`${API_BASE}/itsm/auth/refresh/`, {
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
  /** Prefix the path with `/itsm`. Default true. Set false for `/users/` etc. */
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
  const url = `${API_BASE}${itsm ? "/itsm" : ""}${path}`;

  const headers: Record<string, string> = { ...(isForm ? {} : { "Content-Type": "application/json" }) };
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

export const itsmClient = {
  get: <T>(path: string, opts?: RequestOpts) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>("POST", path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>("PATCH", path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>("PUT", path, body, opts),
  del: <T>(path: string, opts?: RequestOpts) => request<T>("DELETE", path, undefined, opts),
  upload: <T>(path: string, form: FormData, opts?: RequestOpts) => request<T>("POST", path, form, opts),
};

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
    return ((r as { results: T[] }).results) ?? [];
  }
  return [];
}
