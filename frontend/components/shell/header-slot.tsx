"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Header slot (Modern step B2): in the Modern interface on desktop, a page's
 * `PageHeader` renders its title and actions INTO the top bar (one bar, like Jira and
 * Linear) instead of a 70–80px band at the top of the page. The top bar mounts two
 * outlet elements; `PageHeader` portals into them (`createPortal`), which keeps the
 * page's React tree — state, context, events — intact.
 *
 * Provided once by the agent layout. `useHeaderSlot()` is null outside it (portal,
 * console, login), where `PageHeader` always renders inline.
 */
type Slot = {
  titleEl: HTMLElement | null;
  actionsEl: HTMLElement | null;
  /** The teleported title as plain text (when it is a string) — the breadcrumb drops
   *  its last node when it repeats the title. */
  titleText: string | null;
  hasTitle: boolean;
  setTitleEl: (el: HTMLElement | null) => void;
  setActionsEl: (el: HTMLElement | null) => void;
  setTitle: (has: boolean, text: string | null) => void;
};

const HeaderSlotContext = createContext<Slot | null>(null);

export function HeaderSlotProvider({ children }: { children: React.ReactNode }) {
  // setState setters are stable, so they double as callback refs for the outlets.
  const [titleEl, setTitleEl] = useState<HTMLElement | null>(null);
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null);
  const [title, setTitleState] = useState<{ has: boolean; text: string | null }>({ has: false, text: null });
  // Must keep ONE identity for the provider's lifetime: PageHeader's effect depends on it,
  // and a new function per title change re-ran that effect (clean up → set → re-render)
  // forever — React error #185 on every page with a description (2026-11-05).
  const setTitle = useCallback(
    (has: boolean, text: string | null) =>
      setTitleState((cur) => (cur.has === has && cur.text === text ? cur : { has, text })),
    [],
  );
  const value = useMemo<Slot>(
    () => ({
      titleEl,
      actionsEl,
      hasTitle: title.has,
      titleText: title.text,
      setTitleEl,
      setActionsEl,
      setTitle,
    }),
    [titleEl, actionsEl, title, setTitle],
  );
  return <HeaderSlotContext.Provider value={value}>{children}</HeaderSlotContext.Provider>;
}

export function useHeaderSlot(): Slot | null {
  return useContext(HeaderSlotContext);
}

/** Where a page's title lands in the Modern top bar. */
export function HeaderTitleOutlet({ className }: { className?: string }) {
  const slot = useHeaderSlot();
  return <div ref={slot?.setTitleEl} className={className} />;
}

/** Where a page's header actions land in the Modern top bar. */
export function HeaderActionsOutlet({ className }: { className?: string }) {
  const slot = useHeaderSlot();
  return <div ref={slot?.setActionsEl} className={className} />;
}
