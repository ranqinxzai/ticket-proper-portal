"use client";

import { useParams } from "next/navigation";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";

/**
 * Per-user project access guard. The workspace project list is scoped server-side
 * (strict whitelist), so a project the user isn't assigned to never appears in
 * `projectByKey`. This blocks direct-URL access to its queue / new / detail pages
 * (the backend is the real authz boundary; this is the UX so a hidden tab can't be
 * reached by typing the URL). Covers `page`, `new`, and `[ticketId]` uniformly.
 */
export default function ProjectAccessGuardLayout({ children }: { children: React.ReactNode }) {
  const { projectKey } = useParams<{ projectKey: string }>();
  const { projectByKey, loading } = useWorkspace();

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!projectByKey(projectKey)) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        You don&apos;t have access to this project, or it doesn&apos;t exist.
      </div>
    );
  }
  return <>{children}</>;
}
