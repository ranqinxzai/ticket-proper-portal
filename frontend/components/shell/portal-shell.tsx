"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useItsmAuth } from "@/lib/itsm/auth";
import { agentHome, portalHome } from "@/lib/itsm/nav";
import { usePendingApprovals } from "@/lib/itsm/use-pending-approvals";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand-mark";
import { CompanyBrand } from "./company-brand";
import { UserMenu } from "./user-menu";

const NAV = [
  { path: "", label: "Home" },
  // Request Catalog is deferred — "Create Request" (workspace → project → form) is
  // the current intake path. The catalog routes remain; re-add the link when ready.
  { path: "/create-request", label: "Create Request" },
  { path: "/kb", label: "Knowledge Base" },
  { path: "/requests", label: "My Requests" },
  { path: "/approvals", label: "Approvals" },
];

/** Lighter chrome for the end-user Service Portal. Distinct, simpler UX. */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { org = "" } = useParams<{ org: string }>();
  const { isAgent } = useItsmAuth();
  const home = portalHome(org);
  const { count: approvalsCount } = usePendingApprovals();
  const isActive = (href: string) =>
    href === home ? pathname === home : pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-background">
      <header role="banner" className="border-b bg-card shadow-soft">
        <div className="relative mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <Link
            href={home}
            className="flex items-center gap-2 rounded-md font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandMark showWordmark={false} />
            <span>Help Center</span>
          </Link>
          <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:flex">
            <CompanyBrand className="pointer-events-auto" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* Agents/admins also browse the portal (e.g. to raise their own request);
                give them a clear way back to the agent app — pure requestors have none
                and never see this. Mirrors the "Service Portal" entry on Agent Home. */}
            {isAgent ? (
              <Link
                href={agentHome(org)}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Agent home</span>
              </Link>
            ) : null}
            <ThemeToggle />
            <UserMenu showDensity={false} />
          </div>
        </div>
        <nav aria-label="Portal" className="mx-auto max-w-5xl px-4">
          <ul className="flex flex-wrap gap-1 pb-2">
            {NAV.map((item) => {
              const href = `${home}${item.path}`;
              const badge = item.path === "/approvals" ? approvalsCount : 0;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={isActive(href) ? "page" : undefined}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive(href)
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {item.label}
                    {badge > 0 ? (
                      <span
                        aria-label={`${badge} pending`}
                        className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                      >
                        {badge > 9 ? "9+" : badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
