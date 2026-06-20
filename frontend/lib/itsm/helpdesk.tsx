"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useItsmAuth } from "./auth";
import type { Helpdesk } from "./types";

/**
 * Selected-helpdesk context. The list of accessible helpdesks comes from the
 * authenticated user (`/auth/me` → user.helpdesks). The selection is persisted
 * in localStorage and is **advisory only** — it scopes the UI, but the server
 * always re-derives and clamps access, so it is never a security boundary.
 *
 * Mount INSIDE ItsmGuard (it needs a hydrated user).
 */

const STORAGE_KEY = "itsm_helpdesk";

type HelpdeskState = {
  helpdesks: Helpdesk[];
  selected: Helpdesk | null;
  setSelected: (idOrKey: string) => void;
  loading: boolean;
};

const HelpdeskContext = createContext<HelpdeskState | null>(null);

function readPersisted(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writePersisted(key: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (key) window.localStorage.setItem(STORAGE_KEY, key);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function HelpdeskProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useItsmAuth();
  const helpdesks = useMemo<Helpdesk[]>(() => user?.helpdesks ?? [], [user]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Reconcile the selection whenever the accessible set changes (login, membership
  // revoked, etc). Validate the persisted key; fall back to the first helpdesk.
  useEffect(() => {
    if (authLoading) return;
    if (helpdesks.length === 0) {
      setSelectedKey(null);
      return;
    }
    setSelectedKey((current) => {
      const persisted = current ?? readPersisted();
      const valid = persisted && helpdesks.some((h) => h.key === persisted) ? persisted : helpdesks[0].key;
      if (valid !== persisted) writePersisted(valid);
      return valid;
    });
  }, [helpdesks, authLoading]);

  const setSelected = useCallback((idOrKey: string) => {
    const next = helpdesks.find((h) => h.key === idOrKey || h.id === idOrKey);
    if (!next) return;
    writePersisted(next.key);
    setSelectedKey(next.key);
  }, [helpdesks]);

  const selected = useMemo(
    () => helpdesks.find((h) => h.key === selectedKey) ?? null,
    [helpdesks, selectedKey],
  );

  const value: HelpdeskState = { helpdesks, selected, setSelected, loading: authLoading };
  return <HelpdeskContext.Provider value={value}>{children}</HelpdeskContext.Provider>;
}

export function useSelectedHelpdesk(): HelpdeskState {
  const ctx = useContext(HelpdeskContext);
  if (!ctx) throw new Error("useSelectedHelpdesk must be used within a HelpdeskProvider");
  return ctx;
}
