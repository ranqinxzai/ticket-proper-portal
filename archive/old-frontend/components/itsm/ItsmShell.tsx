"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Ticket, ListChecks, LayoutDashboard, BarChart3, ShieldCheck, Plus, Search, Menu, X, LogOut,
  Home, Check, ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useItsmAuth } from "@/lib/itsm/auth";
import { useSelectedHelpdesk } from "@/lib/itsm/helpdesk";
import { NotificationBell } from "./NotificationBell";
import { initials } from "./ticket-bits";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Ticket;
  /** Show only when this returns true. */
  visible?: (ctx: { isSupervisor: boolean; hasAdmin: boolean }) => boolean;
};

const NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/queues", label: "Queues", icon: ListChecks },
  { href: "/tickets", label: "Tickets", icon: Ticket },
  { href: "/dashboards", label: "Dashboards", icon: LayoutDashboard },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  {
    href: "/admin",
    label: "Admin",
    icon: ShieldCheck,
    visible: ({ isSupervisor, hasAdmin }) => isSupervisor || hasAdmin,
  },
];

export function ItsmShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, hasPerm, isSupervisor } = useItsmAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");

  const hasAdmin = hasPerm("itsm.admin.roles", "read");
  const navItems = NAV.filter((n) => (n.visible ? n.visible({ isSupervisor, hasAdmin }) : true));

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    router.push(q ? `/queues?search=${encodeURIComponent(q)}` : "/queues");
  }

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex-1 space-y-1 p-3">
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-slate-300 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const Brand = () => (
    <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5 shrink-0">
      <div className="rounded-lg bg-white/10 p-1.5">
        <Ticket className="h-4 w-4" />
      </div>
      <div>
        <div className="text-sm font-semibold leading-none">One Helpdesk</div>
        <div className="mt-1 text-[10px] text-slate-400">Service Management</div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-screen">
        <Brand />
        <NavLinks />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button aria-label="Close menu" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative z-10 flex h-full w-[80vw] max-w-[280px] flex-col bg-sidebar text-sidebar-foreground shadow-2xl">
            <Brand />
            <NavLinks onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top header */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-white px-3 sm:px-4">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="-ml-1 rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <form onSubmit={submitSearch} className="relative hidden max-w-md flex-1 sm:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets…"
              className="h-9 pl-8"
            />
          </form>
          <div className="flex-1 sm:hidden" />

          <HelpdeskSwitcher />

          <Button asChild size="sm" className="gap-1.5">
            <Link href="/tickets/new">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Create</span>
            </Link>
          </Button>

          <NotificationBell />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-md p-1 hover:bg-muted" aria-label="User menu">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                  {initials(user?.full_name || user?.username)}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="truncate text-sm font-medium">{user?.full_name || user?.username}</div>
                <div className="truncate text-xs font-normal text-muted-foreground">
                  {user?.email || user?.role?.name}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden p-3 sm:p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

/** Header dropdown to pick the active helpdesk (scopes the whole UI). Module-scope
 * (not nested in ItsmShell) so it never remounts on a parent re-render. */
function HelpdeskSwitcher() {
  const router = useRouter();
  const { helpdesks, selected, setSelected } = useSelectedHelpdesk();
  if (helpdesks.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-9 max-w-[180px] items-center gap-2 rounded-md border px-2.5 text-sm hover:bg-muted"
          aria-label="Switch helpdesk"
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: selected?.color || "#6366f1" }}
          />
          <span className="truncate font-medium">{selected?.name ?? "Select helpdesk"}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Helpdesk</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {helpdesks.map((h) => (
          <DropdownMenuItem
            key={h.id}
            onClick={() => {
              setSelected(h.key);
              router.push("/home");
            }}
            className="gap-2"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: h.color || "#6366f1" }}
            />
            <span className="flex-1 truncate">{h.name}</span>
            {selected?.key === h.key && <Check className="h-4 w-4 text-indigo-600" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
