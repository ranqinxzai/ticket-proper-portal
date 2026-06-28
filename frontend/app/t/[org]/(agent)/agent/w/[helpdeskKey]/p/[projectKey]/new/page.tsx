"use client";

import { useParams, useRouter } from "next/navigation";
import { X } from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { Button } from "@/components/ui/button";
import { TicketCreateForm } from "@/components/tickets/ticket-create-form";

export default function NewTicketPage() {
  const router = useRouter();
  const { projectKey } = useParams<{ projectKey: string }>();
  const { projectByKey, loading } = useWorkspace();
  const project = projectByKey(projectKey);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!project) return <p className="text-sm text-muted-foreground">Project not found.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-base font-semibold">New {project.name} ticket</h2>
        <Button type="button" variant="outline" size="sm" onClick={() => router.back()}>
          <X className="h-4 w-4" aria-hidden="true" />
          Cancel
        </Button>
      </div>
      <TicketCreateForm project={project} />
    </div>
  );
}
