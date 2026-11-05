"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useUi } from "@/components/theme/density-provider";
import { useItsmAuth } from "@/lib/itsm/auth";
import { adminHome, agentApprovals, agentHome, workspaceBase } from "@/lib/itsm/nav";
import { type GoTarget, type PageKeyMap, useGlobalShortcuts } from "@/lib/itsm/use-global-shortcuts";
import { CommandPalette } from "./command-palette";
import { ShortcutsSheet } from "./shortcuts-sheet";

/**
 * Hosts the Modern interface's keyboard shortcuts, ⌘K command palette and `?` sheet
 * (2026-11-05, step B2). Mounted once in the agent layout. Everything is off in
 * Classic: `useShortcuts()` is null there, so the top-bar Search button and the
 * account-menu "Keyboard shortcuts" item don't render.
 */
type Shortcuts = {
  openPalette: () => void;
  openSheet: () => void;
  /** Register a page's keys; returns the unregister function. */
  register: (keys: { current: PageKeyMap }) => () => void;
};
const ShortcutsContext = createContext<Shortcuts | null>(null);

export function useShortcuts(): Shortcuts | null {
  return useContext(ShortcutsContext);
}

/**
 * A page's single-key shortcuts (Modern only: a no-op in Classic, where the host's
 * context is null). Goes through the host's one keydown listener, so the typing /
 * dialog / modifier guards apply. `keys` may be a fresh object every render: the
 * latest one is read at key-press time.
 */
export function usePageShortcuts(keys: PageKeyMap, enabled = true) {
  const sc = useShortcuts();
  const ref = useRef(keys);
  ref.current = keys;
  const register = sc?.register;
  useEffect(() => {
    if (!register || !enabled) return;
    return register(ref);
  }, [register, enabled]);
}

const WS_RE = /^\/t\/[^/]+\/agent\/w\/([^/]+)/;

export function ShortcutsHost({ children }: { children: React.ReactNode }) {
  const { ui } = useUi();
  const enabled = ui === "modern";
  const router = useRouter();
  const pathname = usePathname();
  const { org, isAdmin, isSupervisor, hasPerm } = useItsmAuth();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const helpdeskKey = pathname.match(WS_RE)?.[1] ?? null;

  const openPalette = useCallback(() => {
    setSheetOpen(false);
    setPaletteOpen(true);
  }, []);
  const openSheet = useCallback(() => {
    setPaletteOpen(false);
    setSheetOpen(true);
  }, []);

  const goTo = useCallback(
    (target: GoTarget) => {
      if (target === "approvals") return router.push(agentApprovals(org));
      if (!helpdeskKey) {
        if (target === "settings" && (isSupervisor || hasPerm("itsm.admin.roles", "read"))) {
          return router.push(adminHome(org));
        }
        return router.push(agentHome(org));
      }
      const base = workspaceBase(org, helpdeskKey);
      if (target === "dashboard") return router.push(`${base}/dashboard`);
      if (target === "tickets") return router.push(`${base}/all`);
      if (target === "assets") return router.push(`${base}/assets/list`);
      if (target === "settings" && isAdmin) return router.push(`${base}/settings`);
    },
    [router, org, helpdeskKey, isAdmin, isSupervisor, hasPerm],
  );

  // Page keys: a stack, merged at key-press time, so a page mounted on top (a docked
  // ticket over its queue) overrides the keys it defines (J/K) while the rest of the
  // one below (/, F) keeps working; unmounting restores the lower ones.
  const pageStack = useRef<{ current: PageKeyMap }[]>([]);
  const register = useCallback((keys: { current: PageKeyMap }) => {
    pageStack.current.push(keys);
    return () => {
      pageStack.current = pageStack.current.filter((k) => k !== keys);
    };
  }, []);
  const pageKeys = useCallback(
    () => (pageStack.current.length ? Object.assign({}, ...pageStack.current.map((k) => k.current)) : null),
    [],
  );

  useGlobalShortcuts({ enabled, onPalette: openPalette, onHelp: openSheet, goTo, pageKeys });

  const value = useMemo(
    () => (enabled ? { openPalette, openSheet, register } : null),
    [enabled, openPalette, openSheet, register],
  );

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
      {enabled ? (
        <>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            helpdeskKey={helpdeskKey}
            onShowShortcuts={openSheet}
          />
          <ShortcutsSheet open={sheetOpen} onOpenChange={setSheetOpen} />
        </>
      ) : null}
    </ShortcutsContext.Provider>
  );
}
