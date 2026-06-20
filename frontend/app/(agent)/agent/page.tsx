"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Inbox } from "lucide-react";

import { useItsmAuth } from "@/lib/itsm/auth";
import type { Helpdesk } from "@/lib/itsm/types";

/** Agent Home — the workspace card selector ("Which ServiceDesk do you need?")
 * plus a right-rail panel of the agent's urgent items. Live data lands in P1+. */
export default function AgentHome() {
  const { user } = useItsmAuth();
  const helpdesks = user?.helpdesks ?? [];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-labelledby="workspaces-heading">
        <h1 id="workspaces-heading" className="text-2xl font-semibold tracking-tight">
          Which ServiceDesk do you need?
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a workspace to work its dashboards, incidents and requests.
        </p>

        {helpdesks.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            You are not a member of any helpdesk yet. Ask a supervisor to add you.
          </div>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {helpdesks.map((hd) => (
              <li key={hd.id}>
                <WorkspaceCard helpdesk={hd} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside aria-label="Needs your attention" className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Needs your attention
        </h2>
        <AttentionCard
          icon={<AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />}
          title="SLA at risk"
          empty="No SLAs approaching breach."
        />
        <AttentionCard
          icon={<Inbox className="h-4 w-4 text-primary" aria-hidden="true" />}
          title="Pending approvals"
          empty="Nothing awaiting your approval."
        />
        <AttentionCard
          icon={<CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />}
          title="Assigned to me"
          empty="No high-priority tickets assigned to you."
        />
      </aside>
    </div>
  );
}

function WorkspaceCard({ helpdesk }: { helpdesk: Helpdesk }) {
  return (
    <Link
      href={`/agent/w/${helpdesk.key}`}
      className="group flex h-full items-start gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span
        aria-hidden="true"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-sm font-bold text-white"
        style={{ backgroundColor: helpdesk.color || "#6366f1" }}
      >
        {helpdesk.key}
      </span>
      <span className="min-w-0">
        <span className="block font-medium group-hover:text-accent-foreground">{helpdesk.name}</span>
        {helpdesk.description ? (
          <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
            {helpdesk.description}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function AttentionCard({
  icon,
  title,
  empty,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
    </div>
  );
}
