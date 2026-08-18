"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  LayoutDashboard,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useItsmAuth } from "@/lib/itsm/auth";
import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { AppSwitcher } from "@/components/shell/app-switcher";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspace } from "./workspace-provider";
import { projectIconName, projectLabel } from "./project-display";

/** A nav item. Collapsed → icon-only with a hover tooltip; expanded → icon + label. */
function NavLink({
  href,
  label,
  icon,
  active,
  collapsed,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "flex items-center rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        collapsed ? "h-9 w-9 justify-center" : "gap-2.5 px-3 py-2",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {icon}
      {collapsed ? null : <span className="truncate">{label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <li className="px-3 pb-1 pt-4 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
    {children}
  </li>
);

const Rule = () => <li className="my-1 h-px w-6 bg-border" aria-hidden="true" />;

/** The agent workspace navigation, shared by the desktop sidebar (which may be
 * collapsed to an icon rail) and the mobile drawer (always expanded). Same links
 * as before: Dashboard · All Tickets · projects · Reports · Configuration. */
export function WorkspaceNav({
  collapsed = false,
  onToggleCollapse,
  onNavigate,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const { org, helpdesk, helpdeskKey, projects, loading } = useWorkspace();
  // Configuration is an owner-only surface: hidden from agents and supervisors.
  const { isAdmin, hasPerm } = useItsmAuth();
  const pathname = usePathname();
  const base = `/t/${org}/agent/w/${helpdeskKey}`;
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  // Insights are permission-gated so a role without the grant (e.g. Agent) doesn't
  // see dead links: the backend already denies the data, this hides the nav too.
  const canDashboard = hasPerm("itsm.dashboard", "read");
  const canReports = hasPerm("itsm.reports", "read");

  const medallion = helpdesk ? (
    <span
      aria-hidden="true"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
      style={{ backgroundColor: helpdesk.color || "#6366f1", color: readableOn(helpdesk.color) }}
    >
      <ItsmIcon name={helpdesk.icon} className="h-4 w-4" />
    </span>
  ) : (
    <span className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-muted" aria-hidden="true" />
  );

  return (
    <div className={cn("flex h-full flex-col", collapsed && "items-center")}>
      {/* Helpdesk identity + switcher */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 pb-2">
          {medallion}
          <AppSwitcher />
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-1 pb-2">
          {medallion}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight text-foreground">
              {helpdesk?.name ?? (loading ? "Loading…" : "Workspace")}
            </p>
            <p className="truncate text-xs text-muted-foreground">Helpdesk</p>
          </div>
          <AppSwitcher />
        </div>
      )}

      <nav aria-label="Workspace" className="w-full flex-1 overflow-y-auto py-2">
        <ul className={cn("flex flex-col gap-1", collapsed && "items-center")}>
          {canDashboard ? (
            <li>
              <NavLink
                href={`${base}/dashboard`}
                label="Dashboard"
                active={isActive(`${base}/dashboard`)}
                collapsed={collapsed}
                onNavigate={onNavigate}
                icon={<LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden="true" />}
              />
            </li>
          ) : null}
          <li>
            <NavLink
              href={`${base}/all`}
              label="All Tickets"
              active={isActive(`${base}/all`)}
              collapsed={collapsed}
              onNavigate={onNavigate}
              icon={<Layers className="h-4 w-4 shrink-0" aria-hidden="true" />}
            />
          </li>

          {projects.length ? (collapsed ? <Rule /> : <SectionLabel>Projects</SectionLabel>) : null}
          {projects.map((p) => (
            <li key={p.id}>
              <NavLink
                href={`${base}/p/${p.key}`}
                label={projectLabel(p)}
                active={isActive(`${base}/p/${p.key}`)}
                collapsed={collapsed}
                onNavigate={onNavigate}
                icon={<ItsmIcon name={projectIconName(p)} className="h-4 w-4 shrink-0" />}
              />
            </li>
          ))}

          {canReports ? (
            <>
              {collapsed ? <Rule /> : <SectionLabel>Insights</SectionLabel>}
              <li>
                <NavLink
                  href={`${base}/reports`}
                  label="Reports"
                  active={isActive(`${base}/reports`)}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                  icon={<BarChart3 className="h-4 w-4 shrink-0" aria-hidden="true" />}
                />
              </li>
            </>
          ) : null}
        </ul>
      </nav>

      <div className={cn("w-full border-t pt-2", collapsed && "flex flex-col items-center")}>
        {helpdesk && isAdmin ? (
          <NavLink
            href={`${base}/settings`}
            label="Configuration"
            active={isActive(`${base}/settings`)}
            collapsed={collapsed}
            onNavigate={onNavigate}
            icon={<Settings className="h-4 w-4 shrink-0" aria-hidden="true" />}
          />
        ) : null}

        {onToggleCollapse ? (
          collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  aria-label="Expand sidebar"
                  className="mt-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand</TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Collapse</span>
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}
