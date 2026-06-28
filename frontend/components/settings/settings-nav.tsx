"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CalendarClock, FolderKanban, LayoutGrid, ListChecks, Mail, MessageSquareText, SlidersHorizontal, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";

type NavItem = { label: string; href: string; icon: LucideIcon; exact?: boolean };
type NavGroup = { title: string; items: NavItem[] };

function buildGroups(base: string): NavGroup[] {
  return [
    {
      title: "Overview",
      items: [{ label: "All settings", href: base, icon: LayoutGrid, exact: true }],
    },
    {
      title: "HelpDesk Configuration",
      items: [
        { label: "Helpdesk Config", href: `${base}/helpdesk`, icon: SlidersHorizontal },
        { label: "Business Calendars", href: `${base}/calendar`, icon: CalendarClock },
        { label: "Assigned Groups", href: `${base}/groups`, icon: Users },
        { label: "Canned Responses", href: `${base}/canned-responses`, icon: MessageSquareText },
      ],
    },
    {
      title: "Project Configuration",
      items: [
        { label: "Projects", href: `${base}/projects`, icon: FolderKanban },
        { label: "Mailboxes", href: `${base}/email`, icon: Mail },
        { label: "Email Log", href: `${base}/email/logs`, icon: ListChecks },
      ],
    },
  ];
}

export function SettingsNav() {
  const { org, helpdeskKey, helpdesk } = useWorkspace();
  const pathname = usePathname();
  const base = `/t/${org}/agent/w/${helpdeskKey}/settings`;
  const groups = buildGroups(base);

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  }

  return (
    <nav aria-label="Settings" className="space-y-5">
      <div className="flex items-center gap-2 px-2">
        <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-semibold">{helpdesk?.name ?? "Settings"}</span>
      </div>
      {groups.map((group) => (
        <div key={group.title} className="space-y-1">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(item);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
