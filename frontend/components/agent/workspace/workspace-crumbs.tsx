"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { useHeaderSlot } from "@/components/shell/header-slot";
import { buildGroups } from "@/components/settings/settings-nav";
import { useItsmAuth } from "@/lib/itsm/auth";
import { adminHome, agentHome, workspaceBase } from "@/lib/itsm/nav";
import { useWorkspace } from "./workspace-provider";
import { projectLabel } from "./project-display";

/**
 * Modern top-bar breadcrumb (2026-11-05, step B2). Built from the URL, so it needs
 * nothing from the page: `Helpdesk › Incident › ITINC-12`, `Helpdesk › Configuration ›
 * Business Calendars`, `Home › Tenant Settings › Users`. When the page teleports its
 * title into the bar (PageHeader) and that title repeats the last node, the node is
 * dropped and the title follows the trail.
 *
 * The current node is a plain `<span aria-current="page">` — never `BreadcrumbPage`,
 * which is a `role="link"` span and reads as a dimmed link.
 */
type Crumb = { label: string; href?: string };

const ASSET_PAGES: Record<string, string> = {
  dashboard: "Asset Dashboard",
  list: "Asset List",
  report: "Asset Report",
};

function Trail({ parts }: { parts: Crumb[] }) {
  const slot = useHeaderSlot();
  const hasTitle = slot?.hasTitle ?? false;
  const titleText = slot?.titleText?.trim().toLowerCase() ?? null;
  const last = parts[parts.length - 1];
  const shown = hasTitle && last && titleText && last.label.trim().toLowerCase() === titleText ? parts.slice(0, -1) : parts;
  if (!shown.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 sm:block">
      {/* Separators live inside the <li>s: a list may only contain list items (axe). */}
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        {shown.map((c, i) => {
          const isLast = i === shown.length - 1;
          return (
            <li key={`${i}-${c.label}`} className="flex min-w-0 items-center gap-1">
              {i > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" /> : null}
              {c.href && (!isLast || hasTitle) ? (
                <Link
                  href={c.href}
                  className="truncate rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {c.label}
                </Link>
              ) : (
                <span aria-current={hasTitle ? undefined : "page"} className="truncate font-medium text-foreground">
                  {c.label}
                </span>
              )}
              {isLast && hasTitle ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Inside a helpdesk workspace. */
export function WorkspaceCrumbs() {
  const { org, helpdeskKey, helpdesk, projectByKey } = useWorkspace();
  const { hasPerm } = useItsmAuth();
  const pathname = usePathname();
  const base = workspaceBase(org, helpdeskKey);
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  const seg = rest.split("/").filter(Boolean);
  const parts: Crumb[] = [{ label: helpdesk?.name ?? helpdeskKey, href: `${base}/dashboard` }];

  if (seg[0] === "p" && seg[1]) {
    const p = projectByKey(seg[1]);
    parts.push({ label: p ? projectLabel(p) : seg[1], href: `${base}/p/${seg[1]}` });
    if (seg[2]) parts.push({ label: seg[2] === "new" ? "New ticket" : decodeURIComponent(seg[2]) });
  } else if (seg[0] === "all") {
    parts.push({ label: "All Tickets", href: `${base}/all` });
    if (seg[1]) parts.push({ label: decodeURIComponent(seg[1]) });
  } else if (seg[0] === "dashboard") {
    parts.push({ label: "Dashboard" });
  } else if (seg[0] === "reports") {
    parts.push({ label: "Reports", href: `${base}/reports` });
  } else if (seg[0] === "assets") {
    parts.push({ label: "Assets", href: `${base}/assets/list` });
    if (seg[1] && ASSET_PAGES[seg[1]]) parts.push({ label: ASSET_PAGES[seg[1]], href: `${base}/assets/${seg[1]}` });
    if (seg[1] === "list" && seg[2] === "new") parts.push({ label: "New asset" });
    if (seg[1] === "list" && seg[2] === "imports") parts.push({ label: "Import history", href: `${base}/assets/list/imports` });
  } else if (seg[0] === "settings") {
    const sbase = `${base}/settings`;
    parts.push({ label: "Configuration", href: sbase });
    const items = buildGroups(sbase, { assets: hasPerm("itsm.assets.config", "read") }).flatMap((g) => g.items);
    const match = items
      .filter((it) => !it.exact && (pathname === it.href || pathname.startsWith(it.href + "/")))
      .sort((a, b) => b.href.length - a.href.length)[0];
    if (match) parts.push({ label: match.label, href: match.href });
  }
  return <Trail parts={parts} />;
}

/** Outside a workspace: Home, Approvals, Reports, Knowledge, Help, Tenant Settings. */
export function AgentCrumbs() {
  const { org } = useItsmAuth();
  const pathname = usePathname();
  const home = agentHome(org);
  const parts: Crumb[] = [{ label: "Home", href: home }];
  const rest = pathname.startsWith(home) ? pathname.slice(home.length) : "";
  const seg = rest.split("/").filter(Boolean);
  const named: Record<string, string> = {
    approvals: "Approvals",
    reports: "Reports",
    kb: "Knowledge base",
    help: "Help Center",
  };
  if (seg[0] === "admin") {
    parts.push({ label: "Tenant Settings", href: adminHome(org) });
  } else if (seg[0] && named[seg[0]]) {
    parts.push({ label: named[seg[0]], href: `${home}/${seg[0]}` });
  }
  return <Trail parts={parts} />;
}
