"use client";

import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { useWorkspace } from "./workspace-provider";
import { projectIconName, projectLabel } from "./project-display";

/** "Create" button: pick a project, open its new-ticket form. */
export function CreateMenu() {
  const { org, helpdeskKey, projects } = useWorkspace();
  const base = `/t/${org}/agent/w/${helpdeskKey}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={projects.length === 0}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create
        <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>New ticket</DropdownMenuLabel>
        {projects.map((p) => (
          <DropdownMenuItem key={p.id} asChild>
            <Link href={`${base}/p/${p.key}/new`}>
              <ItsmIcon name={projectIconName(p)} className="h-4 w-4" />
              {projectLabel(p)}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
