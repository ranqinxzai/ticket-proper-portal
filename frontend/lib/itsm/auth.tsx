"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { authApi } from "./api";
import { ItsmAuthError, setOnAuthFailure, tokenStore } from "./client";
import type { ItsmUser, PermAction } from "./types";

type ItsmAuthState = {
  user: ItsmUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<ItsmUser>;
  logout: () => void;
  hasPerm: (moduleCode: string, action: PermAction) => boolean;
  /** True for supervisor / admin-ish roles or superusers. */
  isSupervisor: boolean;
  /** True if the user can use the agent app (member of a helpdesk or superuser). */
  isAgent: boolean;
};

const ItsmAuthContext = createContext<ItsmAuthState | null>(null);

const SUPERVISOR_ROLES = new Set(["supervisor", "admin", "administrator", "manager"]);

/** A user belongs in the agent app if they are a superuser, a member of any
 * helpdesk, or hold a non-requestor ITSM role. Pure requestors go to the portal. */
export function isAgentUser(user: ItsmUser | null): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  if (user.role?.code === "requestor") return false;
  if ((user.helpdesks?.length ?? 0) > 0) return true;
  return Boolean(user.role);
}

/** Where this user should land after login. */
export function homePathFor(user: ItsmUser | null): string {
  return isAgentUser(user) ? "/agent" : "/portal";
}

export function ItsmAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ItsmUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Boot: hydrate from localStorage, then revalidate against /auth/me.
  useEffect(() => {
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
  }, []);

  // When the client gives up on a refresh, drop the user and bounce to login.
  useEffect(() => {
    setOnAuthFailure(() => {
      setUser(null);
      tokenStore.clear();
      router.replace("/login");
    });
    return () => setOnAuthFailure(null);
  }, [router]);

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
    router.replace("/login");
  }, [router]);

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
      value={{ user, loading, login, logout, hasPerm, isSupervisor, isAgent: isAgentUser(user) }}
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
  const { user, loading, isAgent } = useItsmAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user && !tokenStore.access) {
      router.replace("/login");
    } else if (user && !isAgent) {
      router.replace("/portal");
    }
  }, [user, loading, isAgent, router]);

  if (loading) return <FullScreenMessage>Loading…</FullScreenMessage>;
  if (!user || !isAgent) return <FullScreenMessage>Redirecting…</FullScreenMessage>;
  return <>{children}</>;
}

/** Requires a session. Agents may view the portal; pure requestors live here. */
export function PortalGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useItsmAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user && !tokenStore.access) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  if (loading) return <FullScreenMessage>Loading…</FullScreenMessage>;
  if (!user) return <FullScreenMessage>Redirecting…</FullScreenMessage>;
  return <>{children}</>;
}

export { ItsmAuthError };
