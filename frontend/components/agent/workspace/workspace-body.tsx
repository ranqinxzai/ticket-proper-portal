"use client";

import Link from "next/link";

import { useWorkspace } from "./workspace-provider";

/** What `<main>` shows inside a helpdesk: a loading line, the not-a-member message,
 *  or the routed page. Shared by the Classic and Modern workspace chromes. */
export function WorkspaceBody({ children }: { children: React.ReactNode }) {
  const { org, helpdesk, loading } = useWorkspace();
  if (loading) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }
  if (!helpdesk) {
    return (
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
    );
  }
  return <>{children}</>;
}
