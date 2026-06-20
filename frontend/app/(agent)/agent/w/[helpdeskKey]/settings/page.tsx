"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Settings, Tags } from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { calendarsApi, workflowsApi } from "@/lib/itsm/api";
import type { BusinessCalendar, WorkflowStatus } from "@/lib/itsm/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function WorkspaceSettings() {
  const { projects } = useWorkspace();
  const [statuses, setStatuses] = useState<WorkflowStatus[]>([]);
  const [calendar, setCalendar] = useState<BusinessCalendar | null>(null);

  // Distinct default workflows across this workspace's projects.
  const workflowIds = useMemo(
    () => Array.from(new Set(projects.map((p) => p.default_workflow).filter(Boolean) as string[])),
    [projects],
  );

  useEffect(() => {
    if (workflowIds.length === 0) return;
    Promise.all(workflowIds.map((id) => workflowsApi.statuses(id)))
      .then((lists) => setStatuses(lists.flat()))
      .catch(() => setStatuses([]));
  }, [workflowIds]);

  useEffect(() => {
    calendarsApi
      .list()
      .then((cs) => setCalendar(cs.find((c) => c.is_default) ?? cs[0] ?? null))
      .catch(() => setCalendar(null));
  }, []);

  // Group statuses by type (category), dedup by name+color across workflows.
  const byType = useMemo(() => {
    const seen = new Set<string>();
    const groups: Record<string, WorkflowStatus[]> = {};
    for (const s of statuses) {
      const k = `${s.category_name}|${s.name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      (groups[s.category_name] ??= []).push(s);
    }
    return groups;
  }, [statuses]);

  return (
    <div className="space-y-8">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Settings className="h-4 w-4" aria-hidden="true" /> Workspace Settings
      </h2>

      {/* Statuses grouped by type */}
      <section aria-labelledby="statuses-h" className="space-y-3">
        <h3 id="statuses-h" className="text-sm font-semibold">Statuses</h3>
        <p className="text-sm text-muted-foreground">Grouped by status type, with color.</p>
        <div className="space-y-4">
          {Object.entries(byType).map(([type, list]) => (
            <div key={type} className="rounded-lg border bg-card">
              <div className="border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Type: {type}
              </div>
              <ul className="divide-y">
                {list.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span aria-hidden="true" className="h-3 w-3 rounded" style={{ backgroundColor: s.color }} />
                    <span className="font-medium">{s.name}</span>
                    {s.is_initial ? (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">initial</span>
                    ) : null}
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{s.color}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Ticket categories (ticket types per project) */}
      <section aria-labelledby="cats-h" className="space-y-3">
        <h3 id="cats-h" className="flex items-center gap-2 text-sm font-semibold">
          <Tags className="h-4 w-4" aria-hidden="true" /> Ticket Categories
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <div key={p.id} className="rounded-lg border bg-card p-4">
              <p className="mb-2 text-sm font-medium">{p.name}</p>
              <ul className="flex flex-wrap gap-1.5">
                {p.ticket_types.map((t) => (
                  <li
                    key={t.id}
                    className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {t.name}
                    {t.is_default ? " ★" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Calendar */}
      <section aria-labelledby="cal-h" className="space-y-3">
        <h3 id="cal-h" className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4" aria-hidden="true" /> Business Calendar
        </h3>
        {calendar ? (
          <div className="rounded-lg border bg-card p-4 text-sm">
            <p>
              <span className="font-medium">{calendar.name}</span> ·{" "}
              <span className="text-muted-foreground">{calendar.timezone}</span>
            </p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {calendar.hours.map((h, i) => (
                <li key={i}>
                  {DAYS[h.weekday] ?? `Day ${h.weekday}`}: {h.start_time.slice(0, 5)}–{h.end_time.slice(0, 5)}
                </li>
              ))}
              {calendar.hours.length === 0 ? <li>No business hours configured.</li> : null}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No calendar configured.</p>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Inline editing, the drag-and-drop field/layout builder, conditional-field rules and
        per-transition rules are configured here; status/category/calendar definitions above are
        live from this workspace’s configuration.
      </p>
    </div>
  );
}
