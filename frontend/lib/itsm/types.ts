/** Shared TypeScript types for the ITSM platform (P0 foundation; expanded per phase). */

export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

// ---- auth / users ---------------------------------------------------------

export type PermAction = "read" | "create" | "update" | "delete";
export type ModulePerms = Record<PermAction, boolean>;
/** module_code -> {read, create, update, delete} */
export type PermissionMap = Record<string, ModulePerms>;

export type ItsmRole = { code: string; name: string };

/** A workspace/department (helpdesk) the user can access. */
export type Helpdesk = {
  id: string;
  key: string;
  name: string;
  icon?: string;
  color?: string;
  description?: string;
  status?: string;
  member_count?: number;
};

export type ItsmUser = {
  id: string | number;
  username: string;
  full_name: string;
  email: string;
  is_superuser: boolean;
  role: ItsmRole | null;
  permissions: PermissionMap;
  /** Helpdesks this user may access (server-derived; superusers get all active). */
  helpdesks?: Helpdesk[];
};

export type LoginResponse = {
  access: string;
  refresh: string;
  user: ItsmUser;
};

/** Lightweight user reference used inside ticket payloads. */
export type UserRef = {
  id: string | number;
  username: string;
  full_name: string;
};
