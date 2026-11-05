"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Ticket } from "lucide-react";

import { PriorityTag } from "@/components/tickets/priority-tag";
import { StatusBadge } from "@/components/tickets/status-badge";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { assetsApi } from "@/lib/itsm/assets-api";
import type { AssetTicket, AssetTicketsResponse } from "@/lib/itsm/assets-types";
import { ASSET_LINK_HELP } from "@/lib/itsm/help/assets";
import type { Priority, StatusCategory } from "@/lib/itsm/types";

const PREVIEW = 10;
const CATEGORIES: StatusCategory[] = ["todo", "in_progress", "done"];

/** "12 Nov 2026" in the viewer's time zone. */
function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function TicketRow({ t, org }: { t: AssetTicket; org: string }) {
  const href =
    t.helpdesk_key && t.project_key ? `/t/${org}/agent/w/${t.helpdesk_key}/p/${t.project_key}/${t.ticket_number}` : null;
  const category = (CATEGORIES as string[]).includes(t.status_category ?? "")
    ? (t.status_category as StatusCategory)
    : "todo";
  const meta = [t.requestor, `Created ${day(t.created_at)}`].filter(Boolean).join(" · ");
  return (
    <li className="space-y-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2">
        {href ? (
          <Link href={href} className="shrink-0 font-mono text-xs font-medium text-primary hover:underline">
            {t.ticket_number}
          </Link>
        ) : (
          <span className="shrink-0 font-mono text-xs font-medium">{t.ticket_number}</span>
        )}
        {t.is_primary ? (
          <Hint label={ASSET_LINK_HELP.ticketsPrimary} wrap>
            <span className="inline-flex shrink-0 items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide text-primary-ink">
              Primary
            </span>
          </Hint>
        ) : null}
        <span className="ml-auto shrink-0">
          <PriorityTag priority={t.priority as Priority} />
        </span>
      </div>
      <p className="truncate text-sm" title={t.summary}>
        {t.summary || "—"}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {t.status_name ? <StatusBadge name={t.status_name} category={category} color={t.status_color} /> : null}
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={meta}>
          {meta}
        </span>
      </div>
    </li>
  );
}

/** Tickets raised against this asset (the ones the viewer can open), open first. */
export function AssetTickets({ assetId, org }: { assetId: string; org: string }) {
  const [data, setData] = useState<AssetTicketsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    setShowAll(false);
    assetsApi
      .tickets(assetId)
      .then((d) => alive && setData(d))
      .catch(() => {
        if (!alive) return;
        setData({ count: 0, open_count: 0, results: [] });
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [assetId]);

  const rows = data ? (showAll ? data.results : data.results.slice(0, PREVIEW)) : [];

  return (
    <section className="rounded-xl border bg-card shadow-soft">
      <header className="flex items-center gap-2 border-b px-5 py-3.5 compact:px-3.5 compact:py-2">
        <Ticket className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Tickets</h2>
        <InfoTip label="About linked tickets">{ASSET_LINK_HELP.ticketsCard}</InfoTip>
        {data && !failed ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {data.count} {data.count === 1 ? "ticket" : "tickets"} · {data.open_count} open
          </span>
        ) : null}
      </header>
      <div className="p-5 compact:p-3.5">
        {data === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading tickets…
          </p>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">Could not load the tickets.</p>
        ) : data.results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tickets are linked to this asset yet.</p>
        ) : (
          <>
            <ul className="divide-y">
              {rows.map((t) => (
                <TicketRow key={t.id} t={t} org={org} />
              ))}
            </ul>
            {data.results.length > PREVIEW ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 w-full"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "Show fewer" : `Show all ${data.results.length}`}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
