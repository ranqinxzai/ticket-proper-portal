"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Inbox } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { portalApi } from "@/lib/itsm/api";
import { createRequestWorkspaceBack } from "@/lib/itsm/nav";
import type { Project } from "@/lib/itsm/types";

/** Step 2 of "Create Request": pick a project within the chosen workspace. When the
 *  workspace has a single active project there is nothing to choose, so we skip
 *  straight to its form (replace, not push, so Back never bounces forward again). */
export default function CreateRequestProjects() {
  const router = useRouter();
  const { org = "", helpdeskKey = "" } = useParams<{ org: string; helpdeskKey: string }>();
  const [projects, setProjects] = useState<Project[] | null>(null);
  // Whether the workspace picker itself auto-skips (one helpdesk) — decides where
  // the "back" control points so it never lands on a page that redirects forward.
  const [soloWorkspace, setSoloWorkspace] = useState(false);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .intakeProjects(helpdeskKey)
      .then((p) => {
        if (cancelled) return;
        if (p.length === 1) {
          // Auto-skip: leave `projects` null so the loading spinner stays visible
          // during the redirect rather than flashing a one-card list.
          router.replace(`/t/${org}/portal/create-request/${helpdeskKey}/${p[0].key}`);
          return;
        }
        setProjects(p);
      })
      .catch(() => {
        if (cancelled) return;
        setProjects([]);
        toast.error("Could not load this workspace.");
      });
    return () => {
      cancelled = true;
    };
  }, [org, helpdeskKey, router]);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .workspaces()
      .then((w) => !cancelled && setSoloWorkspace(w.length === 1))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const helpdeskName = projects?.[0]?.helpdesk_name;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link
            href={createRequestWorkspaceBack(org, soloWorkspace)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {soloWorkspace ? "Home" : "All workspaces"}
          </Link>
        }
        title={helpdeskName ? `${helpdeskName} — what do you need?` : "What do you need?"}
        description="Choose the type of request to open the right form."
      />

      {projects === null ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-[88px] w-full rounded-xl" />
            </li>
          ))}
        </ul>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No request types available"
          description="No request types are available in this workspace."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/t/${org}/portal/create-request/${helpdeskKey}/${p.key}`}
                className="group flex h-full items-center gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-xl shadow-sm"
                  style={{ backgroundColor: p.color || "#6366f1", color: readableOn(p.color) }}
                >
                  <ItsmIcon name={p.icon} className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{p.name}</span>
                  {p.description ? (
                    <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
                      {p.description}
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
