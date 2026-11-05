"use client";

import { useEffect, useState } from "react";
import {
  CalendarX2,
  FilePlus,
  FileSpreadsheet,
  FileX,
  History,
  Link2,
  Loader2,
  Pencil,
  PlusCircle,
  Trash2,
  Unlink,
} from "lucide-react";

import { InfoTip } from "@/components/ui/info-tip";
import { assetsApi } from "@/lib/itsm/assets-api";
import type { AssetEvent } from "@/lib/itsm/assets-types";
import { ASSET_HELP } from "@/lib/itsm/help/assets";
import { cn } from "@/lib/utils";

import { fmtDateTime, userLabel } from "./asset-utils";

const ACTION_ICON: Record<AssetEvent["action"], typeof History> = {
  created: PlusCircle,
  imported: FileSpreadsheet,
  updated: Pencil,
  auto_expired: CalendarX2,
  deleted: Trash2,
  ticket_linked: Link2,
  ticket_unlinked: Unlink,
  document_added: FilePlus,
  document_removed: FileX,
};

function EventItem({ ev }: { ev: AssetEvent }) {
  const Icon = ACTION_ICON[ev.action] ?? History;
  const who = ev.actor ? userLabel(ev.actor) : "System";
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span
        className={cn(
          "relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border bg-card",
          ev.action === "auto_expired" && "text-amber-700 dark:text-amber-400",
          ev.action === "deleted" && "text-destructive",
        )}
        aria-hidden="true"
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm">
          <span className="font-medium">{ev.action_label}</span>
          <span className="text-muted-foreground"> · {who}</span>
        </p>
        <p className="text-xs text-muted-foreground">{fmtDateTime(ev.created_at)}</p>
        {ev.changes?.length ? (
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {ev.changes.map((c, i) => (
              <li key={`${c.field}-${i}`} className="break-words">
                <span className="font-medium">{c.label}:</span>{" "}
                {c.dropped ? (
                  <>
                    <span className="text-muted-foreground line-through">{c.old ?? "—"}</span>{" "}
                    <span className="text-muted-foreground">removed (no longer applies)</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground">{c.old ?? "—"}</span>
                    <span className="text-muted-foreground" aria-hidden="true"> → </span>
                    <span className="sr-only"> changed to </span>
                    <span>{c.new ?? "—"}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {ev.note ? <p className="mt-1 text-xs text-muted-foreground">{ev.note}</p> : null}
      </div>
    </li>
  );
}

/** The asset's append-only history (newest first, up to 200 events). */
export function AssetHistory({ assetId, refreshKey }: { assetId: string; refreshKey?: number | string }) {
  const [events, setEvents] = useState<AssetEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    assetsApi
      .history(assetId)
      .then((ev) => alive && setEvents(ev))
      .catch(() => {
        if (!alive) return;
        setEvents([]);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [assetId, refreshKey]);

  return (
    <section className="rounded-xl border bg-card shadow-soft">
      <header className="flex items-center gap-2 border-b px-5 py-3.5 compact:px-3.5 compact:py-2">
        <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">History</h2>
        <InfoTip label="About History">{ASSET_HELP.history}</InfoTip>
      </header>
      <div className="p-5 compact:p-3.5">
        {events === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading history…
          </p>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">Could not load the history.</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <ol className="relative before:absolute before:bottom-2 before:left-3.5 before:top-2 before:w-px before:bg-border">
            {events.map((ev) => (
              <EventItem key={ev.id} ev={ev} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
