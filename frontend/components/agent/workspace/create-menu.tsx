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
import { Hint } from "@/components/ui/hint";
import { useItsmAuth } from "@/lib/itsm/auth";
import { NO_CREATE_TICKET_PERMISSION } from "@/lib/itsm/help/queue";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { useWorkspace } from "./workspace-provider";
import { projectIconName, projectLabel } from "./project-display";

/** "Create" button: pick a project, open its new-ticket form. */
export function CreateMenu() {
  const { org, helpdeskKey, projects, loading } = useWorkspace();
  // Agent ticket create is gated on `itsm.tickets.create` (enforced 2026-10-18).
  const canCreate = useItsmAuth().hasPerm("itsm.tickets.create", "create");
  const base = `/t/${org}/agent/w/${helpdeskKey}`;

  return (
    <DropdownMenu>
      <Hint
        side="bottom"
        label={
          !canCreate
            ? NO_CREATE_TICKET_PERMISSION
            : projects.length === 0
            ? loading
              ? "Loading projects…"
              : "This helpdesk has no projects yet"
            : "Raise a new ticket — pick the project first"
        }
      >
      <DropdownMenuTrigger
        disabled={!canCreate || projects.length === 0}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create
        <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
      </DropdownMenuTrigger>
      </Hint>
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
