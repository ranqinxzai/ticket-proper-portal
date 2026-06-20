"use client";

import Link from "next/link";

import { useWorkspace } from "./workspace-provider";
import { WorkspaceTabs } from "./workspace-tabs";

export function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  const { helpdesk } = useWorkspace();

  if (!helpdesk) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          This workspace doesn’t exist or you’re not a member of it.
        </p>
        <Link href="/agent" className="mt-2 inline-block text-sm text-primary hover:underline">
          Back to workspaces
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold text-white"
          style={{ backgroundColor: helpdesk.color || "#6366f1" }}
        >
          {helpdesk.key}
        </span>
        <h1 className="text-lg font-semibold tracking-tight">{helpdesk.name}</h1>
        <Link
          href="/agent"
          className="ml-auto rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Switch workspace
        </Link>
      </div>
      <div className="border-b">
        <WorkspaceTabs />
      </div>
      <div>{children}</div>
    </div>
  );
}
