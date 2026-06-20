"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, Clock, Loader2, Plus, Timer, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { slaAdminApi } from "@/lib/itsm/admin-api";
import type {
  BusinessCalendar, SlaEscalation, SlaMetric, SlaPolicy, SlaTarget,
} from "@/lib/itsm/admin-types";
import { PRIORITIES, WEEKDAYS } from "@/lib/itsm/admin-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { useItsmAuth } from "@/lib/itsm/auth";

const NO_CALENDAR = "__none__";

const ESCALATION_ACTIONS: { value: string; label: string }[] = [
  { value: "notify", label: "Notify" },
  { value: "reassign", label: "Reassign" },
  { value: "raise_priority", label: "Raise priority" },
];

const METRIC_LABELS: Record<string, string> = {
  first_response: "First response",
  resolution: "Resolution",
};

export default function SlaPolicyEditorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const policyId = params.id;
  const { loading: authLoading, hasPerm, isSupervisor } = useItsmAuth();
  const allowed = isSupervisor || hasPerm("itsm.sla.policies", "read");

  const [policy, setPolicy] = useState<SlaPolicy | null>(null);
  const [calendars, setCalendars] = useState<BusinessCalendar[]>([]);
  const [calendar, setCalendar] = useState<BusinessCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authLoading && !allowed) router.replace("/queues");
  }, [authLoading, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pol, cals] = await Promise.all([slaAdminApi.policy(policyId), slaAdminApi.calendars()]);
      setPolicy(pol);
      setCalendars(cals);
      if (pol.calendar) {
        const cal = await slaAdminApi.calendar(pol.calendar);
        setCalendar(cal);
      } else {
        setCalendar(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load policy");
      setPolicy(null);
    } finally {
      setLoading(false);
    }
  }, [policyId]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  const handleError = useCallback((e: unknown, fallback: string) => {
    toast.error(e instanceof ItsmApiError ? e.message : e instanceof Error ? e.message : fallback);
  }, []);

  const mutate = useCallback(
    async (fn: () => Promise<unknown>, success: string, fallback: string) => {
      setBusy(true);
      try {
        await fn();
        if (success) toast.success(success);
        await load();
      } catch (e) {
        handleError(e, fallback);
      } finally {
        setBusy(false);
      }
    },
    [load, handleError],
  );

  const updatePolicy = (body: Partial<SlaPolicy>, msg: string) =>
    mutate(() => slaAdminApi.updatePolicy(policyId, body), msg, "Could not update policy");

  if (authLoading || !allowed) {
    return <div className="grid place-items-center py-20 text-sm text-muted-foreground">Checking access…</div>;
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading policy…
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div className="space-y-4">
        <Link href="/admin/sla" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to SLA
        </Link>
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-destructive">
          {error ?? "Policy not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/sla" className="text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Timer className="h-5 w-5 text-indigo-500" />
        <h1 className="text-xl font-semibold">{policy.name}</h1>
        {policy.is_default && <Badge variant="secondary">Default</Badge>}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-white p-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={policy.is_active}
            disabled={busy}
            onCheckedChange={(v) => updatePolicy({ is_active: v }, v ? "Policy activated" : "Policy deactivated")}
          />
          Active
        </label>

        <div className="grid gap-1.5">
          <Label>Business calendar</Label>
          <Select
            value={policy.calendar ?? NO_CALENDAR}
            disabled={busy}
            onValueChange={(v) => updatePolicy({ calendar: v === NO_CALENDAR ? null : v }, "Calendar updated")}
          >
            <SelectTrigger className="w-[240px]"><SelectValue placeholder="Select calendar" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CALENDAR}>24/7 (no calendar)</SelectItem>
              {calendars.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Metrics */}
      {policy.metrics.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
          This policy has no metrics defined.
        </div>
      ) : (
        policy.metrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} busy={busy} mutate={mutate} />
        ))
      )}

      {/* Calendar panel */}
      <CalendarPanel calendar={calendar} busy={busy} mutate={mutate} />
    </div>
  );
}

// ---------------------------------------------------------------------------

type Mutate = (fn: () => Promise<unknown>, success: string, fallback: string) => Promise<void>;

function MetricCard({ metric, busy, mutate }: { metric: SlaMetric; busy: boolean; mutate: Mutate }) {
  const targetByPriority = useMemo(() => {
    const m = new Map<string, SlaTarget>();
    for (const t of metric.targets) m.set(t.priority, t);
    return m;
  }, [metric.targets]);

  return (
    <section className="rounded-lg border bg-white">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Clock className="h-4 w-4 text-indigo-500" />
        <span className="font-medium">{metric.name || METRIC_LABELS[metric.kind] || metric.kind}</span>
        <Badge variant="outline" className="font-mono text-[11px]">{metric.kind}</Badge>
      </div>

      <div className="space-y-5 p-4">
        {/* Targets grid */}
        <div>
          <div className="mb-2 text-sm font-semibold text-muted-foreground">Targets by priority</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PRIORITIES.map((priority) => (
              <TargetCell
                key={priority}
                metricId={metric.id}
                priority={priority}
                target={targetByPriority.get(priority)}
                busy={busy}
                mutate={mutate}
              />
            ))}
          </div>
        </div>

        {/* Pause statuses */}
        {metric.pause_statuses.length > 0 && (
          <div>
            <div className="mb-1 text-sm font-semibold text-muted-foreground">Clock pauses on</div>
            <div className="flex flex-wrap gap-1.5">
              {metric.pause_statuses.map((s) => (
                <Badge key={s} variant="secondary">{s}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Escalations */}
        <EscalationList metric={metric} busy={busy} mutate={mutate} />
      </div>
    </section>
  );
}

function TargetCell({
  metricId, priority, target, busy, mutate,
}: {
  metricId: string;
  priority: string;
  target?: SlaTarget;
  busy: boolean;
  mutate: Mutate;
}) {
  const [value, setValue] = useState<string>(target ? String(target.target_minutes) : "");

  // Keep local state in sync after refetch.
  useEffect(() => {
    setValue(target ? String(target.target_minutes) : "");
  }, [target]);

  const original = target?.target_minutes;

  function commit() {
    const trimmed = value.trim();
    if (trimmed === "") return;
    const minutes = Number(trimmed);
    if (!Number.isFinite(minutes) || minutes < 0) {
      toast.error("Enter a non-negative number of minutes");
      setValue(original != null ? String(original) : "");
      return;
    }
    if (original === minutes) return;
    if (target?.id) {
      void mutate(() => slaAdminApi.updateTarget(target.id!, { target_minutes: minutes }), "Target updated", "Could not update target");
    } else {
      void mutate(
        () => slaAdminApi.createTarget({ metric: metricId, priority, target_minutes: minutes }),
        "Target added",
        "Could not add target",
      );
    }
  }

  return (
    <div className="rounded-md border p-2.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium capitalize">{priority}</span>
        <span className="text-[11px] text-muted-foreground">{value ? minutesToHm(Number(value)) : "—"}</span>
      </div>
      <Input
        type="number"
        min={0}
        inputMode="numeric"
        value={value}
        disabled={busy}
        placeholder="minutes"
        className="h-8"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    </div>
  );
}

function EscalationList({ metric, busy, mutate }: { metric: SlaMetric; busy: boolean; mutate: Mutate }) {
  const [threshold, setThreshold] = useState("80");
  const [action, setAction] = useState("notify");

  function add() {
    const pct = Number(threshold);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      toast.error("Threshold must be between 1 and 100");
      return;
    }
    void mutate(
      () => slaAdminApi.createEscalation({ metric: metric.id, threshold_pct: pct, action }),
      "Escalation added",
      "Could not add escalation",
    );
  }

  function remove(esc: SlaEscalation) {
    if (!esc.id) return;
    void mutate(() => slaAdminApi.deleteEscalation(esc.id!), "Escalation removed", "Could not remove escalation");
  }

  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-muted-foreground">Escalations</div>
      <div className="space-y-2">
        {metric.escalations.length === 0 ? (
          <p className="text-xs text-muted-foreground">No escalations configured.</p>
        ) : (
          metric.escalations
            .slice()
            .sort((a, b) => a.threshold_pct - b.threshold_pct)
            .map((esc) => (
              <div key={esc.id ?? `${esc.threshold_pct}-${esc.action}`} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <Badge variant="outline">{esc.threshold_pct}%</Badge>
                <span className="capitalize">{actionLabel(esc.action)}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto h-7 w-7 text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => remove(esc)}
                  title="Remove escalation"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
        )}
      </div>

      {/* Add escalation */}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Threshold %</Label>
          <Input
            type="number"
            min={1}
            max={100}
            value={threshold}
            disabled={busy}
            className="h-8 w-24"
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Action</Label>
          <Select value={action} onValueChange={setAction} disabled={busy}>
            <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ESCALATION_ACTIONS.map((a) => (
                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy} onClick={add}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CalendarPanel({ calendar, busy, mutate }: { calendar: BusinessCalendar | null; busy: boolean; mutate: Mutate }) {
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");

  if (!calendar) {
    return (
      <section className="rounded-lg border bg-white p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" /> No business calendar attached — the clock runs 24/7.
        </div>
      </section>
    );
  }

  const hoursByDay = new Map<number, BusinessCalendar["hours"]>();
  for (const h of calendar.hours) {
    if (!hoursByDay.has(h.weekday)) hoursByDay.set(h.weekday, []);
    hoursByDay.get(h.weekday)!.push(h);
  }

  function addHoliday() {
    if (!holidayDate || !holidayName.trim()) {
      toast.error("Date and name are required");
      return;
    }
    void mutate(
      () => slaAdminApi.createHoliday({ calendar: calendar!.id, date: holidayDate, name: holidayName.trim() }),
      "Holiday added",
      "Could not add holiday",
    ).then(() => {
      setHolidayDate("");
      setHolidayName("");
    });
  }

  return (
    <section className="rounded-lg border bg-white">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <CalendarDays className="h-4 w-4 text-indigo-500" />
        <span className="font-medium">{calendar.name}</span>
        <Badge variant="outline">{calendar.timezone}</Badge>
      </div>

      <div className="grid gap-6 p-4 lg:grid-cols-2">
        {/* Business hours */}
        <div>
          <div className="mb-2 text-sm font-semibold text-muted-foreground">Business hours</div>
          <div className="space-y-1.5">
            {WEEKDAYS.map((day, idx) => {
              const rows = hoursByDay.get(idx) ?? [];
              return (
                <div key={day} className="flex items-center gap-3 text-sm">
                  <span className="w-10 font-medium">{day}</span>
                  {rows.length === 0 ? (
                    <span className="text-xs text-muted-foreground">Closed</span>
                  ) : (
                    <span className="flex flex-wrap gap-2">
                      {rows.map((r) => (
                        <Badge key={r.id ?? `${r.start_time}-${r.end_time}`} variant="secondary" className="font-mono">
                          {hhmm(r.start_time)}–{hhmm(r.end_time)}
                        </Badge>
                      ))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Holidays */}
        <div>
          <div className="mb-2 text-sm font-semibold text-muted-foreground">Holidays</div>
          <div className="space-y-1.5">
            {calendar.holidays.length === 0 ? (
              <p className="text-xs text-muted-foreground">No holidays defined.</p>
            ) : (
              calendar.holidays
                .slice()
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((h) => (
                  <div key={h.id ?? `${h.date}-${h.name}`} className="flex items-center gap-3 rounded-md border px-3 py-1.5 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{h.date}</span>
                    <span className="truncate">{h.name}</span>
                    {h.recurring_annually && <Badge variant="outline" className="text-[10px]">Annual</Badge>}
                    {h.id && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="ml-auto h-6 w-6 text-destructive hover:text-destructive"
                        disabled={busy}
                        title="Remove holiday"
                        onClick={() => mutate(() => slaAdminApi.deleteHoliday(h.id!), "Holiday removed", "Could not remove holiday")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))
            )}
          </div>

          {/* Add holiday */}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={holidayDate}
                disabled={busy}
                className="h-8 w-[150px]"
                onChange={(e) => setHolidayDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={holidayName}
                disabled={busy}
                className="h-8 w-[180px]"
                placeholder="New Year's Day"
                onChange={(e) => setHolidayName(e.target.value)}
              />
            </div>
            <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy} onClick={addHoliday}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function minutesToHm(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function hhmm(t: string): string {
  return t.slice(0, 5);
}

function actionLabel(action: string): string {
  return ESCALATION_ACTIONS.find((a) => a.value === action)?.label ?? action;
}
