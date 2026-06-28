"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Home, LayoutGrid } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { readableOn } from "@/lib/itsm/colors";
import { useItsmAuth } from "@/lib/itsm/auth";
import { cn } from "@/lib/utils";

/** Provider-independent control: jump Home or switch into a helpdesk workspace.
 *  Works on any agent route (Home, KB, Tenant Settings, inside a workspace) — it
 *  reads org + the caller's helpdesks from auth, and highlights the active
 *  helpdesk from the URL `[helpdeskKey]` segment (present on /agent/w + /agent/kb). */
export function AppSwitcher() {
  const { user, org } = useItsmAuth();
  const { helpdeskKey } = useParams<{ helpdeskKey?: string }>();
  const helpdesks = user?.helpdesks ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch helpdesk"
        className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LayoutGrid className="h-5 w-5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem asChild>
          <Link href={`/t/${org}/agent`}>
            <Home className="h-4 w-4" aria-hidden="true" />
            Home
          </Link>
        </DropdownMenuItem>
        {helpdesks.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Helpdesks</DropdownMenuLabel>
            {helpdesks.map((hd) => (
              <DropdownMenuItem key={hd.id} asChild>
                <Link
                  href={`/t/${org}/agent/w/${hd.key}`}
                  aria-current={hd.key === helpdeskKey ? "page" : undefined}
                >
                  <span
                    aria-hidden="true"
                    className="grid h-5 w-5 shrink-0 place-items-center rounded"
                    style={{ backgroundColor: hd.color || "#6366f1", color: readableOn(hd.color) }}
                  >
                    <ItsmIcon name={hd.icon} className="h-3 w-3" />
                  </span>
                  <span className={cn("truncate", hd.key === helpdeskKey && "font-semibold")}>
                    {hd.name}
                  </span>
                </Link>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
