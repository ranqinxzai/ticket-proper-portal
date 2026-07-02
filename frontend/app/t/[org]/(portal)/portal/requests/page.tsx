"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Inbox, RefreshCw } from "lucide-react";

import { StatusBadge } from "@/components/tickets/status-badge";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { portalApi } from "@/lib/itsm/api";
import { useLivePoll } from "@/lib/itsm/use-live-poll";
import type { PortalTicket } from "@/lib/itsm/types";

function when(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

export default function MyRequestsPage() {
  const { org = "" } = useParams<{ org: string }>();
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  const [loading, setLoading] = useState(true);
  // A background refresh that arrives while the requestor is scrolled / hovering a row
  // is staged behind a "Refresh" pill instead of swapping rows underneath them.
  const [pending, setPending] = useState<PortalTicket[] | null>(null);
  const listHoverRef = useRef(false);

  const fetchSeq = useRef(0);
  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const seq = ++fetchSeq.current;
    if (!silent) setLoading(true);
    try {
      const list = await portalApi.requests();
      if (seq !== fetchSeq.current) return;
      if (silent) {
        const safe =
          !listHoverRef.current && (typeof window === "undefined" || window.scrollY < 40);
        if (safe) {
          setTickets(list);
          setPending(null);
        } else {
          setPending(list);
        }
      } else {
        setTickets(list);
        setPending(null);
      }
    } catch {
      if (seq !== fetchSeq.current) return;
      if (!silent) setTickets([]);
    } finally {
      if (seq === fetchSeq.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Silent live refresh — poll the cheap requestor-scoped pulse token.
  useLivePoll({
    key: "my-requests",
    pulse: async () => (await portalApi.requestsPulse()).version,
    onChange: () => load({ silent: true }),
  });

  const applyPending = () => {
    if (!pending) return;
    setTickets(pending);
    setPending(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-6">
      {pending ? (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
          <button
            type="button"
            onClick={applyPending}
            className="inline-flex items-center gap-1.5 rounded-full border bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {pending.length > tickets.length
              ? `${pending.length - tickets.length} new · Refresh`
              : "Updated · Refresh"}
          </button>
        </div>
      ) : null}

      <PageHeader title="My Requests" description="Track everything you’ve raised." />

      {loading ? (
        <ul className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-[68px] w-full rounded-xl" />
            </li>
          ))}
        </ul>
      ) : tickets.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No requests yet"
          description="You haven’t raised any requests yet."
          action={
            <Button asChild variant="outline">
              <Link href={`/t/${org}/portal/catalog`}>Browse the catalog</Link>
            </Button>
          }
        />
      ) : (
        <ul
          className="space-y-3"
          onMouseEnter={() => (listHoverRef.current = true)}
          onMouseLeave={() => (listHoverRef.current = false)}
        >
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/t/${org}/portal/requests/${t.ticket_number}`}
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-soft transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
