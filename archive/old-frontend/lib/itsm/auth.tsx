"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "./api";
import { tokenStore, setOnAuthFailure, ItsmAuthError } from "./client";
import type { ItsmUser, PermAction } from "./types";

type ItsmAuthState = {
  user: ItsmUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasPerm: (moduleCode: string, action: PermAction) => boolean;
  /** True for supervisor / admin-ish roles or superusers. */
  isSupervisor: boolean;
};

const ItsmAuthContext = createContext<ItsmAuthState | null>(null);

const SUPERVISOR_ROLES = new Set(["supervisor", "admin", "administrator", "manager"]);

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
      router.replace("/itsm-login");
    });
    return () => setOnAuthFailure(null);
  }, [router]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await authApi.login(username, password);
    tokenStore.setTokens(res.access, res.refresh);
    tokenStore.setUser(res.user);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    router.replace("/itsm-login");
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
    <ItsmAuthContext.Provider value={{ user, loading, login, logout, hasPerm, isSupervisor }}>
      {children}
    </ItsmAuthContext.Provider>
  );
}

export function useItsmAuth(): ItsmAuthState {
  const ctx = useContext(ItsmAuthContext);
  if (!ctx) throw new Error("useItsmAuth must be used within an ItsmAuthProvider");
  return ctx;
}

/** Redirects to /itsm-login when there is no session. Renders a spinner while booting. */
export function ItsmGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useItsmAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user && !tokenStore.access) {
      router.replace("/itsm-login");
    }
  }, [user, loading, router]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!user) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Redirecting…</div>;
  }

  return <>{children}</>;
}

export { ItsmAuthError };
