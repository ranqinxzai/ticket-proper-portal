"use client";

import Link from "next/link";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { useWorkspace } from "./workspace-provider";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceNav } from "./workspace-nav";

const COLLAPSE_KEY = "itsm-sidebar-collapsed";

/** Inside a helpdesk: a persistent left sidebar (collapsible to an icon rail on
 * desktop) + a slim top bar and the routed page body. The chrome always renders
 * (so navigation/profile stay reachable) even while loading or missing. */
export function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  const { org, helpdesk, loading } = useWorkspace();
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
        {/* Desktop sidebar — collapsible to an icon rail. */}
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r bg-card transition-[width] duration-200 lg:flex",
            collapsed ? "w-16 px-2 py-4 compact:py-3" : "w-sidebar p-4 compact:p-3",
          )}
        >
          <WorkspaceNav collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <WorkspaceHeader />
          {/* Gutters come from --main-px / --main-py (density-aware). Pages that
              cancel them (queue bands, create-form footer) use the same tokens. */}
          <main id="main-content" className="w-full px-main-x py-main-y">
            {loading ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Loading workspace…
              </div>
            ) : !helpdesk ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  This workspace doesn’t exist or you’re not a member of it.
                </p>
                <Link
                  href={`/t/${org}/agent`}
                  className="mt-2 inline-block text-sm text-primary hover:underline"
                >
                  Back to workspaces
                </Link>
              </div>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
