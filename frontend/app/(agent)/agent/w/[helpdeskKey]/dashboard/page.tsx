"use client";

import Link from "next/link";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";

export default function WorkspaceDashboard() {
  const { helpdeskKey, projects, loading } = useWorkspace();

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Dashboard</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/agent/w/${helpdeskKey}/p/${p.key}`}
                className="block rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{p.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.key}</span>
                </div>
                <p className="mt-1 text-sm capitalize text-muted-foreground">
                  {p.project_type.replace("_", " ")}
                </p>
                {typeof p.open_ticket_count === "number" ? (
                  <p className="mt-3 text-2xl font-semibold">{p.open_ticket_count}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Live KPIs, SLA widgets and charts arrive with the dashboard builder (P7).
      </p>
    </div>
  );
}
