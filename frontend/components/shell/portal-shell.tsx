"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";
import { UserMenu } from "./user-menu";

const NAV = [
  { href: "/portal", label: "Home" },
  { href: "/portal/catalog", label: "Request Catalog" },
  { href: "/portal/kb", label: "Knowledge Base" },
  { href: "/portal/requests", label: "My Requests" },
  { href: "/portal/approvals", label: "Approvals" },
];

/** Lighter chrome for the end-user Service Portal. Distinct, simpler UX. */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/portal" ? pathname === "/portal" : pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-background">
      <header role="banner" className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <Link
            href="/portal"
            className="flex items-center gap-2 rounded-md font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground"
            >
              <Sparkles className="h-4 w-4" />
            </span>
            <span>Help Center</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
        <nav aria-label="Portal" className="mx-auto max-w-5xl px-4">
          <ul className="flex flex-wrap gap-1 pb-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "inline-block rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive(item.href)
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
