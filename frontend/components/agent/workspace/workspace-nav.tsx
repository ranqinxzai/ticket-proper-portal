"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, LayoutDashboard, Layers, Settings } from "lucide-react";

import { cn } from "@/lib/utils";
import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { AppSwitcher } from "@/components/shell/app-switcher";
import { useWorkspace } from "./workspace-provider";
import { projectIconName, projectLabel } from "./project-display";

function NavLink({
  href,
  label,
  icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <li className="px-3 pb-1 pt-4 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
    {children}
  </li>
);

/** The agent workspace navigation, shared by the desktop sidebar and the mobile
 * drawer. Same links as the former inline tabs (Dashboard · All Tickets ·
 * projects · Reports · Configuration) plus the helpdesk identity + switcher. */
export function WorkspaceNav({ onNavigate }: { onNavigate?: () => void }) {
  const { org, helpdesk, helpdeskKey, projects, loading } = useWorkspace();
  const pathname = usePathname();
  const base = `/t/${org}/agent/w/${helpdeskKey}`;
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="flex h-full flex-col">
      {/* Helpdesk identity + switcher */}
      <div className="flex items-center gap-2.5 px-1 pb-2">
        {helpdesk ? (
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
            style={{ backgroundColor: helpdesk.color || "#6366f1", color: readableOn(helpdesk.color) }}
          >
            <ItsmIcon name={helpdesk.icon} className="h-4 w-4" />
          </span>
        ) : (
          <span className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-muted" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-foreground">
            {helpdesk?.name ?? (loading ? "Loading…" : "Workspace")}
          </p>
          <p className="truncate text-xs text-muted-foreground">Helpdesk</p>
        </div>
        <AppSwitcher />
      </div>

      <nav aria-label="Workspace" className="flex-1 overflow-y-auto py-2">
        <ul className="flex flex-col gap-1">
          <li>
            <NavLink
              href={`${base}/dashboard`}
              label="Dashboard"
              active={isActive(`${base}/dashboard`)}
              icon={<LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden="true" />}
              onNavigate={onNavigate}
            />
          </li>
          <li>
            <NavLink
              href={`${base}/all`}
              label="All Tickets"
              active={isActive(`${base}/all`)}
              icon={<Layers className="h-4 w-4 shrink-0" aria-hidden="true" />}
              onNavigate={onNavigate}
            />
          </li>

          {projects.length ? <SectionLabel>Projects</SectionLabel> : null}
          {projects.map((p) => (
            <li key={p.id}>
              <NavLink
                href={`${base}/p/${p.key}`}
                label={projectLabel(p)}
                active={isActive(`${base}/p/${p.key}`)}
                icon={<ItsmIcon name={projectIconName(p)} className="h-4 w-4 shrink-0" />}
                onNavigate={onNavigate}
              />
            </li>
          ))}

          <SectionLabel>Insights</SectionLabel>
          <li>
            <NavLink
              href={`${base}/reports`}
              label="Reports"
              active={isActive(`${base}/reports`)}
              icon={<BarChart3 className="h-4 w-4 shrink-0" aria-hidden="true" />}
              onNavigate={onNavigate}
            />
          </li>
        </ul>
      </nav>

      {helpdesk ? (
        <div className="mt-auto border-t pt-2">
          <NavLink
            href={`${base}/settings`}
            label="Configuration"
            active={isActive(`${base}/settings`)}
            icon={<Settings className="h-4 w-4 shrink-0" aria-hidden="true" />}
            onNavigate={onNavigate}
          />
        </div>
      ) : null}
    </div>
  );
}
