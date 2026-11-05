"use client";

import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, CircleHelp, ClipboardCheck, Home, Settings } from "lucide-react";

import { ApprovalsBell } from "@/components/agent/workspace/approvals-bell";
import { ModernTopBar } from "@/components/agent/workspace/modern-topbar";
import {
  Rail,
  RailBrand,
  RailItem,
  RailPinButton,
  useRail,
  useRailState,
} from "@/components/agent/workspace/modern-rail";
import { AgentCrumbs } from "@/components/agent/workspace/workspace-crumbs";
import { useItsmAuth } from "@/lib/itsm/auth";
import { useCanAuthorKb } from "@/lib/itsm/kb-perms";
import { adminHome, agentApprovals, agentHome, agentKb, helpHome } from "@/lib/itsm/nav";
import { useMediaQuery } from "@/lib/itsm/use-media-query";
import { usePendingApprovals } from "@/lib/itsm/use-pending-approvals";
import { AppSwitcher } from "./app-switcher";
import { HelpLink } from "./help-link";
import { UserMenu } from "./user-menu";

/**
 * Modern chrome for the agent pages outside a helpdesk — Home, Approvals, Reports,
 * Knowledge, Help Center and Tenant Settings (2026-11-05, step B2). Same rail and top
 * bar as inside a helpdesk; the Classic `AgentShell` bar is untouched.
 */
export function ModernAgentChrome({ children }: { children: React.ReactNode }) {
  const rail = useRailState();
  const pathname = usePathname();
  const { org } = useItsmAuth();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const isHome = pathname === agentHome(org);
  return (
    // data-shell="agent" scopes the density variables + `compact:` variant (globals.css).
    <div data-shell="agent" className="min-h-screen bg-background">
      <div className="flex">
        <Rail state={rail} label="Agent" top={<RailTop />} footer={<RailFooter state={rail} />}>
          <AgentRailItems />
        </Rail>
        <div className="flex min-w-0 flex-1 flex-col">
          <ModernTopBar
            leading={!desktop && !isHome ? <AppSwitcher /> : null}
            crumbs={<AgentCrumbs />}
            right={
              <>
                {!desktop ? <ApprovalsBell /> : null}
                <HelpLink className="hidden sm:grid" />
                {!desktop ? <UserMenu /> : null}
              </>
            }
          />
          <main id="main-content" className="w-full px-main-x py-main-y">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

/** Menu head outside a helpdesk: the organisation's logo (OneDesk mark when none) and,
 *  while open, the helpdesk switcher. Home is the first menu item. */
function RailTop() {
  const { hold } = useRail();
  return <RailBrand trailing={<AppSwitcher onOpenChange={hold} />} />;
}

function AgentRailItems() {
  const { org, user, hasPerm } = useItsmAuth();
  const pathname = usePathname();
  const { count: pending } = usePendingApprovals();
  const canKb = useCanAuthorKb();
  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  const canApprovals = !user?.role || hasPerm("itsm.portal.approvals", "read");
  const reports = `${agentHome(org)}/reports`;
  return (
    <>
      <RailItem href={agentHome(org)} label="Home" active={isActive(agentHome(org), true)} icon={<Home className="h-4 w-4" />} />
      {canApprovals ? (
        <RailItem
          href={agentApprovals(org)}
          label="Approvals"
          shortcut="G A"
          badge={pending}
          active={isActive(agentApprovals(org))}
          icon={<ClipboardCheck className="h-4 w-4" />}
        />
      ) : null}
      {hasPerm("itsm.reports", "read") ? (
        <RailItem href={reports} label="Reports" active={isActive(reports)} icon={<BarChart3 className="h-4 w-4" />} />
      ) : null}
      {canKb ? (
        <RailItem href={agentKb(org)} label="Knowledge base" active={isActive(agentKb(org))} icon={<BookOpen className="h-4 w-4" />} />
      ) : null}
      <RailItem href={helpHome(org)} label="Help Center" active={isActive(helpHome(org))} icon={<CircleHelp className="h-4 w-4" />} />
    </>
  );
}

function RailFooter({ state }: { state: ReturnType<typeof useRailState> }) {
  const { org, hasPerm, isSupervisor } = useItsmAuth();
  const pathname = usePathname();
  // Same predicate as the Classic Tenant-settings gear (AgentShell).
  const canTenantSettings =
    isSupervisor ||
    hasPerm("itsm.admin.helpdesks", "update") ||
    hasPerm("itsm.admin.helpdesks", "create") ||
    hasPerm("itsm.admin.roles", "read") ||
    hasPerm("itsm.admin.roles", "create") ||
    hasPerm("itsm.admin.roles", "update");
  const href = adminHome(org);
  return (
    <ul className="flex flex-col gap-0.5">
      {canTenantSettings ? (
        <RailItem
          href={href}
          label="Tenant Settings"
          shortcut="G S"
          active={pathname === href || pathname.startsWith(href + "/")}
          icon={<Settings className="h-4 w-4" />}
        />
      ) : null}
      <li>
        <RailPinButton state={state} />
      </li>
      <li>
        <UserMenu variant="rail" expanded={state.expanded} onOpenChange={state.hold} />
      </li>
    </ul>
  );
}
