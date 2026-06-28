/**
 * Platform super-admin console API client.
 *
 * The console is NOT org-scoped: it hits `/api/v1/admin/...` to create and
 * manage organisations. It uses its OWN JWT tokens, stored under distinct
 * localStorage keys (`console_access` / `console_refresh` / `console_user`) so
 * it never collides with an org session (`itsm_*`).
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000/api/v1";
const ADMIN_BASE = `${API_BASE}/admin`;

const ACCESS_KEY = "console_access";
const REFRESH_KEY = "console_refresh";
const USER_KEY = "console_user";

export type ConsoleUser = {
  id: string | number;
  username: string;
  full_name: string;
  is_superuser: boolean;
};

export type Org = {
  id: string | number;
  name: string;
  schema_name: string;
  is_active: boolean;
  created_on: string;
  login_url: string;
};

export type OrgUser = {
  id: string | number;
  username: string;
  full_name: string;
  email: string;
  is_superuser: boolean;
  is_active: boolean;
};

export type CreateOrgInput = {
  name: string;
  slug: string;
  admin_username: string;
  admin_password: string;
  admin_email?: string;
  admin_full_name?: string;
};

export class ConsoleApiError extends Error {
  status: number;
  /** Field-level errors from a 400 (`{field: [msg]}`). */
  fieldErrors?: Record<string, string[]>;
  constructor(message: string, status: number, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "ConsoleApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const consoleTokenStore = {
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

function extractError(text: string, status: number): ConsoleApiError {
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object") {
      if (typeof data.detail === "string") return new ConsoleApiError(data.detail, status);
      const bag: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) bag[k] = v.map(String);
        else if (typeof v === "string") bag[k] = [v];
      }
      const firstKey = Object.keys(bag)[0];
      if (firstKey) return new ConsoleApiError(`${firstKey}: ${bag[firstKey][0]}`, status, bag);
    }
  } catch {
    /* not JSON */
  }
  return new ConsoleApiError(text || `Request failed (${status})`, status);
}

let refreshInFlight: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refresh = consoleTokenStore.refresh;
  if (!refresh) return null;
  try {
    const res = await fetch(`${ADMIN_BASE}/auth/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access?: string; refresh?: string };
    if (!data.access) return null;
    consoleTokenStore.setTokens(data.access, data.refresh);
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

let onAuthFailure: (() => void) | null = null;
export function setConsoleOnAuthFailure(cb: (() => void) | null) {
  onAuthFailure = cb;
}

type RequestOpts = { anon?: boolean };

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOpts = {},
  isRetry = false,
): Promise<T> {
  const { anon = false } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const access = consoleTokenStore.access;
  if (!anon && access) headers["Authorization"] = `Bearer ${access}`;

  const res = await fetch(`${ADMIN_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  if (res.status === 401 && !anon && !isRetry) {
    const newAccess = await refreshAccess();
    if (newAccess) return request<T>(method, path, body, opts, true);
    consoleTokenStore.clear();
    onAuthFailure?.();
    throw new ConsoleApiError("Session expired", 401);
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

type LoginResponse = { access: string; refresh: string; user: ConsoleUser };

export const consoleApi = {
  login: (username: string, password: string) =>
    request<LoginResponse>("POST", "/auth/login/", { username, password }, { anon: true }),
  listOrgs: async (): Promise<Org[]> => {
    const r = await request<Org[] | { results: Org[] }>("GET", "/orgs/");
    return Array.isArray(r) ? r : (r?.results ?? []);
  },
  createOrg: (body: CreateOrgInput) => request<Org>("POST", "/orgs/", body),
  updateOrg: (schemaName: string, body: { name?: string; is_active?: boolean; slug?: string }) =>
    request<Org>("PATCH", `/orgs/${schemaName}/`, body),
  deleteOrg: (schemaName: string) => request<void>("DELETE", `/orgs/${schemaName}/`),
  listUsers: async (schemaName: string): Promise<OrgUser[]> => {
    const r = await request<OrgUser[] | { results: OrgUser[] }>("GET", `/orgs/${schemaName}/users/`);
    return Array.isArray(r) ? r : (r?.results ?? []);
  },
  createUser: (
    schemaName: string,
    body: { username: string; password: string; email?: string; full_name?: string; is_admin?: boolean },
  ) => request<OrgUser>("POST", `/orgs/${schemaName}/users/`, body),
  updateUser: (
    schemaName: string,
    username: string,
    body: { email?: string; full_name?: string; is_active?: boolean; is_admin?: boolean; password?: string },
  ) => request<OrgUser>("PATCH", `/orgs/${schemaName}/users/${encodeURIComponent(username)}/`, body),
  deleteUser: (schemaName: string, username: string) =>
    request<void>("DELETE", `/orgs/${schemaName}/users/${encodeURIComponent(username)}/`),
  resetPassword: (schemaName: string, body: { username: string; new_password: string }) =>
    request<void>("POST", `/orgs/${schemaName}/reset-admin-password/`, body),
};
