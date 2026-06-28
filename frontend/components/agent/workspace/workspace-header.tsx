"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";

import { cn } from "@/lib/utils";
import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { NotificationBell } from "@/components/shell/notification-bell";
import { UserMenu } from "@/components/shell/user-menu";
import { AppSwitcher } from "@/components/shell/app-switcher";
import { useWorkspace } from "./workspace-provider";
import { WorkspaceTabs } from "./workspace-tabs";
import { CreateMenu } from "./create-menu";
import { ApprovalsBell } from "./approvals-bell";

/** The single consolidated header shown inside a helpdesk:
 * app-switcher · helpdesk icon/name · Dashboard + project tabs ·
 * Create · Approvals · Notifications · Config · Profile. */
export function WorkspaceHeader() {
  const { org, helpdesk, helpdeskKey, loading } = useWorkspace();
  const pathname = usePathname();
  const settingsHref = `/t/${org}/agent/w/${helpdeskKey}/settings`;
  const settingsActive = pathname === settingsHref || pathname.startsWith(settingsHref + "/");

  return (
    <header
      role="banner"
      className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
        <AppSwitcher />

        <div className="flex shrink-0 items-center gap-2">
          {helpdesk ? (
            <>
              <span
                aria-hidden="true"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                style={{ backgroundColor: helpdesk.color || "#6366f1", color: readableOn(helpdesk.color) }}
              >
                <ItsmIcon name={helpdesk.icon} className="h-4 w-4" />
              </span>
              <h1 className="hidden truncate text-sm font-semibold tracking-tight sm:block md:text-base">
                {helpdesk.name}
              </h1>
            </>
          ) : loading ? (
            <span className="h-8 w-32 animate-pulse rounded-lg bg-muted" aria-hidden="true" />
          ) : (
            <h1 className="text-sm font-semibold">Workspace</h1>
          )}
        </div>

        {helpdesk ? <WorkspaceTabs /> : <div className="flex-1" />}

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {helpdesk ? <CreateMenu /> : null}
          <ApprovalsBell />
          <NotificationBell />
          {helpdesk ? (
            <Link
              href={settingsHref}
              aria-label="Configuration"
              aria-current={settingsActive ? "page" : undefined}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                settingsActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
