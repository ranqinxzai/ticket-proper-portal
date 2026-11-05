"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { useUi } from "@/components/theme/density-provider";

/**
 * Two-column settings shell (helpdesk Configuration and Tenant Settings): the section
 * menu on the left, the page on the right. Classic renders today's markup unchanged.
 * Modern (2026-11-05, step B2) keeps the column — the main menu stays the rail — and
 * adds "← Back to …" on top of it.
 */
export function SettingsColumns({ nav, children }: { nav: React.ReactNode; children: React.ReactNode }) {
  const { ui } = useUi();
  if (ui !== "modern") {
    return (
      // Full width (the 1152px `max-w-6xl` cap was lifted 2026-10-14 so wide tables and
      // editors use the window; single-column forms keep their own max-w). `px-1` stays —
      // <main> already provides the gutter. The rail sticks under the header (`top-rail`
      // = --header-h + --main-py, density-aware).
      <div className="grid w-full gap-6 px-1 py-2 compact:gap-4 compact:py-0 lg:grid-cols-[220px_minmax(0,1fr)] compact:lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-rail lg:self-start">{nav}</aside>
        <div className="min-w-0">{children}</div>
      </div>
    );
  }
  return (
    <div className="grid w-full gap-5 lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="space-y-3 lg:sticky lg:top-rail lg:self-start">
        <BackLink />
        {nav}
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const WS_SETTINGS = /^(\/t\/[^/]+\/agent\/w\/[^/]+)\/settings/;
const ADMIN = /^(\/t\/[^/]+\/agent)\/admin/;

function BackLink() {
  const pathname = usePathname();
  const ws = pathname.match(WS_SETTINGS);
  const admin = pathname.match(ADMIN);
  const target = ws ? { href: `${ws[1]}/dashboard`, label: "Back to helpdesk" } : admin ? { href: admin[1], label: "Back to home" } : null;
  if (!target) return null;
  return (
    <Link
      href={target.href}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      {target.label}
    </Link>
  );
}
