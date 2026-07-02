"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Inbox } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { portalApi } from "@/lib/itsm/api";
import { portalCreateRequestHelpdesk } from "@/lib/itsm/nav";
import type { Helpdesk } from "@/lib/itsm/types";

/** Step 1 of "Create Request": pick a workspace (helpdesk). Lists every active
 *  workspace that has at least one project accepting requests. When only ONE
 *  workspace is configured there is nothing to choose, so we skip straight to its
 *  project step (replace, not push, so Back returns to portal home, not here). */
export default function CreateRequestWorkspaces() {
  const router = useRouter();
  const { org = "" } = useParams<{ org: string }>();
  const [workspaces, setWorkspaces] = useState<Helpdesk[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .workspaces()
      .then((w) => {
        if (cancelled) return;
        if (w.length === 1) {
          // Auto-skip: leave `workspaces` null so the loading spinner stays
          // visible during the redirect rather than flashing a one-card list.
          router.replace(portalCreateRequestHelpdesk(org, w[0].key));
          return;
        }
        setWorkspaces(w);
      })
      .catch(() => {
        if (cancelled) return;
        setWorkspaces([]);
        toast.error("Could not load workspaces.");
      });
    return () => {
      cancelled = true;
    };
  }, [org, router]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create a request"
        description="Pick the team you need help from to get started."
      />

      {workspaces === null ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-[88px] w-full rounded-xl" />
            </li>
          ))}
        </ul>
      ) : workspaces.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No workspaces available"
          description="No workspaces are accepting requests right now."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {workspaces.map((hd) => (
            <li key={hd.id}>
              <Link
                href={`/t/${org}/portal/create-request/${hd.key}`}
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
                  {hd.description ? (
                    <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
                      {hd.description}
                    </span>
                  ) : null}
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
