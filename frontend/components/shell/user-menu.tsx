"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleHelp, KeyRound, Keyboard, LogOut } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/hint";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { DensityToggle } from "@/components/theme/density-toggle";
import { UiToggle } from "@/components/theme/ui-toggle";
import { useUi } from "@/components/theme/density-provider";
import { useShortcuts } from "@/components/shell/shortcuts-host";
import { cn } from "@/lib/utils";
import { ChangePasswordDialog } from "@/components/shell/change-password-dialog";
import { useItsmAuth } from "@/lib/itsm/auth";
import { helpHome } from "@/lib/itsm/nav";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** `showDensity` — the Density and Interface (Classic / Modern) switches only affect
 * the agent app, so the end-user portal hides them (portal-shell passes false).
 * `showHelp` — the Help Center is agent/admin content, so the portal hides that link too. */
export function UserMenu({
  showDensity = true,
  showHelp = true,
  variant = "avatar",
  expanded = true,
  onOpenChange,
}: {
  showDensity?: boolean;
  showHelp?: boolean;
  /** "rail" (Modern main menu): a full-width row with the avatar + name/role (name
   *  hidden while the rail is folded) and the menu opening to the right. */
  variant?: "avatar" | "rail";
  expanded?: boolean;
  /** Told when the menu opens / closes — the Modern rail holds itself open meanwhile. */
  onOpenChange?: (open: boolean) => void;
}) {
  const { user, logout, org } = useItsmAuth();
  const { uiLocked } = useUi();
  const shortcuts = useShortcuts();
  const name = user?.full_name || user?.username || "Account";
  const roleName = user?.is_superuser ? "Administrator" : user?.role?.name ?? "";
  const [pwOpen, setPwOpen] = useState(false);
  // Show for local-password accounts; hide only for SSO users the server flags
  // (can_change_password === false). Absent (stale cache) still shows it — the
  // server rejects the change for SSO accounts anyway.
  const canChangePassword = user?.can_change_password !== false;
  // Shared with the Service Portal (no Density there) — list only what the menu has.
  const menuHelp = `${name}\nAccount menu: ${[
    "theme",
    showDensity && "density",
    showDensity && !uiLocked && "interface (Classic / Modern)",
    showHelp && "help",
    canChangePassword && "change password",
    "sign out",
  ]
    .filter(Boolean)
    .join(", ")}`;

  return (
    <>
      <DropdownMenu onOpenChange={onOpenChange}>
        {variant === "rail" ? (
          <Hint label={menuHelp} side="right" disabled={expanded}>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="flex h-11 w-full items-center gap-2.5 rounded-md px-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
            >
              {initialsOf(name)}
            </span>
            <span className={cn("min-w-0 flex-1 leading-tight", !expanded && "sr-only")} aria-hidden="true">
              <span className="block truncate text-sm font-medium text-foreground">{name}</span>
              {roleName ? <span className="block truncate text-xs text-muted-foreground">{roleName}</span> : null}
            </span>
          </DropdownMenuTrigger>
          </Hint>
        ) : (
        <Hint label={menuHelp} side="bottom" align="end">
        <DropdownMenuTrigger
          aria-label="Account menu"
          className="grid h-8 w-8 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span aria-hidden="true">{initialsOf(name)}</span>
        </DropdownMenuTrigger>
        </Hint>
        )}
        <DropdownMenuContent
          align="end"
          side={variant === "rail" ? "right" : undefined}
          className="w-60"
        >
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="truncate" title={name}>{name}</span>
              {roleName ? (
                <span className="text-xs font-normal text-muted-foreground">{roleName}</span>
              ) : null}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Theme</p>
            <ThemeToggle className="w-full justify-between" />
          </div>
          {showDensity ? (
            <div className="px-2 pb-1.5">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Density</p>
              <DensityToggle className="w-full" />
            </div>
          ) : null}
          {showDensity && !uiLocked ? (
            <div className="px-2 pb-1.5">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Interface</p>
              <UiToggle className="w-full" />
            </div>
          ) : null}
          <DropdownMenuSeparator />
          {showHelp ? (
            <DropdownMenuItem asChild>
              <Link href={helpHome(org)}>
                <CircleHelp className="h-4 w-4" aria-hidden="true" />
                Help Center
              </Link>
            </DropdownMenuItem>
          ) : null}
          {shortcuts ? (
            <DropdownMenuItem onSelect={() => shortcuts.openSheet()}>
              <Keyboard className="h-4 w-4" aria-hidden="true" />
              Keyboard shortcuts
              <span className="ml-auto font-mono text-xs text-muted-foreground" aria-hidden="true">?</span>
            </DropdownMenuItem>
          ) : null}
          {canChangePassword ? (
            <DropdownMenuItem onSelect={() => setPwOpen(true)}>
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              Change password
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={logout}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </>
  );
}
