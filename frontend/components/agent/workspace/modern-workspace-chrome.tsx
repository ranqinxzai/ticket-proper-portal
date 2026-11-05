"use client";

import { Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  ClipboardCheck,
  Layers,
  LayoutDashboard,
  Menu,
  Settings,
} from "lucide-react";

import { AppSwitcher } from "@/components/shell/app-switcher";
import { HelpLink } from "@/components/shell/help-link";
import { NotificationBell } from "@/components/shell/notification-bell";
import { UserMenu } from "@/components/shell/user-menu";
import { Hint } from "@/components/ui/hint";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useItsmAuth } from "@/lib/itsm/auth";
import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { agentApprovals } from "@/lib/itsm/nav";
import { useMediaQuery } from "@/lib/itsm/use-media-query";
import { usePendingApprovals } from "@/lib/itsm/use-pending-approvals";
import { cn } from "@/lib/utils";
import { ApprovalsBell } from "./approvals-bell";
import { AssetListNav } from "./asset-category-nav";
import { CreateMenu } from "./create-menu";
import { ModernTopBar } from "./modern-topbar";
import {
  Rail,
  RailBrand,
  RailItem,
  RailPinButton,
  RailSection,
  RailSub,
  RailSubItem,
  useRail,
  useRailState,
} from "./modern-rail";
import { projectLabel } from "./project-display";
import { WorkspaceBody } from "./workspace-body";
import { WorkspaceCrumbs } from "./workspace-crumbs";
import { WorkspaceNav } from "./workspace-nav";
import { useWorkspace } from "./workspace-provider";

/**
 * Modern helpdesk chrome (2026-11-05, step B2): icon rail (hover to open, pin to keep
 * open) + 44px top bar with breadcrumb › page title and ⌘K search. Same destinations
 * and permission gates as the Classic `WorkspaceNav`; below `lg` the rail is hidden
 * and the Classic drawer menu is used (its links mount only while it is open).
 */
export function ModernWorkspaceChrome({ children }: { children: React.ReactNode }) {
  const rail = useRailState();
  // The rail carries Approvals and the account menu on desktop; below lg the bar shows
  // them instead. Mounted only there (each polls / owns a menu), never just CSS-hidden.
  const desktop = useMediaQuery("(min-width: 1024px)");
  return (
    // data-shell="agent" scopes the density variables + `compact:` variant (globals.css).
    <div data-shell="agent" className="min-h-screen bg-muted/30">
      <div className="flex">
        <Rail state={rail} label="Workspace" top={<RailTop />} footer={<RailFooter state={rail} />}>
          <WorkspaceRailItems />
        </Rail>
        <div className="flex min-w-0 flex-1 flex-col">
          <ModernTopBar
            leading={<MobileNav />}
            crumbs={<WorkspaceCrumbs />}
            right={
              <>
                <CreateMenu />
                {!desktop ? <ApprovalsBell /> : null}
                <HelpLink className="hidden sm:grid" />
                <NotificationBell />
                {!desktop ? <UserMenu /> : null}
              </>
            }
          />
          <main id="main-content" className="w-full px-main-x py-main-y">
            <WorkspaceBody>{children}</WorkspaceBody>
          </main>
        </div>
      </div>
    </div>
  );
}

function RailTop() {
  const { helpdesk, loading } = useWorkspace();
  const { expanded, hold } = useRail();
  return (
    <>
    <RailBrand />
    <div className="flex h-10 items-center gap-2.5 px-1">
      <Hint label={expanded ? "" : helpdesk ? `${helpdesk.name} helpdesk` : ""} side="right" wrap>
        {helpdesk ? (
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
            style={{ backgroundColor: helpdesk.color || "#e60053", color: readableOn(helpdesk.color) }}
          >
            <ItsmIcon name={helpdesk.icon} className="h-4 w-4" />
          </span>
        ) : (
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-muted" aria-hidden="true" />
        )}
      </Hint>
      <div className={cn("min-w-0 flex-1", !expanded && "hidden")}>
        <p className="truncate text-sm font-semibold tracking-tight text-foreground" title={helpdesk?.name}>
          {helpdesk?.name ?? (loading ? "Loading…" : "Workspace")}
        </p>
        <p className="truncate text-xs text-muted-foreground">Helpdesk</p>
      </div>
      <div className={cn(!expanded && "hidden")}>
        <AppSwitcher onOpenChange={hold} />
      </div>
    </div>
    </>
  );
}

function WorkspaceRailItems() {
  const { org, helpdeskKey, helpdesk, projects } = useWorkspace();
  const { user, hasPerm } = useItsmAuth();
  const pathname = usePathname();
  const { count: pending } = usePendingApprovals();
  const { collapse } = useRail();
  const base = `/t/${org}/agent/w/${helpdeskKey}`;
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const canDashboard = hasPerm("itsm.dashboard", "read");
  const canReports = hasPerm("itsm.reports", "read");
  const canAssets = hasPerm("itsm.assets", "read");
  // Same gate as the Classic header's approvals icon (itsm.portal.approvals).
  const canApprovals = !user?.role || hasPerm("itsm.portal.approvals", "read");
  const onTickets = isActive(`${base}/all`) || isActive(`${base}/p`);

  return (
    <>
      {canDashboard ? (
        <RailItem
          href={`${base}/dashboard`}
          label="Dashboard"
          shortcut="G D"
          active={isActive(`${base}/dashboard`)}
          icon={<LayoutDashboard className="h-4 w-4" />}
        />
      ) : null}
      <RailItem
        href={`${base}/all`}
        label="All Tickets"
        shortcut="G T"
        active={onTickets && !projects.some((p) => isActive(`${base}/p/${p.key}`))}
        icon={<Layers className="h-4 w-4" />}
      />
      {projects.length ? (
        <RailSub>
          {projects.map((p) => (
            <RailSubItem key={p.id} href={`${base}/p/${p.key}`} label={projectLabel(p)} active={isActive(`${base}/p/${p.key}`)} />
          ))}
        </RailSub>
      ) : null}
      {canApprovals ? (
        <RailItem
          href={agentApprovals(org)}
          label="Approvals"
          shortcut="G A"
          badge={pending}
          active={false}
          icon={<ClipboardCheck className="h-4 w-4" />}
        />
      ) : null}
      {canReports ? (
        <RailItem
          href={`${base}/reports`}
          label="Reports"
          active={isActive(`${base}/reports`)}
          icon={<BarChart3 className="h-4 w-4" />}
        />
      ) : null}
      {canAssets ? (
        <>
          <RailSection>Assets</RailSection>
          <RailItem
            href={`${base}/assets/list`}
            label="Assets"
            shortcut="G E"
            active={isActive(`${base}/assets`)}
            icon={<Boxes className="h-4 w-4" />}
          />
          <RailSub>
            <RailSubItem href={`${base}/assets/dashboard`} label="Asset Dashboard" active={isActive(`${base}/assets/dashboard`)} />
            {/* Asset List + its category → sub-category tree (reads ?category=, hence
                the Suspense boundary for useSearchParams). Mounted once, hidden while
                the rail is folded, so the categories load once. */}
            <li>
              <Suspense
                fallback={<RailSubItem href={`${base}/assets/list`} label="Asset List" active={isActive(`${base}/assets/list`)} />}
              >
                <AssetListNav base={base} helpdeskId={helpdesk?.id} onNavigate={collapse} />
              </Suspense>
            </li>
            <RailSubItem href={`${base}/assets/report`} label="Asset Report" active={isActive(`${base}/assets/report`)} />
          </RailSub>
        </>
      ) : null}
    </>
  );
}

function RailFooter({ state }: { state: ReturnType<typeof useRailState> }) {
  const { org, helpdeskKey, helpdesk } = useWorkspace();
  const { isAdmin } = useItsmAuth();
  const pathname = usePathname();
  const href = `/t/${org}/agent/w/${helpdeskKey}/settings`;
  return (
    <ul className="flex flex-col gap-0.5">
      {helpdesk && isAdmin ? (
        <RailItem
          href={href}
          label="Configuration"
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

/** Below `lg`: the Classic workspace menu in a drawer (unmounted while closed). */
function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Hint label="Open navigation" side="bottom">
        <SheetTrigger
          aria-label="Open navigation"
          className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </SheetTrigger>
      </Hint>
      <SheetContent side="left" className="w-72 max-w-[85vw] p-4 sm:w-72 md:w-72 lg:w-72 lg:min-w-0 lg:max-w-[85vw]">
        <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
        <WorkspaceNav onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
