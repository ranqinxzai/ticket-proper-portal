"use client";

import { useParams } from "next/navigation";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { TicketQueue } from "@/components/tickets/ticket-queue";

export default function ProjectQueuePage() {
  const { projectKey } = useParams<{ projectKey: string }>();
  const { projectByKey, loading } = useWorkspace();
  const project = projectByKey(projectKey);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!project) return <p className="text-sm text-muted-foreground">Project not found.</p>;

  return <TicketQueue key={project.key} project={project} />;
}
