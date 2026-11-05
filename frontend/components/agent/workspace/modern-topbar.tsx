"use client";

import { Search } from "lucide-react";

import { HeaderActionsOutlet, HeaderTitleOutlet } from "@/components/shell/header-slot";
import { useShortcuts } from "@/components/shell/shortcuts-host";
import { Hint } from "@/components/ui/hint";

/**
 * Modern top bar (2026-11-05, step B2): 44px (`--header-h`), one bar for the whole
 * page — breadcrumb › page title (teleported by PageHeader) on the left, page actions +
 * ⌘K search + the app's own controls on the right. The company logo moved to the top
 * of the menu (`RailBrand`, 2026-11-05c); it used to sit in the centre of this bar.
 */
export function ModernTopBar({
  leading,
  crumbs,
  right,
}: {
  /** Shown before the breadcrumb: the mobile menu trigger / app switcher. */
  leading?: React.ReactNode;
  crumbs?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header
      role="banner"
      className="sticky top-0 z-40 h-header border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 print:hidden"
    >
      <div className="relative flex h-full items-center gap-2 px-main-x sm:gap-3">
        {leading}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {crumbs}
          <HeaderTitleOutlet className="hidden min-w-0 items-center gap-1.5 lg:flex" />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <HeaderActionsOutlet className="hidden items-center gap-2 lg:flex" />
          <SearchButton />
          {right}
        </div>
      </div>
    </header>
  );
}

function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** "Search ⌘K" — opens the command palette (tickets, go to, actions). */
export function SearchButton() {
  const shortcuts = useShortcuts();
  if (!shortcuts) return null;
  const combo = isMac() ? "⌘K" : "Ctrl K";
  return (
    <Hint label={`Search tickets or jump anywhere (${isMac() ? "⌘K" : "Ctrl+K"})`} side="bottom">
      <button
        type="button"
        onClick={shortcuts.openPalette}
        className="flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:border-ring/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:w-56"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden flex-1 text-left md:inline">Search…</span>
        <span className="sr-only md:hidden">Search</span>
        <kbd aria-hidden="true" className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] leading-4 md:inline">
          {combo}
        </kbd>
      </button>
    </Hint>
  );
}
