"use client";

import Link from "next/link";

import { useWorkspace } from "./workspace-provider";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceNav } from "./workspace-nav";

/** Inside a helpdesk: a persistent left sidebar (desktop) + a slim top bar and
 * the routed page body. The chrome always renders (so navigation/profile stay
 * reachable) even while loading or when the helpdesk is missing. */
export function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  const { org, helpdesk, loading } = useWorkspace();

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r bg-card p-4 lg:flex">
          <WorkspaceNav />
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <WorkspaceHeader />
          <main id="main-content" className="w-full px-3 py-6 sm:px-6 lg:px-8">
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
