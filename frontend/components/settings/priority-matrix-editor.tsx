"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { projectsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import type { Priority, PriorityMatrix, Project } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEFAULT_PRIORITY_MATRIX, IMPACT_OPTIONS, URGENCY_OPTIONS } from "@/lib/itsm/priority";

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const PRIORITY_TINT: Record<Priority, string> = {
  critical: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  high: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  medium: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  low: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
};

function cloneMatrix(m: PriorityMatrix): PriorityMatrix {
  const out: PriorityMatrix = {};
  for (const imp of Object.keys(m)) out[imp] = { ...m[imp] };
  return out;
}

/** Per-project ITIL Priority Matrix (Impact × Urgency → Priority). Incident-only.
 *  Saved to `project.priority_matrix`; the ticket form recomputes Priority live from
 *  it as agents set Impact/Urgency (see lib/itsm/priority.ts). */
export function PriorityMatrixEditor({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const { refresh } = useWorkspace();
  const [matrix, setMatrix] = useState<PriorityMatrix>(() =>
    cloneMatrix(
      project.priority_matrix && Object.keys(project.priority_matrix).length
        ? project.priority_matrix
        : DEFAULT_PRIORITY_MATRIX,
    ),
  );
  const [busy, setBusy] = useState(false);

  const cell = (impact: string, urgency: string): Priority =>
    (matrix[impact]?.[urgency] as Priority) ?? "medium";

  const setCell = (impact: string, urgency: string, value: Priority) => {
    setMatrix((prev) => {
      const next = cloneMatrix(prev);
      (next[impact] ||= {})[urgency] = value;
      return next;
    });
  };

  const resetDefault = () => setMatrix(cloneMatrix(DEFAULT_PRIORITY_MATRIX));

  async function save() {
    setBusy(true);
    try {
      await projectsApi.update(project.id, { priority_matrix: matrix });
      toast.success("Priority matrix saved.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save the priority matrix.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Priority Matrix</h3>
        <p className="text-sm text-muted-foreground">
          Incident priority is calculated from <strong>Impact × Urgency</strong>. Edit the cells to
          match your ITIL policy — Priority auto-fills on the ticket form as agents set Impact and
          Urgency (agents can still override it).
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50">
              <th className="p-2 text-left font-medium">Impact ＼ Urgency</th>
              {URGENCY_OPTIONS.map((u) => (
                <th key={u.value} className="p-2 text-center font-medium">
                  {u.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...IMPACT_OPTIONS].reverse().map((imp) => (
              <tr key={imp.value} className="border-t">
                <th scope="row" className="p-2 text-left font-medium">
                  {imp.label}
                </th>
                {URGENCY_OPTIONS.map((u) => {
                  const v = cell(imp.value, u.value);
                  return (
                    <td key={u.value} className="p-1.5 text-center">
                      <select
                        value={v}
                        disabled={!canEdit}
                        onChange={(e) => setCell(imp.value, u.value, e.target.value as Priority)}
                        aria-label={`Priority for ${imp.label} impact and ${u.label} urgency`}
                        className={cn(
                          "w-full rounded-md border px-2 py-1 text-xs font-medium",
                          PRIORITY_TINT[v],
                        )}
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save matrix
          </Button>
          <Button variant="ghost" onClick={resetDefault} disabled={busy}>
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            Reset to ITIL default
          </Button>
        </div>
      ) : null}
    </div>
  );
}
