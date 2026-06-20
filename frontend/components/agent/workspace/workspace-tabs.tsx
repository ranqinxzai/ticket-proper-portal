"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, FolderKanban, LayoutDashboard, Settings, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Project } from "@/lib/itsm/types";
import { useWorkspace } from "./workspace-provider";

function projectTab(p: Project) {
  if (p.project_type === "incident") return { label: "Incident", Icon: ShieldAlert };
  if (p.project_type === "service_request") return { label: "Request", Icon: ClipboardList };
  return { label: p.name, Icon: FolderKanban };
}

export function WorkspaceTabs() {
  const { helpdeskKey, projects } = useWorkspace();
  const pathname = usePathname();
  const base = `/agent/w/${helpdeskKey}`;

  const tabs = [
    { href: `${base}/dashboard`, label: "Dashboard", Icon: LayoutDashboard },
    ...projects.map((p) => {
      const t = projectTab(p);
      return { href: `${base}/p/${p.key}`, label: t.label, Icon: t.Icon };
    }),
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <nav aria-label="Workspace sections" className="flex items-center gap-1 overflow-x-auto">
      <ul className="flex items-center gap-1">
        {tabs.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={isActive(t.href) ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive(t.href)
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              <t.Icon className="h-4 w-4" aria-hidden="true" />
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href={`${base}/settings`}
        aria-current={isActive(`${base}/settings`) ? "page" : undefined}
        className={cn(
          "ml-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive(`${base}/settings`)
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <Settings className="h-4 w-4" aria-hidden="true" />
        Settings
      </Link>
    </nav>
  );
}
