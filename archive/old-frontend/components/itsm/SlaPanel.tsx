"use client";

import { useEffect, useState } from "react";
import { Loader2, Pause, CheckCircle2, AlertTriangle } from "lucide-react";
import { ticketsApi } from "@/lib/itsm/api";
import type { SlaEntry } from "@/lib/itsm/types";
import { humanizeMs, slaRag } from "./ticket-bits";
import { cn } from "@/lib/utils";

/** A live-ticking SLA countdown panel. Re-fetches once; counts down client-side. */
export function SlaPanel({ ticketId, compact }: { ticketId: string; compact?: boolean }) {
  const [entries, setEntries] = useState<SlaEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [, force] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ticketsApi
      .sla(ticketId)
      .then((rows) => !cancelled && setEntries(rows))
      .catch(() => !cancelled && setEntries([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  // Tick once per second so countdowns stay live.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading SLA…
      </div>
    );
  }
  if (!entries || entries.length === 0) {
    return <div className="py-3 text-sm text-muted-foreground">No SLA targets for this ticket.</div>;
  }

  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      {entries.map((e) => (
        <SlaRow key={e.metric} entry={e} compact={compact} />
      ))}
    </div>
  );
}

function SlaRow({ entry, compact }: { entry: SlaEntry; compact?: boolean }) {
  const { rag, label } = slaRag(entry);
  const met = entry.state?.toLowerCase() === "met" || entry.state?.toLowerCase() === "completed";

  let countdown = label;
  if (!entry.paused && !entry.breached && !met && entry.due_at) {
    const ms = new Date(entry.due_at).getTime() - Date.now();
    countdown = ms <= 0 ? `Overdue ${humanizeMs(-ms)}` : `${humanizeMs(ms)} left`;
  }

  const ragColor =
    rag === "red" ? "text-rose-600" : rag === "amber" ? "text-amber-600" : rag === "green" ? "text-emerald-600" : "text-slate-500";

  return (
    <div className={cn("flex items-center justify-between rounded-md border px-3 py-2", compact && "px-2.5 py-1.5")}>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{entry.metric_name || entry.metric}</div>
        {!compact && entry.target_minutes != null && (
          <div className="text-xs text-muted-foreground">Target {humanizeMs(entry.target_minutes * 60000)}</div>
        )}
      </div>
      <div className={cn("flex items-center gap-1.5 text-sm font-medium", ragColor)}>
        {entry.paused ? (
          <><Pause className="h-3.5 w-3.5" /> Paused</>
        ) : met ? (
          <><CheckCircle2 className="h-3.5 w-3.5" /> Met</>
        ) : entry.breached ? (
          <><AlertTriangle className="h-3.5 w-3.5" /> Breached</>
        ) : (
          <span>{countdown}</span>
        )}
      </div>
    </div>
  );
}
