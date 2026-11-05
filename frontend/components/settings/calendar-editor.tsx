"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus, Star } from "lucide-react";

import { calendarsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { BusinessCalendar } from "@/lib/itsm/types";
import { TIMEZONES } from "@/lib/itsm/timezones";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { CALENDAR_HELP } from "@/lib/itsm/help/admin";

import { BusinessHoursGrid } from "./business-hours-grid";
import { FieldRow } from "./field-row";
import { HolidaysEditor } from "./holidays-editor";

export function CalendarEditor({ canEdit }: { canEdit: boolean }) {
  const [calendars, setCalendars] = useState<BusinessCalendar[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [nameDraft, setNameDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (preferId?: string) => {
      setLoading(true);
      try {
        const cs = await calendarsApi.list();
        setCalendars(cs);
        setSelectedId((cur) => {
          if (preferId && cs.some((c) => c.id === preferId)) return preferId;
          if (cur && cs.some((c) => c.id === cur)) return cur;
          return (cs.find((c) => c.is_default) ?? cs[0])?.id ?? "";
        });
      } catch {
        setCalendars([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const selected = calendars.find((c) => c.id === selectedId) ?? null;

  // Live working-window counts reported by the hours grid (the list's nested `hours`
  // goes stale as soon as the grid edits). A calendar with none runs SLA clocks 24/7.
  const [hourCounts, setHourCounts] = useState<Record<string, number>>({});
  const hasHours = (c: BusinessCalendar) => (hourCounts[c.id] ?? c.hours?.length ?? 0) > 0;
  const onCountChange = useCallback(
    (n: number) => {
      if (!selectedId) return;
      setHourCounts((m) => (m[selectedId] === n ? m : { ...m, [selectedId]: n }));
    },
    [selectedId],
  );

  // Keep the name draft in sync when the selected calendar changes.
  useEffect(() => {
    setNameDraft(selected?.name ?? "");
  }, [selected?.id, selected?.name]);

  async function createCalendar() {
    setBusy(true);
    try {
      // The server gives it Mon–Fri 09:00–17:00 (local to this timezone). Start from
      // the default calendar's timezone so a non-IST org needn't change it first.
      const created = await calendarsApi.create({
        name: "New calendar",
        timezone: calendars.find((c) => c.is_default)?.timezone ?? "Asia/Kolkata",
        is_default: calendars.length === 0,
      });
      await load(created.id);
      toast.success("Calendar created.");
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not create the calendar.");
    } finally {
      setBusy(false);
    }
  }

  async function patchSelected(body: Partial<{ name: string; timezone: string; is_default: boolean }>) {
    if (!selected) return;
    setBusy(true);
    try {
      await calendarsApi.update(selected.id, body);
      // is_default flips others, so re-fetch the list to stay consistent.
      await load(selected.id);
      toast.success("Calendar saved.");
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save the calendar.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading calendars…
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-dashed bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
        Business calendars are shared across all helpdesks. Assign one to a project in its
        configuration so its SLA clocks use these hours.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Calendar</label>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Select a calendar" />
            </SelectTrigger>
            <SelectContent>
              {calendars.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {c.is_default ? " (default)" : ""}
                  {hasHours(c) ? "" : " — no working hours"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canEdit ? (
          <Hint label={busy ? "Saving…" : CALENDAR_HELP.newCalendar}>
            <Button type="button" variant="outline" className="gap-1" onClick={createCalendar} disabled={busy}>
              <Plus className="h-4 w-4" aria-hidden="true" /> New calendar
            </Button>
          </Hint>
        ) : null}
      </div>

      {!selected ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No calendar configured.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="Name">
              <Input
                value={nameDraft}
                disabled={!canEdit || busy}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  const next = nameDraft.trim();
                  if (next && next !== selected.name) void patchSelected({ name: next });
                }}
              />
            </FieldRow>
            <FieldRow label="Timezone" info={CALENDAR_HELP.timezone}>
              <Select
                value={selected.timezone}
                disabled={!canEdit || busy}
                onValueChange={(tz) => void patchSelected({ timezone: tz })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(TIMEZONES.includes(selected.timezone)
                    ? TIMEZONES
                    : [selected.timezone, ...TIMEZONES]
                  ).map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          </div>

          {canEdit && !selected.is_default ? (
            <Hint label={busy ? "Saving…" : CALENDAR_HELP.makeDefault}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={busy}
                onClick={() => void patchSelected({ is_default: true })}
              >
                <Star className="h-4 w-4" aria-hidden="true" /> Make default
              </Button>
            </Hint>
          ) : selected.is_default ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" /> Default calendar
              <InfoTip label="What does the default calendar do?">{CALENDAR_HELP.isDefault}</InfoTip>
            </p>
          ) : null}

          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              Business hours
              {hasHours(selected) ? null : (
                <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> No working hours
                  <InfoTip label="What happens with no working hours?">{CALENDAR_HELP.noHours}</InfoTip>
                </span>
              )}
            </h3>
            <p className="text-sm text-muted-foreground">
              Working windows per weekday. Add a second interval for split shifts.
            </p>
            <BusinessHoursGrid key={selected.id} calendarId={selected.id} canEdit={canEdit} onCountChange={onCountChange} />
          </div>

          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              Holidays
              <InfoTip label="How holidays affect SLAs">{CALENDAR_HELP.holidays}</InfoTip>
            </h3>
            <p className="text-sm text-muted-foreground">
              Non-working days excluded from SLA clocks.
            </p>
            <HolidaysEditor calendarId={selected.id} canEdit={canEdit} />
          </div>
        </div>
      )}
    </div>
  );
}
