"use client";

import { BookOpen, CheckSquare, ShoppingBag, Ticket } from "lucide-react";

import { useItsmAuth } from "@/lib/itsm/auth";

const FEATURES = [
  {
    icon: ShoppingBag,
    title: "Request Catalog",
    body: "Browse and order standard services — new hardware, access, onboarding.",
  },
  {
    icon: BookOpen,
    title: "Knowledge Base",
    body: "Search how-to articles and solutions before you raise a ticket.",
  },
  { icon: Ticket, title: "My Requests", body: "Track the status of everything you’ve raised." },
  { icon: CheckSquare, title: "Approvals", body: "Review and approve requests awaiting your sign-off." },
];

/** End-user portal home. Catalog / KB / Requests / Approvals land in P4–P6. */
export default function PortalHome() {
  const { user } = useItsmAuth();
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
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm"
            >
              <div className="flex items-center gap-2 font-medium">
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"
                >
                  <Icon className="h-4 w-4" />
                </span>
                {title}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Coming soon
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
