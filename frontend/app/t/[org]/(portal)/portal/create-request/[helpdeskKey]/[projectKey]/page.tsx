"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileQuestion } from "lucide-react";
import { toast } from "sonner";

import { PortalRequestForm } from "@/components/portal/portal-request-form";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { portalApi } from "@/lib/itsm/api";
import { createRequestWorkspaceBack, portalCreateRequestHelpdesk, portalHome } from "@/lib/itsm/nav";
import type { Project } from "@/lib/itsm/types";

type Created = { id: string; ticket_number: string };

/** Step 3 of "Create Request": the project's configured form, then a confirmation
 *  with the ticket number + "Go to Home" / "Create New ticket". */
export default function CreateRequestForm() {
  const router = useRouter();
  const { org = "", helpdeskKey = "", projectKey = "" } = useParams<{
    org: string;
    helpdeskKey: string;
    projectKey: string;
  }>();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [created, setCreated] = useState<Created | null>(null);
  const [formKey, setFormKey] = useState(0); // bump to remount a fresh form
  // When the helpdesk has a single project the project picker (step 2) auto-skips,
  // so "Back" must bypass it to avoid bouncing forward again.
  const [soloProject, setSoloProject] = useState(false);
  const [soloWorkspace, setSoloWorkspace] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    portalApi
      .intakeProjects(helpdeskKey)
      .then((projects) => {
        if (cancelled) return;
        setProject(projects.find((p) => p.key === projectKey) ?? null);
        setSoloProject(projects.length === 1);
      })
      .catch(() => {
        if (!cancelled) setProject(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [helpdeskKey, projectKey]);

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

  // Skip the project picker on the way back when it would only auto-skip forward.
  const backHref = soloProject
    ? createRequestWorkspaceBack(org, soloWorkspace)
    : portalCreateRequestHelpdesk(org, helpdeskKey);

  if (created) {
    return (
      <div className="mx-auto max-w-lg space-y-6 py-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Request submitted</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your request <span className="font-semibold text-foreground">{created.ticket_number}</span>{" "}
            has been logged. We&apos;ll keep you posted on its progress.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Button onClick={() => router.push(portalHome(org))}>Go to Home</Button>
          <Button
            variant="outline"
            onClick={() => {
              setCreated(null);
              setFormKey((k) => k + 1);
            }}
          >
            Create new ticket
          </Button>
        </div>
        <p className="text-sm">
          <Link
            href={`/t/${org}/portal/requests/${created.ticket_number}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            Track this request
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Link>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : !project ? (
        <EmptyState
          icon={FileQuestion}
          title="Request type unavailable"
          description="This request type is no longer available."
          action={
            <Button asChild variant="outline">
              <Link href={backHref}>Pick another</Link>
            </Button>
          }
        />
      ) : (
        <>
          <PageHeader title={project.name} description={project.description} />
          <PortalRequestForm key={formKey} project={project} onCreated={setCreated} />
        </>
      )}
    </div>
  );
}
