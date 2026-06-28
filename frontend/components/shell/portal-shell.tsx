"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { portalHome } from "@/lib/itsm/nav";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand-mark";
import { UserMenu } from "./user-menu";

const NAV = [
  { path: "", label: "Home" },
  // Request Catalog is deferred — "Create Request" (workspace → project → form) is
  // the current intake path. The catalog routes remain; re-add the link when ready.
  { path: "/create-request", label: "Create Request" },
  { path: "/kb", label: "Knowledge Base" },
  { path: "/requests", label: "My Requests" },
  { path: "/approvals", label: "Approvals" },
];

/** Lighter chrome for the end-user Service Portal. Distinct, simpler UX. */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { org = "" } = useParams<{ org: string }>();
  const home = portalHome(org);
  const isActive = (href: string) =>
    href === home ? pathname === home : pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-background">
      <header role="banner" className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <Link
            href={home}
            className="flex items-center gap-2 rounded-md font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandMark showWordmark={false} />
            <span>Help Center</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
        <nav aria-label="Portal" className="mx-auto max-w-5xl px-4">
          <ul className="flex flex-wrap gap-1 pb-2">
            {NAV.map((item) => {
              const href = `${home}${item.path}`;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={isActive(href) ? "page" : undefined}
                    className={cn(
                      "inline-block rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive(href)
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
