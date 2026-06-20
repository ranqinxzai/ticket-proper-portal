"use client";

import Link from "next/link";
import { LifeBuoy } from "lucide-react";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { UserMenu } from "./user-menu";

/** Chrome for the agent application: top banner + main landmark. Per-workspace
 * tab navigation is mounted by the workspace layout (P1). */
export function AgentShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header
        role="banner"
        className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
      >
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
          <Link
            href="/agent"
            className="flex items-center gap-2 rounded-md font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground"
            >
              <LifeBuoy className="h-4 w-4" />
            </span>
            <span>ServiceDesk</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Agent
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
