"use client";

import Link from "next/link";

import { useWorkspace } from "./workspace-provider";
import { WorkspaceHeader } from "./workspace-header";

/** Inside a helpdesk: the consolidated sticky header + the routed page body.
 * The header always renders (so the app-switcher/profile stay reachable) even
 * while loading or when the helpdesk is missing. */
export function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  const { org, helpdesk, loading } = useWorkspace();

  return (
    <div className="min-h-screen bg-background">
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
            <Link href={`/t/${org}/agent`} className="mt-2 inline-block text-sm text-primary hover:underline">
              Back to workspaces
            </Link>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
