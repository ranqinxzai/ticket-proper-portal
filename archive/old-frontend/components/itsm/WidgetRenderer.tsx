"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
import { dashAdminApi } from "@/lib/itsm/admin-api";
import type { Widget, WidgetData } from "@/lib/itsm/admin-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { BarChart, GaugePct, KpiCard, PieChart, TrendChart, type Series } from "./charts";

/** A ticket as returned in a ticket_list widget payload. */
type TicketLite = {
  id?: string;
  ticket_number?: string;
  summary?: string;
  priority?: string;
  status_name?: string;
};

/**
 * Fetches a widget's data payload from the backend and renders the right chart
 * for its `widget_type`, narrowing the `WidgetData` union by `.type`.
 *
 * `refreshKey` can be bumped by the parent to force a re-fetch (e.g. after a
 * config change) without remounting.
 */
export function WidgetRenderer({ widget, refreshKey }: { widget: Widget; refreshKey?: number }) {
  const [data, setData] = useState<WidgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    dashAdminApi
      .widgetData(widget.id)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ItsmApiError ? e.message : "Failed to load widget data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [widget.id, refreshKey]);

  if (loading) {
    return (
      <div className="grid min-h-[120px] place-items-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid min-h-[120px] place-items-center gap-1 px-2 text-center text-xs text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span>{error}</span>
      </div>
    );
  }

  if (!data) {
    return <div className="grid min-h-[120px] place-items-center text-xs text-muted-foreground">No data</div>;
  }

  return <WidgetBody data={data} />;
}

function WidgetBody({ data }: { data: WidgetData }) {
  switch (data.type) {
    case "kpi":
      return <KpiCard value={data.value ?? null} label={data.label ?? ""} />;

    case "pie":
      return <PieChart data={asSeries(data.series)} />;

    case "bar":
      return <BarChart data={asSeries(data.series)} />;

    case "trend": {
      const series = [
        { name: "Created", color: "#6366f1", points: (data.created ?? []) as { date: string; value: number }[] },
        { name: "Resolved", color: "#22c55e", points: (data.resolved ?? []) as { date: string; value: number }[] },
      ];
      return <TrendChart series={series} />;
    }

    case "sla":
      return (
        <div className="flex flex-col items-center gap-2">
          <GaugePct pct={data.compliance_pct ?? null} label="SLA compliance" />
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span className="text-emerald-600">Met: {data.met ?? 0}</span>
            <span className="text-red-600">Breached: {data.breached ?? 0}</span>
          </div>
        </div>
      );

    case "ticket_list": {
      const tickets = (data.tickets ?? []) as TicketLite[];
      if (tickets.length === 0) {
        return <div className="grid min-h-[80px] place-items-center text-xs text-muted-foreground">No tickets</div>;
      }
      return (
        <ul className="divide-y rounded-md border bg-white text-sm">
          {tickets.map((t, i) => (
            <li key={t.id ?? t.ticket_number ?? i} className="flex items-center gap-2 px-3 py-2">
              {t.ticket_number ? (
                <Link
                  href={`/tickets/${t.ticket_number}`}
                  className="shrink-0 font-mono text-xs text-indigo-600 hover:underline"
                >
                  {t.ticket_number}
                </Link>
              ) : (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">—</span>
              )}
              <span className="truncate text-muted-foreground" title={t.summary}>
                {t.summary ?? ""}
              </span>
            </li>
          ))}
        </ul>
      );
    }

    default:
      return <div className="grid min-h-[80px] place-items-center text-xs text-muted-foreground">Unsupported widget</div>;
  }
}

/** Coerce the loosely-typed WidgetData.series into the charts' Series type. */
function asSeries(series: WidgetData["series"]): Series {
  return (series ?? []).map((s) => ({ label: s.label, value: s.value, color: s.color }));
}
