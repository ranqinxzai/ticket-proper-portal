"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import {
  consoleApi,
  consoleTokenStore,
  setConsoleOnAuthFailure,
  type ConsoleUser,
} from "./client";

type ConsoleAuthState = {
  user: ConsoleUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<ConsoleUser>;
  logout: () => void;
};

const ConsoleAuthContext = createContext<ConsoleAuthState | null>(null);

export function ConsoleAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ConsoleUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Boot: hydrate the cached user (the admin endpoints have no /me, so we trust
  // the stored token until a request 401s and the auth-failure hook fires).
  useEffect(() => {
    const cached = consoleTokenStore.getUser<ConsoleUser>();
    if (cached) setUser(cached);
    setLoading(false);
  }, []);

  useEffect(() => {
    setConsoleOnAuthFailure(() => {
      setUser(null);
      consoleTokenStore.clear();
      router.replace("/console/login");
    });
    return () => setConsoleOnAuthFailure(null);
  }, [router]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await consoleApi.login(username, password);
    consoleTokenStore.setTokens(res.access, res.refresh);
    consoleTokenStore.setUser(res.user);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    consoleTokenStore.clear();
    setUser(null);
    router.replace("/console/login");
  }, [router]);

  return (
    <ConsoleAuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </ConsoleAuthContext.Provider>
  );
}

export function useConsoleAuth(): ConsoleAuthState {
  const ctx = useContext(ConsoleAuthContext);
  if (!ctx) throw new Error("useConsoleAuth must be used within a ConsoleAuthProvider");
  return ctx;
}

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Requires a console session; otherwise bounces to /console/login. */
export function ConsoleGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useConsoleAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user && !consoleTokenStore.access) router.replace("/console/login");
  }, [user, loading, router]);

  if (loading) return <FullScreenMessage>Loading…</FullScreenMessage>;
  if (!user && !consoleTokenStore.access) return <FullScreenMessage>Redirecting…</FullScreenMessage>;
  return <>{children}</>;
}
