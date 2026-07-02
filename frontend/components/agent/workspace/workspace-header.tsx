"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { NotificationBell } from "@/components/shell/notification-bell";
import { UserMenu } from "@/components/shell/user-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useWorkspace } from "./workspace-provider";
import { WorkspaceNav } from "./workspace-nav";
import { CreateMenu } from "./create-menu";
import { ApprovalsBell } from "./approvals-bell";

/** Slim top bar shown inside a helpdesk. Primary navigation lives in the left
 * sidebar (desktop) or the drawer opened by the menu button (mobile); this bar
 * carries the helpdesk name (mobile), Create, Approvals, Notifications, Profile. */
export function WorkspaceHeader() {
  const { helpdesk } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header
      role="banner"
      className="sticky top-0 z-30 border-b bg-card/95 shadow-soft backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
        {/* Mobile: open the navigation drawer */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            aria-label="Open navigation"
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-72 max-w-[85vw] p-4 sm:w-72 md:w-72 lg:w-72 lg:min-w-0 lg:max-w-[85vw]"
          >
            <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
            <WorkspaceNav onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Helpdesk identity — mobile only (the sidebar shows it on desktop) */}
        <div className="flex min-w-0 items-center gap-2 lg:hidden">
          {helpdesk ? (
            <>
              <span
                aria-hidden="true"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                style={{ backgroundColor: helpdesk.color || "#6366f1", color: readableOn(helpdesk.color) }}
              >
                <ItsmIcon name={helpdesk.icon} className="h-4 w-4" />
              </span>
              <h1 className="truncate text-sm font-semibold tracking-tight">{helpdesk.name}</h1>
            </>
          ) : null}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {helpdesk ? <CreateMenu /> : null}
          <ApprovalsBell />
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
