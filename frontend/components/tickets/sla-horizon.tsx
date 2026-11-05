"use client";

import { useEffect, useState } from "react";

import { Hint } from "@/components/ui/hint";
import { slaTooltip } from "@/lib/itsm/help/sla";
import type { QueueSlaEntry, RagState } from "@/lib/itsm/types";
import { cn } from "@/lib/utils";
import { RAG_BAR, remainingLabel } from "./queue-columns";

/**
 * The resolution clock as one horizon bar under the docked ticket's title (Modern
 * step B4): "Resolution SLA ▬▬▬── 2h 10m left". Same figures and colours as the
 * queue's SLA column (`percent_used` in business time, server RAG; a running clock past
 * its due time is full and red at once). The time left is wall-clock to the due time while
 * the target is business hours, so the two are not shown side by side (the tooltip has
 * the target). Renders nothing when the ticket has no clock.
 */
export function SlaHorizon({ entry, className }: { entry?: QueueSlaEntry | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(h);
  }, []);
  if (!entry) return null;
  const done = entry.state === "met" || entry.state === "breached" || entry.state === "stopped";
  const overdueNow = entry.state === "running" && now > new Date(entry.due_at).getTime();
  const pct = overdueNow ? 100 : Math.min(100, Math.max(0, entry.percent_used ?? 0));
  const rag: RagState = overdueNow ? "red" : entry.rag;
  const label = entry.paused
    ? "Paused"
    : done
      ? entry.breached
        ? "Breached"
        : "Met"
      : remainingLabel(entry.due_at, now);
  return (
    <Hint label={slaTooltip(entry, "resolution", { withBands: true })} wrap className="block">
      <div className={cn("flex items-center gap-3 text-xs", className)}>
        <span className="shrink-0 font-medium text-muted-foreground">Resolution SLA</span>
        <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className={cn("h-full rounded-full transition-all", RAG_BAR[rag])} style={{ width: `${Math.round(pct)}%` }} />
        </div>
        <span
          className={cn(
            "shrink-0 tabular-nums",
            entry.breached || overdueNow ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      </div>
    </Hint>
  );
}
