"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Create a request</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick the team you need help from to get started.
        </p>
      </section>

      {workspaces === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading workspaces…
        </p>
      ) : workspaces.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No workspaces are accepting requests right now.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {workspaces.map((hd) => (
            <li key={hd.id}>
              <Link
                href={`/t/${org}/portal/create-request/${hd.key}`}
                className="group flex h-full items-center gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
