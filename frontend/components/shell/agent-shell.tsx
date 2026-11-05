"use client";

import { useLayoutEffect } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Settings } from "lucide-react";

import { useUi } from "@/components/theme/density-provider";
import { Hint } from "@/components/ui/hint";
import { useItsmAuth } from "@/lib/itsm/auth";
import { adminHome, agentHome } from "@/lib/itsm/nav";
import { AppSwitcher } from "./app-switcher";
import { BrandMark } from "./brand-mark";
import { CompanyBrand } from "./company-brand";
import { HelpLink } from "./help-link";
import { ModernAgentChrome } from "./modern-agent-chrome";
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
 *   the company logo + "OneDesk" wordmark, a Tenant-Settings gear (managers
 *   only), and the profile menu (which also carries the theme switch). */
export function AgentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { org = "" } = useParams<{ org: string }>();
  const { hasPerm, isSupervisor } = useItsmAuth();
  const { ui } = useUi();
  const adminHref = adminHome(org);
  const inWorkspace = pathname.startsWith(`/t/${org}/agent/w/`);
  const isHome = pathname === agentHome(org);

  // <html data-app="agent"> scopes the Modern interface tokens (globals.css) so they
  // also reach portaled dialogs/menus. DENSITY_SCRIPT sets it pre-paint on a hard
  // load; this keeps it right across soft navigations (agent → portal removes it,
  // portal → agent adds it). Before the early return: hooks run unconditionally.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-app", "agent");
    return () => root.removeAttribute("data-app");
  }, []);

  if (inWorkspace) {
    return <>{children}</>;
  }
  // Modern interface (2026-11-05, step B2): icon rail + 44px top bar. Classic below.
  if (ui === "modern") {
    return <ModernAgentChrome>{children}</ModernAgentChrome>;
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
    // data-shell="agent" scopes the density variables + the `compact:` variant to the
    // agent app (see globals.css). The header height lives on the OUTER element so
    // its border is inside `--header-h` (border-box) and sticky offsets match exactly.
    <div data-shell="agent" className="min-h-screen bg-background">
      <header
        role="banner"
        className="sticky top-0 z-40 h-header border-b bg-card/95 shadow-soft backdrop-blur supports-[backdrop-filter]:bg-card/80"
      >
        <div className="relative flex h-full items-center gap-3 px-main-x">
          {!isHome ? <AppSwitcher /> : null}
          <Hint label="OneDesk home — choose a helpdesk" side="bottom">
          <Link
            href={agentHome(org)}
            aria-label="OneDesk home"
            className="flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandMark />
          </Link>
          </Hint>
          <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:flex">
            <CompanyBrand className="pointer-events-auto" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <HelpLink />
            {canTenantSettings ? (
              <Hint label="Tenant settings — users, roles and helpdesks" side="bottom">
              <Link
                href={adminHref}
                aria-label="Tenant settings"
                aria-current={pathname.startsWith(adminHref) ? "page" : undefined}
                className="grid h-[var(--ctl-h)] w-[var(--ctl-h)] place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
              >
                <Settings className="h-5 w-5" aria-hidden="true" />
              </Link>
              </Hint>
            ) : null}
            <UserMenu />
          </div>
        </div>
      </header>
      <main id="main-content" className="w-full px-main-x py-main-y">
        {children}
      </main>
    </div>
  );
}
