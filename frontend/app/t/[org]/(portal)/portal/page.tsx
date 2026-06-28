"use client";

import Link from "next/link";
import { BookOpen, CheckSquare, PlusCircle, Ticket } from "lucide-react";

import { useItsmAuth } from "@/lib/itsm/auth";

const FEATURES = [
  {
    path: "/create-request",
    icon: PlusCircle,
    title: "Create Request",
    body: "Pick a workspace and raise a new request on the right form.",
  },
  {
    path: "/kb",
    icon: BookOpen,
    title: "Knowledge Base",
    body: "Search how-to articles and solutions before you raise a ticket.",
  },
  { path: "/requests", icon: Ticket, title: "My Requests", body: "Track the status of everything you’ve raised." },
  { path: "/approvals", icon: CheckSquare, title: "Approvals", body: "Review and approve requests awaiting your sign-off." },
];

export default function PortalHome() {
  const { user, org } = useItsmAuth();
  const firstName = (user?.full_name || user?.username || "there").split(" ")[0];

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Hi {firstName}, how can we help?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Raise a request, track its progress, or find an answer in the knowledge base.
        </p>
      </section>

      <section aria-label="What you can do here">
        <ul className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ path, icon: Icon, title, body }) => (
            <li key={title}>
              <Link
                href={`/t/${org}/portal${path}`}
                className="flex h-full flex-col rounded-xl border bg-card p-5 text-card-foreground shadow-sm transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-2 font-medium">
                  <span
                    aria-hidden="true"
                    className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  {title}
                </span>
                <span className="mt-2 text-sm text-muted-foreground">{body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
