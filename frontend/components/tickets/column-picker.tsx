"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Columns3, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { DEFAULT_QUEUE_COLUMNS, QUEUE_COLUMNS, decodeColumnLayout, encodeColumnLayout } from "./queue-columns";

type ColumnMeta = { key: string; label: string; description?: string };

/** The static column universe (single-project queue default). */
const STATIC_UNIVERSE: ColumnMeta[] = QUEUE_COLUMNS.map((c) => ({
  key: c.key,
  label: c.label,
  description: c.description,
}));

/** Ordered key list over a given universe: the visible keys (in their order) first,
 *  then every remaining universe key in its registry order. */
function orderOver(visible: string[], universe: ColumnMeta[]): string[] {
  const valid = new Set(universe.map((c) => c.key));
  const known = visible.filter((k) => valid.has(k));
  const seen = new Set(known);
  return [...known, ...universe.map((c) => c.key).filter((k) => !seen.has(k))];
}

/** Per-agent column picker — toggle visibility + reorder. The pinned column
 *  (Summary by default) can't be hidden so the table always keeps its primary
 *  text column. `layout` is the stored layout behind `columns` (hidden columns
 *  `!`-prefixed, keeping their place); `onChange` receives the new FULL layout in
 *  that encoding, so an unticked column keeps its position; `onReset` clears
 *  the agent's override. Pass `allColumns` (the universe, e.g. the combined queue's
 *  static + Project + custom-field columns) + `defaultColumns` to reuse this for the
 *  combined "All tickets" queue; it defaults to the single-project static set. */
export function ColumnPicker({
  columns,
  layout,
  onChange,
  onReset,
  allColumns = STATIC_UNIVERSE,
  defaultColumns = DEFAULT_QUEUE_COLUMNS,
  pinnedKey = "summary",
  saveNote = "Saved for you only",
  iconOnly = false,
}: {
  columns: string[];
  /** The stored layout (`!`-prefixed hidden keys) — gives hidden columns their order. */
  layout?: string[];
  onChange: (next: string[]) => void;
  onReset: () => void;
  allColumns?: ColumnMeta[];
  defaultColumns?: string[];
  pinnedKey?: string;
  /** Where the layout is stored, for the trigger's hover help (account vs this browser). */
  saveNote?: string;
  /** Icon-only trigger (the Modern queue's tool row, step B3). Default: today's labelled button. */
  iconOnly?: boolean;
}) {
  const labelFor = (key: string) => allColumns.find((c) => c.key === key)?.label ?? key;
  const descFor = (key: string) => allColumns.find((c) => c.key === key)?.description;
  // Stored order first (hidden columns keep their place), then the rest of the universe.
  const initialOrder = () => orderOver(layout ? decodeColumnLayout(layout).order : columns, allColumns);
  const [order, setOrder] = useState<string[]>(initialOrder);
  const [vis, setVis] = useState<Set<string>>(() => new Set(columns));

  useEffect(() => {
    setOrder(initialOrder());
    setVis(new Set(columns));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, layout, allColumns]);

  const emit = (nextOrder: string[], nextVis: Set<string>) => onChange(encodeColumnLayout(nextOrder, nextVis));

  const toggle = (key: string) => {
    if (key === pinnedKey) return; // keep the primary column
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
    JSON.stringify(order.filter((k) => vis.has(k))) === JSON.stringify(defaultColumns);

  return (
    <Popover>
      {iconOnly ? (
        <PopoverTrigger asChild>
          <IconButton label="Columns" detail={`Choose and order the columns you see\n${saveNote}`} side="bottom">
            <Columns3 className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </PopoverTrigger>
      ) : (
      <Hint label={`Choose and order the columns you see\n${saveNote}`} side="bottom">
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Columns3 className="h-4 w-4" aria-hidden="true" />
            Columns
          </Button>
        </PopoverTrigger>
      </Hint>
      )}
      <PopoverContent align="end" className="w-64 p-2">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Columns
          </span>
          <Hint
            label={
              isDefault
                ? "Already using the default layout"
                : "Go back to this queue's default columns (your admin's default, or the built-in set) and forget your own layout"
            }
          >
          <button
            type="button"
            onClick={onReset}
            disabled={isDefault}
            className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reset
          </button>
          </Hint>
        </div>
        <ul className="max-h-80 overflow-auto">
          {order.map((key, idx) => {
            const label = labelFor(key);
            const checked = vis.has(key);
            return (
              <li
                key={key}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <Hint
                  label={key === pinnedKey ? `${label} is always shown — it's the link to the ticket` : ""}
                  side="right"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={key === pinnedKey}
                    onChange={() => toggle(key)}
                    aria-label={`Show ${label}`}
                    className="h-4 w-4"
                  />
                </Hint>
                <span
                  className={cn("flex-1 text-sm", !checked && "text-muted-foreground")}
                  title={descFor(key)}
                >
                  {label}
                </span>
                <IconButton
                  label={`Move ${label} up`}
                  disabledReason="Already first"
                  onClick={() => move(key, -1)}
                  disabled={idx === 0}
                  className="h-6 w-6 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={`Move ${label} down`}
                  disabledReason="Already last"
                  onClick={() => move(key, 1)}
                  disabled={idx === order.length - 1}
                  className="h-6 w-6 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
