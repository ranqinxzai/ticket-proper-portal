"use client";

import { useParams, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { authApi } from "./api";
import { ItsmAuthError, setApiOrg, setOnAuthFailure, tokenStore } from "./client";
import { homePathFor, isAgentUser, orgLogin, portalHome } from "./nav";
import type { ItsmUser, PermAction } from "./types";

// Re-exported for callers that historically imported these from auth.
export { homePathFor, isAgentUser };

type ItsmAuthState = {
  user: ItsmUser | null;
  loading: boolean;
  /** Current org (tenant) slug from the `/t/<org>` route segment. */
  org: string;
  login: (username: string, password: string) => Promise<ItsmUser>;
  logout: () => void;
  hasPerm: (moduleCode: string, action: PermAction) => boolean;
  /** True for supervisor / admin-ish roles or superusers. */
  isSupervisor: boolean;
  /** True if the user can use the agent app (member of a helpdesk or superuser). */
  isAgent: boolean;
  /** Re-fetch /auth/me (e.g. after editing a helpdesk so the switcher updates). */
  refreshUser: () => Promise<ItsmUser | null>;
};

const ItsmAuthContext = createContext<ItsmAuthState | null>(null);

const SUPERVISOR_ROLES = new Set(["supervisor", "admin", "administrator", "manager"]);

export function ItsmAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ItsmUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { org = "" } = useParams<{ org: string }>();

  // Point the API client at this org before any request fires.
  useEffect(() => {
    if (org) setApiOrg(org);
  }, [org]);

  // Boot: hydrate from localStorage, then revalidate against /auth/me.
  useEffect(() => {
    if (org) setApiOrg(org);
    const cached = tokenStore.getUser<ItsmUser>();
    if (cached) setUser(cached);

    if (!tokenStore.access) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    authApi
      .me()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        tokenStore.setUser(u);
      })
      .catch(() => {
        if (cancelled) return;
        if (!cached) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org]);

  // When the client gives up on a refresh, drop the user and bounce to login.
  useEffect(() => {
    setOnAuthFailure(() => {
      setUser(null);
      tokenStore.clear();
      router.replace(orgLogin(org));
    });
    return () => setOnAuthFailure(null);
  }, [router, org]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await authApi.login(username, password);
    tokenStore.setTokens(res.access, res.refresh);
    tokenStore.setUser(res.user);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    router.replace(orgLogin(org));
  }, [router, org]);

  const refreshUser = useCallback(async () => {
    try {
      const u = await authApi.me();
      setUser(u);
      tokenStore.setUser(u);
      return u;
    } catch {
      return null;
    }
  }, []);

  const hasPerm = useCallback(
    (moduleCode: string, action: PermAction) => {
      if (!user) return false;
      if (user.is_superuser) return true;
      return Boolean(user.permissions?.[moduleCode]?.[action]);
    },
    [user],
  );

  const isSupervisor = Boolean(
    user && (user.is_superuser || (user.role && SUPERVISOR_ROLES.has(user.role.code.toLowerCase()))),
  );

  return (
    <ItsmAuthContext.Provider
      value={{ user, loading, org, login, logout, hasPerm, isSupervisor, isAgent: isAgentUser(user), refreshUser }}
    >
      {children}
    </ItsmAuthContext.Provider>
  );
}

export function useItsmAuth(): ItsmAuthState {
  const ctx = useContext(ItsmAuthContext);
  if (!ctx) throw new Error("useItsmAuth must be used within an ItsmAuthProvider");
  return ctx;
}

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Requires a session + agent capability; pure requestors are redirected to the portal. */
export function AgentGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, isAgent, org } = useItsmAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user && !tokenStore.access) {
      router.replace(orgLogin(org));
    } else if (user && !isAgent) {
      router.replace(portalHome(org));
    }
  }, [user, loading, isAgent, router, org]);

  if (loading) return <FullScreenMessage>Loading…</FullScreenMessage>;
  if (!user || !isAgent) return <FullScreenMessage>Redirecting…</FullScreenMessage>;
  return <>{children}</>;
}

/** Requires a session. Agents may view the portal; pure requestors live here. */
export function PortalGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, org } = useItsmAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user && !tokenStore.access) {
      router.replace(orgLogin(org));
    }
  }, [user, loading, router, org]);

  if (loading) return <FullScreenMessage>Loading…</FullScreenMessage>;
  if (!user) return <FullScreenMessage>Redirecting…</FullScreenMessage>;
  return <>{children}</>;
}

export { ItsmAuthError };
