"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { projectsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import type { Project } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DEFAULT_QUEUE_COLUMNS,
  QUEUE_COLUMN_MAP,
  orderedColumnKeys,
  resolveQueueColumns,
} from "@/components/tickets/queue-columns";

/** Project-level default ticket-queue columns. Saved to `project.queue_columns`;
 *  agents may still override their own layout from the queue's column picker. */
export function ColumnLayoutEditor({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const { refresh } = useWorkspace();
  const initial = resolveQueueColumns(null, project.queue_columns);
  const [order, setOrder] = useState<string[]>(() => orderedColumnKeys(initial));
  const [vis, setVis] = useState<Set<string>>(() => new Set(initial));
  const [busy, setBusy] = useState(false);

  const visibleOrdered = () => order.filter((k) => vis.has(k));

  const toggle = (key: string) => {
    if (key === "summary") return;
    const next = new Set(vis);
    next.has(key) ? next.delete(key) : next.add(key);
    setVis(next);
  };

  const move = (key: string, dir: -1 | 1) => {
    const i = order.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = order.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  const resetDefault = () => {
    setOrder(orderedColumnKeys(DEFAULT_QUEUE_COLUMNS));
    setVis(new Set(DEFAULT_QUEUE_COLUMNS));
  };

  async function save() {
    setBusy(true);
    try {
      await projectsApi.update(project.id, { queue_columns: visibleOrdered() });
      toast.success("Column layout saved.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save the column layout.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Default queue columns</h3>
        <p className="text-sm text-muted-foreground">
          Choose which columns appear in this project&apos;s ticket queue, and their order. Agents can
          still tailor their own view from the queue&apos;s “Columns” menu.
        </p>
      </div>

      <ul className="divide-y rounded-lg border">
        {order.map((key, idx) => {
          const def = QUEUE_COLUMN_MAP[key];
          if (!def) return null;
          const checked = vis.has(key);
          return (
            <li key={key} className="flex items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                checked={checked}
                disabled={!canEdit || key === "summary"}
                onChange={() => toggle(key)}
                aria-label={`Show ${def.label}`}
                className="h-4 w-4"
              />
              <span className={cn("flex-1 text-sm", !checked && "text-muted-foreground")}>{def.label}</span>
              <button
                type="button"
                onClick={() => move(key, -1)}
                disabled={!canEdit || idx === 0}
                aria-label={`Move ${def.label} up`}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => move(key, 1)}
                disabled={!canEdit || idx === order.length - 1}
                aria-label={`Move ${def.label} down`}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>

      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save layout
          </Button>
          <Button variant="ghost" onClick={resetDefault} disabled={busy}>
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            Reset to default
          </Button>
        </div>
      ) : null}
    </div>
  );
}
