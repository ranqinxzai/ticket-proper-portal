"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, KeyRound, LayoutGrid, ShieldCheck, Tags, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useItsmAuth } from "@/lib/itsm/auth";
import {
  adminHelpdesks,
  adminHome,
  adminRoles,
  adminSso,
  adminUserAttributes,
  adminUsers,
} from "@/lib/itsm/nav";

type NavItem = { label: string; href: string; icon: LucideIcon; exact?: boolean };
type NavGroup = { title: string; items: NavItem[] };

/** Left-rail nav for the Tenant Settings hub. Org-scoped (NOT inside a workspace),
 *  so it reads `org` from auth rather than `useWorkspace`. Items are gated by the
 *  same modules their pages enforce, so a user only sees what they can reach. */
export function TenantSettingsNav() {
  const { org, hasPerm, isSupervisor } = useItsmAuth();
  const pathname = usePathname();

  const canRoles = isSupervisor || hasPerm("itsm.admin.roles", "read");
  const canSso = isSupervisor || hasPerm("itsm.admin.sso", "read");
  const canHelpdesks =
    isSupervisor ||
    hasPerm("itsm.admin.helpdesks", "read") ||
    hasPerm("itsm.admin.helpdesks", "update") ||
    hasPerm("itsm.admin.helpdesks", "create");

  const groups: NavGroup[] = [
    { title: "Overview", items: [{ label: "All settings", href: adminHome(org), icon: LayoutGrid, exact: true }] },
  ];
  const accessItems: NavItem[] = [];
  if (canRoles) {
    accessItems.push({ label: "Users", href: adminUsers(org), icon: UserCog });
    accessItems.push({ label: "User Attributes", href: adminUserAttributes(org), icon: Tags });
    accessItems.push({ label: "Roles & Permissions", href: adminRoles(org), icon: ShieldCheck });
  }
  if (canSso) {
    accessItems.push({ label: "Authentication", href: adminSso(org), icon: KeyRound });
  }
  if (accessItems.length) {
    groups.push({ title: "Access Control", items: accessItems });
  }
  if (canHelpdesks) {
    groups.push({
      title: "Workspaces",
      items: [{ label: "Helpdesks", href: adminHelpdesks(org), icon: Building2 }],
    });
  }

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  }

  return (
    <nav aria-label="Tenant settings" className="space-y-5">
      <div className="flex items-center gap-2 px-2">
        <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-semibold">Tenant Settings</span>
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
