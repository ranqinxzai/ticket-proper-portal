"use client";

import { useParams } from "next/navigation";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TicketCreateForm } from "@/components/tickets/ticket-create-form";

export default function NewTicketPage() {
  const { projectKey } = useParams<{ projectKey: string }>();
  const { projectByKey, loading } = useWorkspace();
  const project = projectByKey(projectKey);

  if (loading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  if (!project) return <p className="text-sm text-muted-foreground">Project not found.</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`New ${project.name}`}
        description="Fill in the details below, then create the ticket."
      />
      <TicketCreateForm project={project} />
    </div>
  );
}
