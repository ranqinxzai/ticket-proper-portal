"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { calendarsApi, slaMetricsApi, slaPoliciesApi, slaTargetsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type {
  BusinessCalendar,
  Priority,
  Project,
  SlaMetricConfig,
  SlaPolicy,
} from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "__none__";

const PRIORITIES: { key: Priority; label: string }[] = [
  { key: "critical", label: "Critical" },
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
];

// The two standard metrics this editor manages, with sensible default budgets
// (minutes) — e.g. 30m first response for Critical, 4h for Low.
const STANDARD_METRICS: {
  kind: "first_response" | "resolution";
  name: string;
  defaults: Record<Priority, number>;
}[] = [
  {
    kind: "first_response",
    name: "Time to First Response",
    defaults: { critical: 30, high: 60, medium: 120, low: 240 },
  },
  {
    kind: "resolution",
    name: "Time to Resolution",
    defaults: { critical: 240, high: 480, medium: 1440, low: 2880 },
  },
];

function humanize(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

type Drafts = Record<string, Record<string, string>>; // metricId → priority → minutes string

/** Project SLA configuration: per-priority First Response & Resolution targets.
 *  The SLA engine auto-starts the matching clocks when a ticket is created. */
export function SlaEditor({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const [policy, setPolicy] = useState<SlaPolicy | null>(null);
  const [calendars, setCalendars] = useState<BusinessCalendar[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const hydrate = (p: SlaPolicy | null) => {
    const d: Drafts = {};
    for (const m of p?.metrics ?? []) {
      d[m.id] = {};
      for (const pr of PRIORITIES) {
        const t = m.targets.find((x) => x.priority === pr.key);
        d[m.id][pr.key] = t ? String(t.target_minutes) : "";
      }
    }
    setDrafts(d);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [policies, cals] = await Promise.all([
        slaPoliciesApi.list({ project: project.id }),
        calendarsApi.list().catch(() => [] as BusinessCalendar[]),
      ]);
      const p = policies[0] ?? null;
      setPolicy(p);
      setCalendars(cals);
      hydrate(p);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    load().catch(() => toast.error("Could not load SLA configuration."));
  }, [load]);

  const metricByKind = (kind: string) => policy?.metrics.find((m) => m.kind === kind) ?? null;

  async function setupPolicy() {
    setBusy("setup");
    try {
      const created = await slaPoliciesApi.create({
        name: `${project.name} SLA`,
        project: project.id,
        is_active: true,
      });
      for (const spec of STANDARD_METRICS) {
        const metric = await slaMetricsApi.create({
          policy: created.id,
          kind: spec.kind,
          name: spec.name,
        });
        await Promise.all(
          PRIORITIES.map((pr) =>
            slaTargetsApi.create({
              metric: metric.id,
              priority: pr.key,
              target_minutes: spec.defaults[pr.key],
            }),
          ),
        );
      }
      toast.success("SLA policy created.");
      await load();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not create the SLA policy.");
    } finally {
      setBusy(null);
    }
  }

  async function addMetric(kind: "first_response" | "resolution") {
    if (!policy) return;
    const spec = STANDARD_METRICS.find((s) => s.kind === kind)!;
    setBusy(`add:${kind}`);
    try {
      const metric = await slaMetricsApi.create({ policy: policy.id, kind, name: spec.name });
      await Promise.all(
        PRIORITIES.map((pr) =>
          slaTargetsApi.create({
            metric: metric.id,
            priority: pr.key,
            target_minutes: spec.defaults[pr.key],
          }),
        ),
      );
      await load();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not add the metric.");
    } finally {
      setBusy(null);
    }
  }

  async function saveMetric(metric: SlaMetricConfig) {
    setBusy(metric.id);
    try {
      const ops: Promise<unknown>[] = [];
      for (const pr of PRIORITIES) {
        const raw = (drafts[metric.id]?.[pr.key] ?? "").trim();
        const existing = metric.targets.find((t) => t.priority === pr.key);
        if (raw === "") {
          if (existing) ops.push(slaTargetsApi.delete(existing.id));
          continue;
        }
        const mins = Math.max(1, Math.round(Number(raw)));
        if (!Number.isFinite(mins)) continue;
        if (existing && existing.target_minutes !== mins) {
          ops.push(slaTargetsApi.update(existing.id, { target_minutes: mins }));
        } else if (!existing) {
          ops.push(slaTargetsApi.create({ metric: metric.id, priority: pr.key, target_minutes: mins }));
        }
      }
      await Promise.all(ops);
      toast.success("Targets saved.");
      await load();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save the targets.");
    } finally {
      setBusy(null);
    }
  }

  async function setCalendar(value: string) {
    if (!policy) return;
    try {
      await slaPoliciesApi.update(policy.id, { calendar: value === NONE ? null : value });
      setPolicy({ ...policy, calendar: value === NONE ? null : value });
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not update the calendar.");
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading SLA configuration…</p>;

  if (!policy) {
    return (
      <div className="max-w-xl space-y-3">
        <h3 className="text-sm font-semibold">Service-level targets</h3>
        <p className="text-sm text-muted-foreground">
          No SLA policy yet. Create one to track First Response and Resolution clocks, with a
          per-priority target (e.g. 30 minutes to respond on Critical, 4 hours on Low).
        </p>
        {canEdit ? (
          <Button onClick={setupPolicy} disabled={busy === "setup"}>
            {busy === "setup" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Set up SLA policy
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Ask a supervisor to configure SLAs.</p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{policy.name}</h3>
          <p className="text-sm text-muted-foreground">
            Targets are in minutes and vary by priority. The clock starts when a ticket is created.
          </p>
        </div>
        <div className="w-56">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Business calendar</label>
          <Select value={policy.calendar ?? NONE} onValueChange={setCalendar} disabled={!canEdit}>
            <SelectTrigger>
              <SelectValue placeholder="Default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Use project / default</SelectItem>
              {calendars.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {c.is_default ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {STANDARD_METRICS.map((spec) => {
        const metric = metricByKind(spec.kind);
        if (!metric) {
          return (
            <div key={spec.kind} className="rounded-lg border border-dashed p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{spec.name}</p>
                  <p className="text-xs text-muted-foreground">Not configured for this project.</p>
                </div>
                {canEdit ? (
                  <Button variant="outline" size="sm" onClick={() => addMetric(spec.kind)} disabled={busy === `add:${spec.kind}`}>
                    {busy === `add:${spec.kind}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Add {spec.kind === "first_response" ? "Response" : "Resolution"} SLA
                  </Button>
                ) : null}
              </div>
            </div>
          );
        }
        return (
          <div key={metric.id} className="rounded-lg border bg-card p-4">
            <h4 className="mb-3 text-sm font-semibold">{metric.name}</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {PRIORITIES.map((pr) => {
                const val = drafts[metric.id]?.[pr.key] ?? "";
                const mins = Number(val);
                return (
                  <div key={pr.key} className="flex items-center gap-2">
                    <label className="w-20 shrink-0 text-sm text-muted-foreground">{pr.label}</label>
                    <Input
                      type="number"
                      min={1}
                      value={val}
                      disabled={!canEdit || busy === metric.id}
                      onChange={(e) =>
                        setDrafts((d) => ({
                          ...d,
                          [metric.id]: { ...d[metric.id], [pr.key]: e.target.value },
                        }))
                      }
                      className="h-8 w-28"
                      placeholder="—"
                      aria-label={`${metric.name} target for ${pr.label} (minutes)`}
                    />
                    <span className="text-xs text-muted-foreground">{val ? `min · ${humanize(mins)}` : "min"}</span>
                  </div>
                );
              })}
            </div>
            {canEdit ? (
              <div className="mt-3">
                <Button size="sm" onClick={() => saveMetric(metric)} disabled={busy === metric.id}>
                  {busy === metric.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save targets
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
