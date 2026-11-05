"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { helpdesksApi, projectsApi, ticketsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import type { Project } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { COLUMNS_HELP } from "@/lib/itsm/help/settings";
import { cn } from "@/lib/utils";
import {
  COMBINED_DEFAULT_COLUMNS,
  DEFAULT_QUEUE_COLUMNS,
  QUEUE_COLUMNS,
  QUEUE_COLUMN_MAP,
  decodeColumnLayout,
  encodeColumnLayout,
  isColumnEligibleCf,
  queueColumnDef,
} from "@/components/tickets/queue-columns";

/** A column key is valid for a queue layout when it's a known built-in OR a
 *  custom-field column (`cf:<key>`). Custom fields survive by prefix so a
 *  since-deleted field just renders a blank cell (never breaks the table). */
const isValidColKey = (k: string) => !!QUEUE_COLUMN_MAP[k] || k.startsWith("cf:");

/** Shared, custom-field-aware queue-column editor. Renders every column (built-in
 *  + the scope's custom fields) as a reorderable checklist and saves the FULL ordered
 *  list via `onSave` — unticked columns `!`-prefixed so they keep their place
 *  (`encodeColumnLayout`; older visible-only layouts load exactly as before). Used by the per-project Columns tab and the
 *  helpdesk-level All-Tickets Columns page — only the field source, base default,
 *  and persistence differ. */
export function QueueColumnEditor({
  value,
  baseDefault,
  fieldsParams,
  canEdit,
  onSave,
  description,
}: {
  /** Currently-saved column list (`project.queue_columns` / `helpdesk.combined_queue_columns`). */
  value: string[] | null | undefined;
  /** Built-in default set when `value` is empty. */
  baseDefault: string[];
  /** Which custom fields to offer: a single project or the helpdesk-wide union. */
  fieldsParams: { project: string } | { helpdesk: string };
  canEdit: boolean;
  onSave: (columns: string[]) => Promise<void>;
  description: string;
}) {
  // Custom-field columns offered in this scope, resolved from the filter-field
  // registry (`cf:<key>`); labels feed the checklist + queueColumnDef.
  const [cfCols, setCfCols] = useState<{ key: string; label: string }[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const cfLabels = useMemo(
    () => Object.fromEntries(cfCols.map((c) => [c.key, c.label])) as Record<string, string>,
    [cfCols],
  );

  // Seed from the saved value (or the base default), keeping only valid keys. The
  // saved order includes hidden columns, so they reappear where they were.
  const [order, setOrder] = useState<string[]>(() => withRemainingBuiltins(resolveInitial(value, baseDefault).order));
  const [vis, setVis] = useState<Set<string>>(() => new Set(resolveInitial(value, baseDefault).visible));
  const [busy, setBusy] = useState(false);

  // Load the scope's custom fields, then append any not already present so admins
  // can toggle them on. Visibility is untouched (a stored cf: key stays checked).
  useEffect(() => {
    let cancelled = false;
    setFieldsLoading(true);
    ticketsApi
      // Columns editor: only fields that can be a cf: column (value-backed custom
      // fields + the column-backed ITIL set; not Description / built-in duplicates).
      .filterFields({ ...fieldsParams, value_backed: 1 })
      .then((r) => {
        if (cancelled) return;
        const cf = (r.fields ?? [])
          .filter(isColumnEligibleCf)
          .map((f) => ({ key: f.key, label: f.label }));
        setCfCols(cf);
        setOrder((prev) => [...prev, ...cf.map((c) => c.key).filter((k) => !prev.includes(k))]);
      })
      .catch(() => !cancelled && setCfCols([]))
      .finally(() => !cancelled && setFieldsLoading(false));
    return () => {
      cancelled = true;
    };
    // fieldsParams is a fresh object each render; key off its single stable value.
  }, [JSON.stringify(fieldsParams)]);


  const toggle = (key: string) => {
    if (key === "summary") return; // summary is always shown (the row's title link)
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
    setOrder(withRemainingBuiltins(baseDefault, cfCols.map((c) => c.key)));
    setVis(new Set(baseDefault));
  };

  async function save() {
    setBusy(true);
    try {
      await onSave(encodeColumnLayout(order.filter(isValidColKey), vis));
      toast.success("Column layout saved.");
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
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <ul className="divide-y rounded-lg border">
        {order.map((key, idx) => {
          if (!isValidColKey(key)) return null;
          const def = queueColumnDef(key, cfLabels);
          const checked = vis.has(key);
          const isCustom = key.startsWith("cf:");
          return (
            <li key={key} className="flex items-center gap-3 px-3 py-2">
              <Hint label={key === "summary" ? COLUMNS_HELP.summary : ""} side="right">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!canEdit || key === "summary"}
                  onChange={() => toggle(key)}
                  aria-label={`Show ${def.label}`}
                  className="h-4 w-4"
                />
              </Hint>
              <span className={cn("flex-1 truncate text-sm", !checked && "text-muted-foreground")} title={def.label}>
                {def.label}
                {isCustom ? (
                  <Hint label={COLUMNS_HELP.custom}>
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      custom
                    </span>
                  </Hint>
                ) : null}
              </span>
              {canEdit ? (
                <>
                  <IconButton
                    label={`Move ${def.label} up`}
                    disabledReason="Already first"
                    onClick={() => move(key, -1)}
                    disabled={idx === 0}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Move ${def.label} down`}
                    disabledReason="Already last"
                    onClick={() => move(key, 1)}
                    disabled={idx === order.length - 1}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>

      {fieldsLoading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Loading custom fields…
        </p>
      ) : null}

      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save layout
          </Button>
          <Hint label={busy ? "" : COLUMNS_HELP.reset}>
            <Button variant="ghost" onClick={resetDefault} disabled={busy}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              Reset to default
            </Button>
          </Hint>
        </div>
      ) : null}
    </div>
  );
}

/** The saved layout (or the base default) decoded and narrowed to still-valid keys:
 *  the full order (hidden columns included) + the visible keys. */
function resolveInitial(
  value: string[] | null | undefined,
  baseDefault: string[],
): { order: string[]; visible: string[] } {
  const decoded = decodeColumnLayout(value);
  const visible = decoded.visible.filter(isValidColKey);
  if (!visible.length) return { order: baseDefault, visible: baseDefault };
  return { order: decoded.order.filter(isValidColKey), visible };
}

/** Append every built-in (and optionally the given custom-field keys) not already
 *  present, so the checklist renders every available column, checked or not. */
function withRemainingBuiltins(chosen: string[], cfKeys: string[] = []): string[] {
  const seen = new Set(chosen);
  const rest = [...QUEUE_COLUMNS.map((c) => c.key as string), ...cfKeys].filter((k) => !seen.has(k));
  return [...chosen, ...rest];
}

/** Project-level default ticket-queue columns. Saved to `project.queue_columns`;
 *  agents may still override their own layout from the queue's column picker. */
export function ColumnLayoutEditor({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const { refresh } = useWorkspace();
  return (
    <QueueColumnEditor
      key={project.id}
      value={project.queue_columns}
      baseDefault={DEFAULT_QUEUE_COLUMNS}
      fieldsParams={{ project: project.id }}
      canEdit={canEdit}
      description="Choose which columns appear in this project's ticket queue, and their order. This project's custom fields are listed too. Agents can still tailor their own view from the queue's “Columns” menu."
      onSave={async (columns) => {
        await projectsApi.update(project.id, { queue_columns: columns });
        await refresh();
      }}
    />
  );
}

/** Helpdesk-level default columns for the cross-project "All Tickets" queue. Saved
 *  to `helpdesk.combined_queue_columns`; offers built-ins + the union of every
 *  project's custom fields. Agents may still override their own layout on the queue. */
export function CombinedColumnLayoutEditor({ canEdit }: { canEdit: boolean }) {
  const { helpdesk, helpdeskKey, refresh } = useWorkspace();
  if (!helpdesk) return null;
  return (
    <QueueColumnEditor
      key={helpdesk.id}
      value={helpdesk.combined_queue_columns}
      baseDefault={COMBINED_DEFAULT_COLUMNS}
      fieldsParams={{ helpdesk: helpdeskKey }}
      canEdit={canEdit}
      description="Choose the default columns for this helpdesk's “All Tickets” queue, which spans every project. Custom fields from any project in this helpdesk are listed too (blank where a project doesn't define them). Agents can still tailor their own view from the queue's “Columns” menu."
      onSave={async (columns) => {
        await helpdesksApi.update(helpdesk.id, { combined_queue_columns: columns });
        await refresh();
      }}
    />
  );
}
