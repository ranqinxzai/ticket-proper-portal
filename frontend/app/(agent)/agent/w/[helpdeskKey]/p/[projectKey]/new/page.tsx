"use client";

import { useParams } from "next/navigation";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { TicketCreateForm } from "@/components/tickets/ticket-create-form";

export default function NewTicketPage() {
  const { projectKey } = useParams<{ projectKey: string }>();
  const { projectByKey, loading } = useWorkspace();
  const project = projectByKey(projectKey);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!project) return <p className="text-sm text-muted-foreground">Project not found.</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">New {project.name} ticket</h2>
      <TicketCreateForm project={project} />
    </div>
  );
}
