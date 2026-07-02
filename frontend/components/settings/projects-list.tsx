"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, FolderKanban, Plus } from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import type { Project } from "@/lib/itsm/types";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";

import { ProjectCreateDialog } from "./project-create-dialog";

const TYPE_LABELS: Record<string, string> = {
  incident: "Incident",
  service_request: "Request",
  custom: "Custom",
};

export function ProjectsList({ canCreate }: { canCreate: boolean }) {
  const { org, helpdeskKey, allProjects } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button className="gap-1" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Create custom project
          </Button>
        </div>
      ) : null}

      {allProjects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Projects hold the fields, workflow, layout and approvals for a type of ticket. Create one to get started."
          action={
            canCreate ? (
              <Button className="gap-1" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Create custom project
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {allProjects.map((p) => (
            <ProjectCard key={p.id} project={p} base={`/t/${org}/agent/w/${helpdeskKey}/settings/projects`} />
          ))}
        </div>
      )}

      <ProjectCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function ProjectCard({ project, base }: { project: Project; base: string }) {
  const inactive = project.status !== "active";
  return (
    <Link
      href={`${base}/${project.key}`}
      className="group flex items-start gap-3 rounded-xl border bg-card p-4 shadow-soft transition-colors hover:border-primary/40 hover:bg-accent/30"
    >
      <span
        aria-hidden="true"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
        style={{ backgroundColor: project.color || "#6366f1", color: readableOn(project.color) }}
      >
        <ItsmIcon name={project.icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{project.name}</h3>
          <span className="font-mono text-xs text-muted-foreground">{project.key}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {TYPE_LABELS[project.project_type] ?? project.project_type}
          </span>
          {inactive ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {project.status}
            </span>
          ) : null}
          {typeof project.open_ticket_count === "number" ? (
            <span className="text-xs text-muted-foreground">{project.open_ticket_count} open</span>
          ) : null}
        </div>
      </div>
      <ChevronRight
        className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}
