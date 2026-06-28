"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Settings } from "lucide-react";

import { useItsmAuth } from "@/lib/itsm/auth";
import { adminHome, agentHome } from "@/lib/itsm/nav";
import { AppSwitcher } from "./app-switcher";
import { BrandMark } from "./brand-mark";
import { UserMenu } from "./user-menu";

/** Chrome for the agent application.
 *
 * Two header states, one bar each:
 * - Inside a helpdesk (`/agent/w/...`) the consolidated header is rendered by
 *   `WorkspaceChrome` (it lives inside `WorkspaceProvider`, so it has the
 *   helpdesk + projects). This shell renders nothing extra there — no double bar.
 * - Everywhere else (`/agent`, `/agent/kb`, `/agent/admin`, `/agent/approvals`,
 *   `/agent/reports`) this shell renders a minimal top bar: an app-switcher
 *   (jump Home / switch helpdesk — hidden on Home itself, which is the selector),
 *   the company logo + "One Helpdesk" wordmark, a Tenant-Settings gear (managers
 *   only), and the profile menu (which also carries the theme switch). */
export function AgentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { org = "" } = useParams<{ org: string }>();
  const { hasPerm, isSupervisor } = useItsmAuth();
  const adminHref = adminHome(org);
  const inWorkspace = pathname.startsWith(`/t/${org}/agent/w/`);
  const isHome = pathname === agentHome(org);

  if (inWorkspace) {
    return <>{children}</>;
  }

  // The gear opens the Tenant Settings hub (users / roles / helpdesks); show it
  // to anyone who can reach any of those org-wide surfaces.
  const canTenantSettings =
    isSupervisor ||
    hasPerm("itsm.admin.helpdesks", "update") ||
    hasPerm("itsm.admin.helpdesks", "create") ||
    hasPerm("itsm.admin.roles", "read") ||
    hasPerm("itsm.admin.roles", "create") ||
    hasPerm("itsm.admin.roles", "update");

  return (
    <div className="min-h-screen bg-background">
      <header
        role="banner"
        className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
      >
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
          {!isHome ? <AppSwitcher /> : null}
          <Link
            href={agentHome(org)}
            aria-label="One Helpdesk home"
            className="flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandMark />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {canTenantSettings ? (
              <Link
                href={adminHref}
                aria-label="Tenant settings"
                aria-current={pathname.startsWith(adminHref) ? "page" : undefined}
                className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
              >
                <Settings className="h-5 w-5" aria-hidden="true" />
              </Link>
            ) : null}
            <UserMenu />
          </div>
        </div>
      </header>
      <main id="main-content" className="w-full px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
