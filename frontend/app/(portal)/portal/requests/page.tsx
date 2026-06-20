"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { StatusBadge } from "@/components/tickets/status-badge";
import { portalApi } from "@/lib/itsm/api";
import type { PortalTicket } from "@/lib/itsm/types";

function when(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

export default function MyRequestsPage() {
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi
      .requests()
      .then(setTickets)
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track everything you’ve raised.</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tickets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          You haven’t raised any requests yet.{" "}
          <Link href="/portal/catalog" className="text-primary hover:underline">
            Browse the catalog
          </Link>
          .
        </div>
      ) : (
        <ul className="space-y-3">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/portal/requests/${t.id}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="font-mono text-xs text-muted-foreground">{t.ticket_number}</span>
                <span className="font-medium">{t.summary}</span>
                <span className="ml-auto flex items-center gap-3">
                  <StatusBadge name={t.status_name} category={t.status_category} color={t.status_color} />
                  <span className="text-xs text-muted-foreground">{when(t.created_at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
