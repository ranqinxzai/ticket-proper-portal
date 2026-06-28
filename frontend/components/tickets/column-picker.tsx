"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Columns3, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { DEFAULT_QUEUE_COLUMNS, QUEUE_COLUMN_MAP, orderedColumnKeys } from "./queue-columns";

const buildOrder = orderedColumnKeys;

/** Per-agent column picker — toggle visibility + reorder. The Summary column is
 *  pinned so the table always has its primary text column. `onChange` receives
 *  the new ordered visible list; `onReset` clears the agent's override. */
export function ColumnPicker({
  columns,
  onChange,
  onReset,
}: {
  columns: string[];
  onChange: (next: string[]) => void;
  onReset: () => void;
}) {
  const [order, setOrder] = useState<string[]>(() => buildOrder(columns));
  const [vis, setVis] = useState<Set<string>>(() => new Set(columns));

  useEffect(() => {
    setOrder(buildOrder(columns));
    setVis(new Set(columns));
  }, [columns]);

  const emit = (nextOrder: string[], nextVis: Set<string>) =>
    onChange(nextOrder.filter((k) => nextVis.has(k)));

  const toggle = (key: string) => {
    if (key === "summary") return; // keep the primary column
    const next = new Set(vis);
    next.has(key) ? next.delete(key) : next.add(key);
    setVis(next);
    emit(order, next);
  };

  const move = (key: string, dir: -1 | 1) => {
    const i = order.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = order.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    emit(next, vis);
  };

  const isDefault =
    JSON.stringify(order.filter((k) => vis.has(k))) === JSON.stringify(DEFAULT_QUEUE_COLUMNS);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="h-4 w-4" aria-hidden="true" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Columns
          </span>
          <button
            type="button"
            onClick={onReset}
            disabled={isDefault}
            className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reset
          </button>
        </div>
        <ul className="max-h-80 overflow-auto">
          {order.map((key, idx) => {
            const def = QUEUE_COLUMN_MAP[key];
            if (!def) return null;
            const checked = vis.has(key);
            return (
              <li
                key={key}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={key === "summary"}
                  onChange={() => toggle(key)}
                  aria-label={`Show ${def.label}`}
                  className="h-4 w-4"
                />
                <span className={cn("flex-1 text-sm", !checked && "text-muted-foreground")}>
                  {def.label}
                </span>
                <button
                  type="button"
                  onClick={() => move(key, -1)}
                  disabled={idx === 0}
                  aria-label={`Move ${def.label} up`}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => move(key, 1)}
                  disabled={idx === order.length - 1}
                  aria-label={`Move ${def.label} down`}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
