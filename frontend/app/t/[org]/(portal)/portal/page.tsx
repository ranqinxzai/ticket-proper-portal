"use client";

import Link from "next/link";
import { BookOpen, CheckSquare, PlusCircle, Ticket } from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { useItsmAuth } from "@/lib/itsm/auth";
import { usePendingApprovals } from "@/lib/itsm/use-pending-approvals";

const FEATURES = [
  {
    path: "/create-request",
    icon: PlusCircle,
    title: "Create Request",
    body: "Pick the team that can help (like IT or HR) and raise a new request on their form.",
  },
  {
    path: "/kb",
    icon: BookOpen,
    title: "Knowledge Base",
    body: "Search how-to articles and solutions before you raise a ticket.",
  },
  { path: "/requests", icon: Ticket, title: "My Requests", body: "Track the status of everything you’ve raised." },
  { path: "/approvals", icon: CheckSquare, title: "Approvals", body: "Review and approve requests awaiting your sign-off." },
];

export default function PortalHome() {
  const { user, org, hasPerm } = useItsmAuth();
  const { count: approvalsCount } = usePendingApprovals();
  // Same gate as the portal nav: itsm.portal.approvals is enforced server-side;
  // users with no ITSM role keep seeing it.
  const canSeeApprovals = !user?.role || hasPerm("itsm.portal.approvals", "read");
  const features = FEATURES.filter((f) => f.path !== "/approvals" || canSeeApprovals);
  const firstName = (user?.full_name || user?.username || "there").split(" ")[0];

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Hi ${firstName}, how can we help?`}
        description="Raise a request, track its progress, or find an answer in the knowledge base."
      />

      <section aria-label="What you can do here">
        <ul className="grid gap-4 sm:grid-cols-2">
          {features.map(({ path, icon: Icon, title, body }) => {
            const badge = path === "/approvals" ? approvalsCount : 0;
            return (
              <li key={title}>
                <Link
                  href={`/t/${org}/portal${path}`}
                  className="flex h-full flex-col rounded-xl border bg-card p-5 text-card-foreground shadow-soft transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <span
                      aria-hidden="true"
                      className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary-ink"
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    {title}
                    {badge > 0 ? (
                      <span
                        aria-label={`${badge} pending`}
                        className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground"
                      >
                        {badge > 99 ? "99+" : badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-2 text-sm text-muted-foreground">{body}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
