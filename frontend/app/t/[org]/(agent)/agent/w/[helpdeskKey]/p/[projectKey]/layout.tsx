"use client";

import { useParams, useSelectedLayoutSegment } from "next/navigation";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { useUi } from "@/components/theme/density-provider";
import { TicketQueue } from "@/components/tickets/ticket-queue";
import { ModernWorkbench } from "@/components/tickets/workbench/modern-workbench";
import { useMediaQuery } from "@/lib/itsm/use-media-query";

/**
 * Per-user project access guard. The workspace project list is scoped server-side
 * (strict whitelist), so a project the user isn't assigned to never appears in
 * `projectByKey`. This blocks direct-URL access to its queue / new / detail pages
 * (the backend is the real authz boundary; this is the UX so a hidden tab can't be
 * reached by typing the URL). Covers `page`, `new`, and `[ticketId]` uniformly.
 *
 * Modern on lg+ (step B4, 2026-11-05): the queue lives HERE, in a workbench that keeps
 * it mounted while tickets open beside it (`/p/KEY` = queue only, `/p/KEY/NUMBER` =
 * queue + docked ticket). `page.tsx` is then not rendered; `/new` keeps its full page.
 */
export default function ProjectAccessGuardLayout({ children }: { children: React.ReactNode }) {
  const { projectKey } = useParams<{ projectKey: string }>();
  const segment = useSelectedLayoutSegment();
  const { org, helpdeskKey, projectByKey, loading } = useWorkspace();
  const { ui } = useUi();
  const desktop = useMediaQuery("(min-width: 1024px)");

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const project = projectByKey(projectKey);
  if (!project) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        You don&apos;t have access to this project, or it doesn&apos;t exist.
      </div>
    );
  }
  if (ui === "modern" && desktop && segment !== "new") {
    return (
      <ModernWorkbench
        kind="project"
        queuePath={`/t/${org}/agent/w/${helpdeskKey}/p/${project.key}`}
        currentNumber={segment ? decodeURIComponent(segment) : null}
        queue={<TicketQueue key={project.key} project={project} />}
      >
        {segment ? children : null}
      </ModernWorkbench>
    );
  }
  return <>{children}</>;
}
