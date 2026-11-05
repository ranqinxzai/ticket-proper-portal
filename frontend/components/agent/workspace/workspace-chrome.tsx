"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsLeftRight } from "lucide-react";

import { useUi } from "@/components/theme/density-provider";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { WorkspaceBody } from "./workspace-body";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceNav } from "./workspace-nav";
import { ModernWorkspaceChrome } from "./modern-workspace-chrome";

const COLLAPSE_KEY = "itsm-sidebar-collapsed";
// The agent's dragged sidebar width (px). Absent = the density default (--sidebar-w).
const WIDTH_KEY = "itsm-sidebar-width";
const MIN_W = 192;
const MAX_W = 420;
const KEY_STEP = 16;
const clampWidth = (w: number) => Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));

function saveWidth(w: number | null) {
  try {
    if (w === null) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(w));
  } catch {
    /* ignore storage errors */
  }
}

/** Inside a helpdesk: a persistent left sidebar (collapsible to an icon rail on
 * desktop) + a slim top bar and the routed page body. The chrome always renders
 * (so navigation/profile stay reachable) even while loading or missing. */
export function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  // Modern interface (2026-11-05, step B2): icon rail + 44px top bar. Classic keeps
  // the chrome below exactly as it was (its sidebar collapse / width prefs too).
  const { ui } = useUi();
  if (ui === "modern") return <ModernWorkspaceChrome>{children}</ModernWorkspaceChrome>;
  return <ClassicWorkspaceChrome>{children}</ClassicWorkspaceChrome>;
}

function ClassicWorkspaceChrome({ children }: { children: React.ReactNode }) {
  // Read the collapsed preference on first render (no expanded-then-collapsed
  // flash). Safe without a hydration guard: AgentGuard renders "Loading…" until the
  // user is known, so this chrome never server-renders.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [width, setWidth] = useState<number | null>(() => {
    try {
      const n = Number(localStorage.getItem(WIDTH_KEY));
      return n > 0 ? clampWidth(n) : null;
    } catch {
      return null;
    }
  });
  const [dragging, setDragging] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  // The rendered width, for the separator's required aria-valuenow while the width
  // is still the density default (no stored px). Re-measured on density switches.
  const [defaultW, setDefaultW] = useState(MIN_W);
  useEffect(() => {
    const el = asideRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setDefaultW(clampWidth(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drag the handle on the sidebar's right edge to resize it; the width is kept
  // per browser. Double-click (or Enter) resets to the density default.
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !asideRef.current) return;
    e.preventDefault();
    const left = asideRef.current.getBoundingClientRect().left;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    const prev = { cursor: document.body.style.cursor, select: document.body.style.userSelect };
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    let last = width;
    const onMove = (ev: PointerEvent) => {
      last = clampWidth(ev.clientX - left);
      setWidth(last);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = prev.cursor;
      document.body.style.userSelect = prev.select;
      setDragging(false);
      if (last !== null) saveWidth(last);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const resetWidth = () => {
    setWidth(null);
    saveWidth(null);
  };

  const onResizeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      resetWidth();
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const current = width ?? asideRef.current?.getBoundingClientRect().width ?? MIN_W;
    const next = clampWidth(current + (e.key === "ArrowRight" ? KEY_STEP : -KEY_STEP));
    setWidth(next);
    saveWidth(next);
  };

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore storage errors */
      }
      return next;
    });

  return (
    // data-shell="agent" scopes the density variables + `compact:` variant (globals.css).
    <div data-shell="agent" className="min-h-screen bg-muted/30">
      <div className="flex">
        {/* Desktop sidebar — collapsible to an icon rail, resizable when expanded
            (an inline --sidebar-w overrides both density defaults). */}
        <aside
          ref={asideRef}
          style={
            !collapsed && width !== null
              ? ({ "--sidebar-w": `${width}px` } as React.CSSProperties)
              : undefined
          }
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r bg-card lg:flex",
            !dragging && "transition-[width] duration-200",
            collapsed ? "w-16 px-2 py-4 compact:py-3" : "w-sidebar p-4 compact:p-3",
          )}
        >
          <WorkspaceNav collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
        </aside>
        {/* Resize handle — a sibling, not a child: the aside scrolls, so an absolute
            child would scroll away with the nav. Overlaps the aside's border. */}
        {!collapsed && (
          <Hint label="Drag to resize · double-click to reset" side="right">
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize navigation"
              aria-valuemin={MIN_W}
              aria-valuemax={MAX_W}
              aria-valuenow={width ?? defaultW}
              tabIndex={0}
              onPointerDown={onResizeStart}
              onDoubleClick={resetWidth}
              onKeyDown={onResizeKey}
              className="group sticky top-0 z-30 -ml-1.5 hidden h-screen w-1.5 shrink-0 cursor-ew-resize focus-visible:outline-none lg:block"
            >
              {/* A 2px brand line on the border plus a small round ↔ grip, shown on
                  hover / keyboard focus / drag (the 6px strip stays the hit area). */}
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary",
                  dragging && "bg-primary",
                )}
              />
              <span
                aria-hidden="true"
                className={cn(
                  // `invisible` (not just transparent) so the hidden grip never catches clicks
                  // meant for the page; once shown it is part of the drag target.
                  "invisible absolute left-1/2 top-1/2 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-primary/40 bg-card text-primary-ink opacity-0 shadow-sm transition-[opacity,visibility] group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100",
                  dragging && "visible opacity-100",
                )}
              >
                <ChevronsLeftRight className="h-3 w-3" />
              </span>
            </div>
          </Hint>
        )}

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <WorkspaceHeader />
          {/* Gutters come from --main-px / --main-py (density-aware). Pages that
              cancel them (queue bands, create-form footer) use the same tokens. */}
          <main id="main-content" className="w-full px-main-x py-main-y">
            <WorkspaceBody>{children}</WorkspaceBody>
          </main>
        </div>
      </div>
    </div>
  );
}
