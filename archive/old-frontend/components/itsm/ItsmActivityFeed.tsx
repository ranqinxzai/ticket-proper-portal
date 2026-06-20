"use client";

import { useEffect, useState } from "react";
import { Loader2, Activity as ActivityIcon } from "lucide-react";
import { ticketsApi } from "@/lib/itsm/api";
import type { ActivityEvent } from "@/lib/itsm/types";
import { relTime } from "./ticket-bits";

export function ItsmActivityFeed({ ticketId }: { ticketId: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    ticketsApi
      .activity(ticketId)
      .then((rows) => !cancelled && setEvents(rows))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load activity"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
      </div>
    );
  }
  if (error) return <div className="py-6 text-center text-sm text-destructive">{error}</div>;
  if (events.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No history yet.</div>;
  }

  return (
    <ol className="relative ml-3 space-y-4 border-l border-muted pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[27px] grid h-5 w-5 place-items-center rounded-full bg-indigo-500 text-white ring-4 ring-white">
            <ActivityIcon className="h-3 w-3" />
          </span>
          <div className="text-sm leading-snug">{renderSummary(e)}</div>
          <div className="mt-0.5 text-xs text-muted-foreground" title={e.created_at}>{relTime(e.created_at)}</div>
        </li>
      ))}
    </ol>
  );
}

function renderSummary(e: ActivityEvent) {
  const actor = e.actor?.full_name || e.actor?.username || e.actor_name || "Someone";
  if (e.summary) {
    return (
      <span>
        <strong className="font-medium">{actor}</strong> — {e.summary}
      </span>
    );
  }
  const verb = e.verb || e.action?.replace(/_/g, " ") || "updated the ticket";
  if (e.field && (e.from_value || e.to_value)) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <strong className="font-medium">{actor}</strong>
        <span className="text-muted-foreground">changed {e.field}</span>
        {e.from_value && <Chip>{e.from_value}</Chip>}
        <span className="text-muted-foreground">→</span>
        {e.to_value && <Chip>{e.to_value}</Chip>}
      </span>
    );
  }
  return (
    <span>
      <strong className="font-medium">{actor}</strong> {verb}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded border bg-muted px-1.5 py-0.5 text-xs">{children}</span>;
}
