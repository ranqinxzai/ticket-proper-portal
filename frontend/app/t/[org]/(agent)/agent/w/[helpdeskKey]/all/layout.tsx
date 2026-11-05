"use client";

import { useSelectedLayoutSegment } from "next/navigation";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { useUi } from "@/components/theme/density-provider";
import { CombinedTicketQueue } from "@/components/tickets/ticket-queue";
import { ModernWorkbench } from "@/components/tickets/workbench/modern-workbench";
import { useMediaQuery } from "@/lib/itsm/use-media-query";

/**
 * All Tickets. Modern on lg+ (step B4, 2026-11-05): the combined queue lives here in
 * the workbench, and `/all/NUMBER` docks that ticket beside it (`page.tsx` is then not
 * rendered). Classic and narrow screens render the pages as before.
 */
export default function AllTicketsLayout({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const { org, helpdeskKey, projects, loading } = useWorkspace();
  const { ui } = useUi();
  const desktop = useMediaQuery("(min-width: 1024px)");

  if (ui === "modern" && desktop && !loading && projects.length > 0) {
    return (
      <ModernWorkbench
        kind="combined"
        queuePath={`/t/${org}/agent/w/${helpdeskKey}/all`}
        currentNumber={segment ? decodeURIComponent(segment) : null}
        queue={<CombinedTicketQueue />}
      >
        {segment ? children : null}
      </ModernWorkbench>
    );
  }
  return <>{children}</>;
}
