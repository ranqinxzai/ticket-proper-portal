"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { slaApi } from "@/lib/itsm/api";
import { slaTooltip } from "@/lib/itsm/help/sla";
import { TICKET_HELP } from "@/lib/itsm/help/ticket";
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
  if (e.paused) return e.pause_reason === "approval" ? "Paused — awaiting approval" : "Paused";
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
    // Same card + heading treatment as the other detail side-rail cards (2026-10-14).
    <section aria-label="SLA" className="rounded-xl border bg-card p-4 text-sm shadow-soft compact:p-3">
      <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground compact:mb-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        SLA
        <InfoTip label="What are these SLA clocks?" className="normal-case tracking-normal">
          {`${TICKET_HELP.slaPanel}\n${TICKET_HELP.slaDot}`}
        </InfoTip>
      </h2>
      <ul className="space-y-2 compact:space-y-1.5">
        {entries.map((e) => (
          <li key={e.metric} className="flex items-center justify-between gap-2">
            {/* Hover / focus: what the metric measures, its state, due time and target. */}
            <Hint label={slaTooltip(e, e.metric)} side="left">
              <span
                tabIndex={0}
                className="flex min-w-0 cursor-help items-center gap-2 rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", RAG_DOT[e.rag])} />
                {e.metric_name}
              </span>
            </Hint>
            <span className={cn("font-medium", e.breached && "text-destructive")}>
              {statusLabel(e)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
