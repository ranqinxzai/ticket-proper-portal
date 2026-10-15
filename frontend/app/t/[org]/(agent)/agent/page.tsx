"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Inbox, LifeBuoy } from "lucide-react";

import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { useItsmAuth } from "@/lib/itsm/auth";
import { useCanAuthorKb } from "@/lib/itsm/kb-perms";
import { agentApprovals, agentKb, portalHome } from "@/lib/itsm/nav";
import { usePendingApprovals } from "@/lib/itsm/use-pending-approvals";
import type { Helpdesk } from "@/lib/itsm/types";

/** First name for the greeting (falls back to the whole string / nothing). */
function firstNameOf(full?: string | null): string {
  if (!full) return "";
  return full.trim().split(/\s+/)[0] ?? "";
}

/** Agent Home — a branded welcome hero over the helpdesk selector ("Select
 * Helpdesk") plus a right rail (Service Portal + Knowledge Base entries and the
 * live Pending-approvals card). 2026-10-14 free-space pass: no eyebrow / duplicate
 * subtitle in the hero, KB moved from its own one-card section into the rail, and
 * the two static placeholder cards ("SLA at risk", "Assigned to me" — they never
 * loaded data) removed. Settings/admin live behind the Tenant-Settings gear; each
 * helpdesk's own config (incl. canned responses) lives inside its workspace. */
export default function AgentHome() {
  const { user, org, hasPerm } = useItsmAuth();
  const helpdesks = user?.helpdesks ?? [];
  const name = firstNameOf(user?.full_name || user?.username);
  // KB authoring entry point — admin / agent / lead (see kb-perms).
  const canAuthorKb = useCanAuthorKb();
  // Service Portal entry — agents are also employees who may need to raise a
  // request in a helpdesk they don't staff (e.g. HR). Shown only when the user's
  // role grants portal access; hidden otherwise.
  const canUsePortal = hasPerm("itsm.portal.tickets", "create");

  return (
    <div className="space-y-8 compact:space-y-4">
      {/* Brand gradient welcome hero — reads identically in light + dark. */}
      <section className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#ec0a8c_0%,#7c3aed_52%,#22b5e6_100%)] p-6 text-white shadow-sm sm:p-8 compact:px-5 compact:py-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-white/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-cyan-200/20 blur-3xl"
        />
        <div className="relative z-10">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl compact:text-xl">
            {name ? `Welcome back, ${name}` : "Welcome back"}
          </h1>
        </div>
      </section>

      <div className="grid gap-8 compact:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-10 compact:space-y-6">
          <section aria-labelledby="workspaces-heading">
            <h2 id="workspaces-heading" className="text-lg font-semibold tracking-tight">
              Select Helpdesk
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a helpdesk to work its dashboards, incidents and requests.
            </p>

            {helpdesks.length === 0 ? (
              <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                You are not a member of any helpdesk yet. Ask a supervisor to add you.
              </div>
            ) : (
              <ul className="mt-6 grid gap-4 compact:mt-3 compact:gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {helpdesks.map((hd) => (
                  <li key={hd.id}>
                    <WorkspaceCard helpdesk={hd} org={org} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside aria-label="Needs your attention" className="space-y-4 compact:space-y-3">
          {canUsePortal ? (
            <Link
              href={portalHome(org)}
              className="group flex items-center gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background compact:p-3"
            >
              <span
                aria-hidden="true"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
              >
                <LifeBuoy className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Service Portal</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Raise a personal request in any helpdesk — HR, Facilities &amp; more.
                </span>
              </span>
              <ArrowRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-foreground"
              />
            </Link>
          ) : null}
          {canAuthorKb ? (
            <EntryCard
              href={agentKb(org)}
              icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
              title="Knowledge Base"
              description="Write and publish help articles, per helpdesk or organisation-wide."
            />
          ) : null}
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Needs your attention
          </h2>
          <PendingApprovalsCard org={org} />
        </aside>
      </div>
    </div>
  );
}

function WorkspaceCard({ helpdesk, org }: { helpdesk: Helpdesk; org: string }) {
  return (
    <Link
      href={`/t/${org}/agent/w/${helpdesk.key}`}
      className="group relative flex h-full items-center gap-4 overflow-hidden rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background compact:gap-3 compact:p-3"
    >
      <span
        aria-hidden="true"
        className="grid h-12 w-12 shrink-0 place-items-center rounded-xl shadow-sm compact:h-10 compact:w-10"
        style={{ backgroundColor: helpdesk.color || "#6366f1", color: readableOn(helpdesk.color) }}
      >
        <ItsmIcon name={helpdesk.icon} className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{helpdesk.name}</span>
        {helpdesk.description ? (
          <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
            {helpdesk.description}
          </span>
        ) : null}
      </span>
      <ArrowRight
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-foreground"
      />
    </Link>
  );
}

function EntryCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background compact:p-3"
    >
      <span
        aria-hidden="true"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary compact:h-9 compact:w-9"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <ArrowRight
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-foreground"
      />
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
    <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm compact:p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
    </div>
  );
}

/** Live "Pending approvals" attention card. Falls back to the plain empty card when the
 * user has nothing to sign off; otherwise shows a count badge and links to the inbox. */
function PendingApprovalsCard({ org }: { org: string }) {
  const { count, loading } = usePendingApprovals();
  const icon = <Inbox className="h-4 w-4 text-primary" aria-hidden="true" />;

  if (count === 0) {
    return (
      <AttentionCard
        icon={icon}
        title="Pending approvals"
        empty={loading ? "Checking for approvals…" : "Nothing awaiting your approval."}
      />
    );
  }

  return (
    <Link
      href={agentApprovals(org)}
      className="group block rounded-lg border bg-card p-4 text-card-foreground shadow-sm compact:p-3 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        Pending approvals
        <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
          {count > 99 ? "99+" : count}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {count === 1
          ? "1 request awaits your sign-off."
          : `${count} requests await your sign-off.`}
      </p>
    </Link>
  );
}
