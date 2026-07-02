"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Loader2, Search } from "lucide-react";

import { ticketsApi } from "@/lib/itsm/api";
import type { TicketListItem } from "@/lib/itsm/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Debounced ticket picker backed by GET /tickets/?search= (helpdesk/project scoped
 *  server-side, so it only ever surfaces tickets the agent may link to — incidents
 *  AND requests alike). `excludeIds` hides the current ticket and already-linked
 *  targets. Resets after a pick so it reads as an "add" affordance. */
export function TicketSearchCombobox({
  onSelect,
  excludeIds = [],
  disabled,
  placeholder = "Search tickets…",
}: {
  onSelect: (ticket: TicketListItem) => void;
  excludeIds?: string[];
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLoading(true);
      ticketsApi
        .list({ search: q, page_size: 25 })
        .then(setRows)
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, open]);

  const exclude = new Set(excludeIds);
  const visible = rows.filter((t) => !exclude.has(t.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn("h-9 w-full justify-between font-normal text-muted-foreground")}
        >
          <span className="truncate">{placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by number or summary…"
            className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
          />
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
        <ul className="max-h-64 overflow-auto py-1">
          {visible.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {loading ? "Searching…" : "No matching tickets."}
            </li>
          ) : (
            visible.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(t);
                    setOpen(false);
                    setQ("");
                  }}
                  className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{t.ticket_number}</span>
                    <span className="truncate text-xs text-muted-foreground">{t.status_name}</span>
                  </span>
                  <span className="w-full truncate">{t.summary}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
