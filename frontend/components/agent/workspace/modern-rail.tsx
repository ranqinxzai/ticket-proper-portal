"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LifeBuoy, Pin, PinOff } from "lucide-react";

import { useBranding } from "@/components/shell/company-brand";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";

/**
 * Modern interface main menu (2026-11-05, step B2): a 56px icon rail that opens to a
 * 240px labelled menu on hover (140 ms in / 220 ms out) or keyboard focus, as an
 * overlay that never pushes the page. Picking an item folds it back. "Pin menu open"
 * keeps it open in the page flow (the content narrows), remembered per device.
 *
 * Every item renders ONE link in both states: the label is `sr-only` while folded, so
 * the accessible name never changes and nothing is duplicated in the DOM. Sub-items
 * (projects, asset pages) stay mounted and are `hidden` while folded, so their data
 * (the asset category tree) loads once, not on every hover.
 *
 * While a menu that lives in the rail is open (account menu, helpdesk switcher) the
 * rail is HELD open (`hold`, 2026-11-05c). Those menus are modal Radix menus: they set
 * `pointer-events: none` on <body>, so moving onto the menu fired `pointerleave` on the
 * rail, the rail folded, the trigger shrank, the menu jumped under the cursor and the
 * portal's React events expanded the rail again — it flickered open/closed. Keyboard
 * focus still opens the rail, but only `:focus-visible` focus: Radix returning focus to
 * the trigger after a mouse pick, or focusing items under a moving pointer, does not.
 *
 * All components are module-level (React focus-stability rule).
 */

export const RAIL_PIN_KEY = "itsm-rail-pinned";

type RailState = {
  pinned: boolean;
  expanded: boolean;
  bind: React.HTMLAttributes<HTMLDivElement>;
  /** The panel element (to check `:hover` when a held menu closes). */
  panelRef: React.RefObject<HTMLDivElement>;
  collapse: () => void;
  togglePin: () => void;
  /** Keep the rail open while a menu inside it is open (pass the menu's onOpenChange). */
  hold: (open: boolean) => void;
};

/** Keyboard focus (not a programmatic focus after a mouse pick). */
function isKeyboardFocus(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  try {
    return el.matches(":focus-visible");
  } catch {
    return true; // a browser without :focus-visible keeps the old behaviour
  }
}

export function useRailState(): RailState {
  // Lazy read: the agent chrome never server-renders (AgentGuard), so no flash.
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem(RAIL_PIN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [hovered, setHovered] = useState(false);
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const arm = (open: boolean, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHovered(open), ms);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const hold = useCallback((open: boolean) => {
    heldRef.current = open;
    setHeld(open);
    window.clearTimeout(timer.current);
    if (open) return;
    // The menu closed: stay open only while the pointer is over the rail or keyboard
    // focus is inside it (Esc returns focus to the trigger); otherwise fold.
    timer.current = window.setTimeout(() => {
      const el = panelRef.current;
      const active = document.activeElement;
      const inside = !!el && (el.matches(":hover") || (el.contains(active) && isKeyboardFocus(active)));
      setHovered(inside);
    }, 220);
  }, []);

  const bind: React.HTMLAttributes<HTMLDivElement> = pinned
    ? {}
    : {
        onPointerEnter: (e) => {
          if (e.pointerType !== "touch") arm(true, 140);
        },
        onPointerLeave: () => arm(false, 220),
        onFocus: (e) => {
          if (!isKeyboardFocus(e.target)) return;
          window.clearTimeout(timer.current);
          setHovered(true);
        },
        onBlur: (e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            window.clearTimeout(timer.current);
            setHovered(false);
          }
        },
        onKeyDown: (e) => {
          // Esc inside an open rail menu closes that menu (Radix), not the rail.
          if (e.key === "Escape" && !heldRef.current) {
            setHovered(false);
            (document.activeElement as HTMLElement | null)?.blur();
          }
        },
      };

  const collapse = () => {
    window.clearTimeout(timer.current);
    setHovered(false);
  };
  const togglePin = () =>
    setPinned((p) => {
      const next = !p;
      try {
        localStorage.setItem(RAIL_PIN_KEY, next ? "1" : "0");
      } catch {
        /* ignore storage errors */
      }
      return next;
    });

  return { pinned, expanded: pinned || hovered || held, bind, panelRef, collapse, togglePin, hold };
}

type RailCtx = { expanded: boolean; pinned: boolean; collapse: () => void; hold: (open: boolean) => void };
const RailContext = createContext<RailCtx>({
  expanded: true,
  pinned: true,
  collapse: () => undefined,
  hold: () => undefined,
});
export const useRail = () => useContext(RailContext);

/** The rail itself: an in-flow placeholder (56px, or 240px when pinned) holding an
 *  absolutely positioned panel that widens over the page while expanded. */
export function Rail({
  state,
  label,
  top,
  footer,
  children,
}: {
  state: RailState;
  /** Accessible name of the item list, e.g. "Workspace". */
  label: string;
  top?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <RailContext.Provider
      value={{ expanded: state.expanded, pinned: state.pinned, collapse: state.collapse, hold: state.hold }}
    >
      <aside
        aria-label="Main menu"
        className={cn(
          "sticky top-0 z-[45] hidden h-screen shrink-0 print:hidden lg:block",
          state.pinned ? "w-sidebar" : "w-nav-rail",
        )}
      >
        <div
          {...state.bind}
          ref={state.panelRef}
          data-expanded={state.expanded ? "" : undefined}
          className={cn(
            "absolute inset-y-0 left-0 flex flex-col overflow-hidden border-r bg-card px-2 py-2",
            "transition-[width,box-shadow] duration-150 ease-out motion-reduce:transition-none",
            state.expanded ? "w-sidebar" : "w-nav-rail",
            state.expanded && !state.pinned && "shadow-soft-lg",
          )}
        >
          {top}
          <nav aria-label={label} className="-mx-2 mt-1 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1">
            <ul className="flex flex-col gap-0.5">{children}</ul>
          </nav>
          <div className="-mx-2 mt-1 flex flex-col gap-0.5 border-t px-2 pt-1">{footer}</div>
        </div>
      </aside>
    </RailContext.Provider>
  );
}

const itemCls =
  "relative flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm text-muted-foreground transition-colors " +
  "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
  "aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-accent-foreground " +
  // 3px brand marker on the panel's left edge for the current page.
  "before:absolute before:-left-2 before:top-2 before:h-5 before:w-[3px] before:rounded-r-full before:bg-primary before:opacity-0 " +
  "aria-[current=page]:before:opacity-100";

/** One menu entry: icon always, label + shortcut when expanded, tooltip when folded. */
export function RailItem({
  href,
  label,
  icon,
  active,
  shortcut,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  /** Shown as a hint, e.g. "G D". */
  shortcut?: string;
  /** A small count bubble (pending approvals). */
  badge?: number;
}) {
  const { expanded, collapse } = useRail();
  const tip = shortcut ? `${label}\n${shortcut.replace(" ", " then ")}` : label;
  return (
    <li>
      <Hint label={tip} side="right" disabled={expanded}>
        <Link href={href} aria-current={active ? "page" : undefined} onClick={collapse} className={itemCls}>
          <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
            {icon}
          </span>
          <span className={cn("min-w-0 flex-1 truncate", !expanded && "sr-only")}>{label}</span>
          {badge ? (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground",
                  expanded ? "ml-auto" : "absolute left-6 top-1",
                )}
              >
                {badge > 9 ? "9+" : badge}
              </span>
              <span className="sr-only">, {badge} pending</span>
            </>
          ) : null}
          {expanded && shortcut && !badge ? (
            <kbd aria-hidden="true" className="ml-auto font-mono text-[10px] font-normal text-muted-foreground">
              {shortcut}
            </kbd>
          ) : null}
        </Link>
      </Hint>
    </li>
  );
}

/** Indented child links (projects under Tickets, asset pages under Assets). Mounted
 *  always, hidden while the rail is folded. */
export function RailSub({ children }: { children: React.ReactNode }) {
  const { expanded } = useRail();
  return (
    <li hidden={!expanded}>
      <ul className="ml-[18px] flex flex-col gap-px border-l py-0.5 pl-2">{children}</ul>
    </li>
  );
}

export function RailSubItem({
  href,
  label,
  active,
  trailing,
}: {
  href: string;
  label: string;
  active: boolean;
  trailing?: React.ReactNode;
}) {
  const { collapse } = useRail();
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        onClick={collapse}
        className="flex h-7 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-[current=page]:font-medium aria-[current=page]:text-foreground"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
      </Link>
    </li>
  );
}

/** A small uppercase group label; a hairline while folded. */
export function RailSection({ children }: { children: React.ReactNode }) {
  const { expanded } = useRail();
  return (
    <li aria-hidden={!expanded || undefined} className="px-3 pb-0.5 pt-3">
      {expanded ? (
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{children}</span>
      ) : (
        <span className="block h-px w-full bg-border" />
      )}
    </li>
  );
}

/** "Pin menu open" / "Unpin menu" — an icon-only button (2026-11-05c) in the same
 *  spot folded and open: 40px wide, so its icon sits on the column of the item icons. */
export function RailPinButton({ state }: { state: RailState }) {
  const label = state.pinned ? "Unpin menu" : "Pin menu open";
  const help = state.pinned
    ? "Unpin menu: back to the icon rail that opens when you hover it"
    : "Pin menu open: keep the menu open beside the page — remembered on this device";
  return (
    <Hint label={help} side="right">
      <button
        type="button"
        onClick={state.togglePin}
        aria-pressed={state.pinned}
        aria-label={label}
        className={cn(
          "flex h-8 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
          "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          state.pinned && "text-foreground",
        )}
      >
        {state.pinned ? <PinOff className="h-4 w-4" aria-hidden="true" /> : <Pin className="h-4 w-4" aria-hidden="true" />}
      </button>
    </Hint>
  );
}

/** The organisation's logo at the top of the menu (2026-11-05c; it used to sit in the
 *  centre of the top bar). Open or pinned: the whole logo. Folded: the 40px box shows the
 *  logo's left end — for a mark + wordmark logo (GridCrest) that is the mark. No logo →
 *  the company name (hidden while folded, the row keeps its height); no branding at all
 *  → the OneDesk mark. `trailing` sits on the right while open (the helpdesk switcher). */
export function RailBrand({ trailing }: { trailing?: React.ReactNode }) {
  const branding = useBranding();
  const { expanded } = useRail();
  const name = branding?.client_name?.trim() || "";
  const logo = branding?.logo_url || "";
  let mark: React.ReactNode = null;
  if (logo) {
    mark = (
      <span className={cn("block h-8 shrink-0 overflow-hidden", expanded ? "min-w-0 max-w-full" : "w-10")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded asset */}
        <img
          src={logo}
          alt={name || "Company logo"}
          className={cn("h-8 w-auto object-left", expanded ? "max-w-full object-contain" : "max-w-none")}
        />
      </span>
    );
  } else if (name) {
    mark = (
      <span
        className={cn("min-w-0 truncate px-1 text-sm font-semibold tracking-tight text-foreground", !expanded && "opacity-0")}
        title={name}
      >
        {name}
      </span>
    );
  } else if (branding) {
    mark = (
      <span className="flex min-w-0 items-center gap-2 px-1.5">
        <span
          aria-hidden="true"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground"
        >
          <LifeBuoy className="h-4 w-4" />
        </span>
        <span className={cn("truncate text-sm font-semibold tracking-tight", !expanded && "sr-only")}>OneDesk</span>
      </span>
    );
  }
  return (
    <div className="flex h-10 items-center gap-2" data-rail-brand="">
      <div className="flex min-w-0 flex-1 items-center">{mark}</div>
      {trailing ? <div className={cn("shrink-0", !expanded && "hidden")}>{trailing}</div> : null}
    </div>
  );
}

/** "← Back to …" at the top of a section menu. */
export function RailBack({ href, label }: { href: string; label: string }) {
  return <RailItem href={href} label={label} icon={<ArrowLeft className="h-4 w-4" />} active={false} />;
}
