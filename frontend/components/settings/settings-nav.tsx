"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AtSign, Building2, CalendarClock, Columns3, Filter, FolderKanban, LayoutGrid, ListChecks, ListTree, Mail, MapPin, MessageSquareText, SlidersHorizontal, Store, Tags, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { useItsmAuth } from "@/lib/itsm/auth";

export type NavItem = { label: string; href: string; icon: LucideIcon; exact?: boolean };
export type NavGroup = { title: string; items: NavItem[] };

/** The settings menu, also used by the Modern breadcrumb to name the current page. */
export function buildGroups(base: string, opts: { assets?: boolean } = {}): NavGroup[] {
  const groups: NavGroup[] = [
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
        { label: "All-Tickets Columns", href: `${base}/columns`, icon: Columns3 },
        { label: "All-Tickets Filters", href: `${base}/filters`, icon: Filter },
      ],
    },
    {
      title: "Project Configuration",
      items: [
        { label: "Projects", href: `${base}/projects`, icon: FolderKanban },
        { label: "Mailboxes", href: `${base}/email`, icon: Mail },
        { label: "Email Notification", href: `${base}/email-notification`, icon: AtSign },
        { label: "Email Log", href: `${base}/email/logs`, icon: ListChecks },
      ],
    },
  ];
  // Asset Management v1 — shown with Asset Configuration read (itsm.assets.config).
  if (opts.assets) {
    groups.push({
      title: "Asset Configuration",
      items: [
        { label: "Categories & Fields", href: `${base}/assets/categories`, icon: ListTree },
        { label: "Statuses", href: `${base}/assets/statuses`, icon: Tags },
        { label: "Vendors", href: `${base}/assets/vendors`, icon: Store },
        { label: "Locations", href: `${base}/assets/locations`, icon: MapPin },
        { label: "Departments", href: `${base}/assets/departments`, icon: Building2 },
      ],
    });
  }
  return groups;
}

export function SettingsNav() {
  const { org, helpdeskKey } = useWorkspace();
  const pathname = usePathname();
  const { hasPerm } = useItsmAuth();
  const base = `/t/${org}/agent/w/${helpdeskKey}/settings`;
  const groups = buildGroups(base, { assets: hasPerm("itsm.assets.config", "read") });

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  }

  return (
    // No helpdesk-name row on top: the workspace sidebar already shows it (2026-10-14).
    <nav aria-label="Settings" className="space-y-5 compact:space-y-3">
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
