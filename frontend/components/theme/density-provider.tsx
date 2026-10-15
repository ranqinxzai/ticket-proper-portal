"use client";

/**
 * Display density (comfortable / compact), the sibling of the theme provider.
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

export const DENSITY_KEY = "itsm-density";

/** Inline, render-before-paint script that sets the initial density attribute. */
export const DENSITY_SCRIPT = `(function(){var d='compact';try{if(localStorage.getItem('${DENSITY_KEY}')==='comfortable')d='comfortable'}catch(e){}document.documentElement.setAttribute('data-density',d)})();`;

type DensityState = {
  density: Density;
  setDensity: (d: Density) => void;
};

const DensityContext = createContext<DensityState | null>(null);

function readAttribute(): Density {
  if (typeof document === "undefined") return "compact";
  return document.documentElement.dataset.density === "comfortable" ? "comfortable" : "compact";
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

  const value = useMemo(() => ({ density, setDensity }), [density, setDensity]);

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity(): DensityState {
  const ctx = useContext(DensityContext);
  if (!ctx) throw new Error("useDensity must be used within a DensityProvider");
  return ctx;
}
