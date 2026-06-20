"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, Users, Boxes, GitBranch, Timer, Bell, ListFilter, Mail, Building2 } from "lucide-react";
import { useItsmAuth } from "@/lib/itsm/auth";

const ADMIN_AREAS = [
  { icon: Building2, title: "Helpdesks", body: "Define department workspaces and their members. Each owns its own Incident + Request.", href: "/admin/helpdesks" },
  { icon: GitBranch, title: "Workflows", body: "Visual builder: statuses, transitions, conditions, post-functions.", href: "/admin/workflows" },
  { icon: Boxes, title: "Fields & Layouts", body: "Custom fields and the per-project layout designer.", href: "/admin/fields" },
  { icon: Timer, title: "SLA Policies", body: "Business calendars, per-priority targets, and escalations.", href: "/admin/sla" },
  { icon: Bell, title: "Notifications", body: "Notification schemes, rules, and email templates.", href: "/admin/notifications" },
  { icon: Mail, title: "Email Channel", body: "Connect mailboxes; turn inbound email into tickets & comments.", href: "/admin/email" },
  { icon: Users, title: "Roles & Permissions", body: "Define roles and the per-module CRUD matrix.", href: null },
  { icon: ListFilter, title: "Saved Filters", body: "Shared queues and saved-filter management.", href: null },
];

export default function AdminPage() {
  const router = useRouter();
  const { loading, hasPerm, isSupervisor } = useItsmAuth();
  const allowed = isSupervisor || hasPerm("itsm.admin.roles", "read") || hasPerm("itsm.workflows", "read");

  useEffect(() => {
    if (!loading && !allowed) router.replace("/queues");
  }, [loading, allowed, router]);

  if (loading || !allowed) {
    return <div className="grid place-items-center py-20 text-sm text-muted-foreground">Checking access…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-indigo-500" />
        <h1 className="text-xl font-semibold">Administration</h1>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ADMIN_AREAS.map(({ icon: Icon, title, body, href }) => {
          const inner = (
            <>
              <Icon className="mb-2 h-5 w-5 text-indigo-500" />
              <div className="font-medium">{title}</div>
              <div className="mt-1 text-sm text-muted-foreground">{body}</div>
              {!href && (
                <span className="mt-3 inline-block rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  Coming soon
                </span>
              )}
            </>
          );
          return href ? (
            <Link key={title} href={href} className="rounded-lg border bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm">
              {inner}
            </Link>
          ) : (
            <div key={title} className="rounded-lg border bg-white p-4 opacity-70">{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
