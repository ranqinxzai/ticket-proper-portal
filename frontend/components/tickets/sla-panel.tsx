"use client";

import { useEffect, useState } from "react";

import { slaApi } from "@/lib/itsm/api";
import { cn } from "@/lib/utils";
import type { RagState, SlaEntry } from "@/lib/itsm/types";

const RAG_DOT: Record<RagState, string> = {
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-destructive",
  grey: "bg-muted-foreground",
};

function remaining(mins: number | null) {
  if (mins === null) return "—";
  const overdue = mins < 0;
  const m = Math.abs(Math.round(mins));
  const h = Math.floor(m / 60);
  const txt = h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  return overdue ? `${txt} overdue` : `${txt} left`;
}

/** Label for a metric. A *stopped* clock (the response was given / the ticket
 * resolved) shows its final outcome — Met / Breached — never a live "overdue"
 * countdown, which would imply the metric is still ticking and unmet. Only a
 * still-running clock shows the remaining/overdue time. */
function statusLabel(e: SlaEntry) {
  if (e.paused) return "Paused";
  if (e.state === "met") return "Met";
  if (e.state === "breached") return "Breached";
  if (e.state === "stopped") return "Stopped";
  return remaining(e.remaining_minutes);
}

/** SLA countdown panel — renders nothing if the ticket has no SLA trackers. */
export function SlaPanel({ ticketId }: { ticketId: string }) {
  const [entries, setEntries] = useState<SlaEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    slaApi
      .forTicket(ticketId)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoaded(true));
  }, [ticketId]);

  if (!loaded || entries.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-4 text-sm">
      <h2 className="mb-2 text-sm font-semibold">SLA</h2>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.metric} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", RAG_DOT[e.rag])} />
              {e.metric_name}
            </span>
            <span className={cn("font-medium", e.breached && "text-destructive")}>
              {statusLabel(e)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
