"use client";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { CombinedTicketQueue } from "@/components/tickets/ticket-queue";

/** The combined "All Tickets" queue — every project the agent can access in this
 *  helpdesk, in one place (no per-project tab switching). */
export default function AllTicketsPage() {
  const { projects, loading } = useWorkspace();

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (projects.length === 0)
    return <p className="text-sm text-muted-foreground">No projects in this workspace yet.</p>;

  return <CombinedTicketQueue />;
}
