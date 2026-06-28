"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Inbox,
  LifeBuoy,
} from "lucide-react";

import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { useItsmAuth } from "@/lib/itsm/auth";
import { useCanAuthorKb } from "@/lib/itsm/kb-perms";
import { agentKb, portalHome } from "@/lib/itsm/nav";
import type { Helpdesk } from "@/lib/itsm/types";

/** First name for the greeting (falls back to the whole string / nothing). */
function firstNameOf(full?: string | null): string {
  if (!full) return "";
  return full.trim().split(/\s+/)[0] ?? "";
}

/** Agent Home — a branded welcome hero over the helpdesk selector ("Select
 * Helpdesk") plus a single Knowledge-Base entry and a right-rail panel of the
 * agent's urgent items. Settings/admin live behind the Tenant-Settings gear; each
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
    <div className="space-y-8">
      {/* Brand gradient welcome hero — reads identically in light + dark. */}
      <section className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#ec0a8c_0%,#7c3aed_52%,#22b5e6_100%)] p-6 text-white shadow-sm sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-white/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-cyan-200/20 blur-3xl"
        />
        <div className="relative z-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
            One Helpdesk
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
            {name ? `Welcome back, ${name}` : "Welcome back"}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-white/85 sm:text-base">
            Pick a helpdesk to jump into its dashboards, incidents, requests and approvals.
          </p>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-10">
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
              <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {helpdesks.map((hd) => (
                  <li key={hd.id}>
                    <WorkspaceCard helpdesk={hd} org={org} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canAuthorKb ? (
            <section aria-labelledby="kb-heading">
              <h2 id="kb-heading" className="text-lg font-semibold tracking-tight">
                Knowledge Base
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Author and publish help articles, per helpdesk or organisation-wide.
              </p>
              <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <li>
                  <EntryCard
                    href={agentKb(org)}
                    icon={<BookOpen className="h-6 w-6" aria-hidden="true" />}
                    title="Knowledge Base"
                    description="Pick a helpdesk or organisation-wide to manage articles & categories."
                  />
                </li>
              </ul>
            </section>
          ) : null}
        </div>

        <aside aria-label="Needs your attention" className="space-y-4">
          {canUsePortal ? (
            <Link
              href={portalHome(org)}
              className="group flex items-center gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
    </div>
  );
}

function WorkspaceCard({ helpdesk, org }: { helpdesk: Helpdesk; org: string }) {
  return (
    <Link
      href={`/t/${org}/agent/w/${helpdesk.key}`}
      className="group relative flex h-full items-center gap-4 overflow-hidden rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span
        aria-hidden="true"
        className="grid h-12 w-12 shrink-0 place-items-center rounded-xl shadow-sm"
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
      className="group relative flex h-full items-center gap-4 overflow-hidden rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span
        aria-hidden="true"
        className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground shadow-sm"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
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
    <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
    </div>
  );
}
