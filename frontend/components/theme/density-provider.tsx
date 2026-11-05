"use client";

/**
 * Display density (comfortable / compact) AND the Interface preference (classic /
 * modern), the siblings of the theme provider.
 *
 * Interface (added 2026-11-05, Modern B1; Modern is the default since 2026-11-05c):
 * - localStorage UI_KEY; nothing stored means **modern**, only "classic" picks the
 *   previous layout. The same pre-paint script sets `data-ui="modern"` on <html> unless
 *   Classic is chosen,
 *   and `data-app="agent"` when the URL is an agent-app route (`/t/<org>/agent…`);
 *   AgentShell keeps `data-app` in sync across soft navigations. globals.css scopes
 *   every Modern token to `html[data-app="agent"][data-ui="modern"]`, so Modern also
 *   reaches portaled dialogs/menus, while the end-user portal, /console and login
 *   never change. Classic is every rule that existed before, untouched.
 *
 * - Persists the choice in localStorage under DENSITY_KEY. Nothing stored means
 *   **compact** (the product default since 2026-10-14).
 * - The inline DENSITY_SCRIPT (rendered before paint in the root layout) sets
 *   `data-density` on <html>; the script owns that attribute, React never renders
 *   it (same as the `.dark` class), so there is no hydration mismatch and no flash.
 * - The attribute is only a preference. Its effect is scoped to the agent app:
 *   the CSS variables in globals.css and the `compact:` Tailwind variant both
 *   require an ancestor `[data-shell="agent"]` (AgentShell / WorkspaceChrome), so
 *   the end-user portal, /console and login look the same in either density.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type Density = "compact" | "comfortable";
export type UiMode = "classic" | "modern";

export const DENSITY_KEY = "itsm-density";
export const UI_KEY = "itsm-ui";

/** Inline, render-before-paint script that sets the initial density, interface and
 * app attributes on <html>. Keep the route test in step with `AgentShell`. */
export const DENSITY_SCRIPT = `(function(){var r=document.documentElement,d='compact',u='modern';try{if(localStorage.getItem('${DENSITY_KEY}')==='comfortable')d='comfortable';if(localStorage.getItem('${UI_KEY}')==='classic')u='classic'}catch(e){}r.setAttribute('data-density',d);if(u==='modern')r.setAttribute('data-ui','modern');if(/^\\/t\\/[^\\/]+\\/agent(\\/|$)/.test(location.pathname))r.setAttribute('data-app','agent')})();`;

type DensityState = {
  density: Density;
  setDensity: (d: Density) => void;
  ui: UiMode;
  setUi: (u: UiMode) => void;
  /** True when the organisation decides the interface (switching off or Classic
   *  retired): the profile-menu switch is hidden. Set by `InterfaceSync`. */
  uiLocked: boolean;
  setUiLocked: (locked: boolean) => void;
};

const DensityContext = createContext<DensityState | null>(null);

function readAttribute(): Density {
  if (typeof document === "undefined") return "compact";
  return document.documentElement.dataset.density === "comfortable" ? "comfortable" : "compact";
}

function readUi(): UiMode {
  if (typeof document === "undefined") return "modern";
  return document.documentElement.dataset.ui === "modern" ? "modern" : "classic";
}

export function DensityProvider({ children }: { children: React.ReactNode }) {
  // Read what the pre-paint script already applied. Don't re-apply it in a mount
  // effect: that would paint the default for one commit before correcting it.
  const [density, setDensityState] = useState<Density>(readAttribute);

  const setDensity = useCallback((d: Density) => {
    try {
      localStorage.setItem(DENSITY_KEY, d);
    } catch {
      /* ignore (private mode) */
    }
    document.documentElement.setAttribute("data-density", d);
    setDensityState(d);
  }, []);

  const [ui, setUiState] = useState<UiMode>(readUi);
  const [uiLocked, setUiLocked] = useState(false);

  const setUi = useCallback((u: UiMode) => {
    try {
      localStorage.setItem(UI_KEY, u);
    } catch {
      /* ignore (private mode) */
    }
    if (u === "modern") document.documentElement.setAttribute("data-ui", "modern");
    else document.documentElement.removeAttribute("data-ui");
    setUiState(u);
  }, []);

  const value = useMemo(
    () => ({ density, setDensity, ui, setUi, uiLocked, setUiLocked }),
    [density, setDensity, ui, setUi, uiLocked],
  );

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity(): DensityState {
  const ctx = useContext(DensityContext);
  if (!ctx) throw new Error("useDensity must be used within a DensityProvider");
  return ctx;
}

/** Interface preference (classic / modern); same provider, same rules. Read the
 *  interface only through this hook, never from localStorage `itsm-ui` directly. */
export function useUi(): Pick<DensityState, "ui" | "setUi" | "uiLocked" | "setUiLocked"> {
  const { ui, setUi, uiLocked, setUiLocked } = useDensity();
  return { ui, setUi, uiLocked, setUiLocked };
}
