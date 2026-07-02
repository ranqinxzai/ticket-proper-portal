"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Globe } from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { useItsmAuth } from "@/lib/itsm/auth";
import { agentKbWorkspace, KB_ORG_KEY } from "@/lib/itsm/nav";

/** Knowledge Base management index — a tile per workspace the user can reach, plus
 *  an Organisation-wide tile for articles/categories with no helpdesk. */
export default function KbWorkspaceIndex() {
  const { user, org } = useItsmAuth();
  const helpdesks = user?.helpdesks ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge Base Mgmt"
        description="Pick a workspace to manage its articles and categories."
      />

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {helpdesks.map((hd) => (
          <li key={hd.id}>
            <Link
              href={agentKbWorkspace(org, hd.key)}
              className="group flex h-full items-center gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden="true"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-xl shadow-sm"
                style={{ backgroundColor: hd.color || "#6366f1", color: readableOn(hd.color) }}
              >
                <ItsmIcon name={hd.icon} className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{hd.name}</span>
                <span className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                  <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> Articles &amp; categories
                </span>
              </span>
              <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          </li>
        ))}

        <li>
          <Link
            href={agentKbWorkspace(org, KB_ORG_KEY)}
            className="group flex h-full items-center gap-4 rounded-xl border border-dashed bg-card p-4 text-card-foreground shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground shadow-sm">
              <Globe className="h-6 w-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Organisation-wide</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                Articles &amp; categories shared across every workspace.
              </span>
            </span>
            <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>
        </li>
      </ul>
    </div>
  );
}
