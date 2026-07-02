"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, LayoutDashboard, Layers } from "lucide-react";

import { cn } from "@/lib/utils";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { useWorkspace } from "./workspace-provider";
import { projectIconName, projectLabel } from "./project-display";

/** Dashboard + a tab per project, rendered inline in the consolidated header.
 * Settings/Config lives in the header's right-side cluster, not here. */
export function WorkspaceTabs() {
  const { org, helpdeskKey, projects } = useWorkspace();
  const pathname = usePathname();
  const base = `/t/${org}/agent/w/${helpdeskKey}`;

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const tabClass = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "border-primary font-medium text-foreground"
        : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
    );

  return (
    <nav aria-label="Workspace sections" className="min-w-0 flex-1 overflow-x-auto">
      <ul className="flex items-center gap-1">
        <li>
          <Link
            href={`${base}/dashboard`}
            aria-current={isActive(`${base}/dashboard`) ? "page" : undefined}
            className={tabClass(isActive(`${base}/dashboard`))}
          >
            <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
            Dashboard
          </Link>
        </li>
        <li>
          <Link
            href={`${base}/all`}
            aria-current={isActive(`${base}/all`) ? "page" : undefined}
            className={tabClass(isActive(`${base}/all`))}
          >
            <Layers className="h-4 w-4" aria-hidden="true" />
            All Tickets
          </Link>
        </li>
        {projects.map((p) => {
          const href = `${base}/p/${p.key}`;
          return (
            <li key={p.id}>
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={tabClass(isActive(href))}
              >
                <ItsmIcon name={projectIconName(p)} className="h-4 w-4" />
                {projectLabel(p)}
              </Link>
            </li>
          );
        })}
        <li>
          <Link
            href={`${base}/reports`}
            aria-current={isActive(`${base}/reports`) ? "page" : undefined}
            className={tabClass(isActive(`${base}/reports`))}
          >
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            Reports
          </Link>
        </li>
      </ul>
    </nav>
  );
}
