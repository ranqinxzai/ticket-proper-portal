"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Star } from "lucide-react";

import { calendarsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { BusinessCalendar } from "@/lib/itsm/types";
import { TIMEZONES } from "@/lib/itsm/timezones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

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

  // Keep the name draft in sync when the selected calendar changes.
  useEffect(() => {
    setNameDraft(selected?.name ?? "");
  }, [selected?.id, selected?.name]);

  async function createCalendar() {
    setBusy(true);
    try {
      const created = await calendarsApi.create({
        name: "New calendar",
        timezone: "Asia/Kolkata",
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
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canEdit ? (
          <Button type="button" variant="outline" className="gap-1" onClick={createCalendar} disabled={busy}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New calendar
          </Button>
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
            <FieldRow label="Timezone">
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
          ) : selected.is_default ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" /> Default calendar
            </p>
          ) : null}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Business hours</h3>
            <p className="text-sm text-muted-foreground">
              Working windows per weekday. Add a second interval for split shifts.
            </p>
            <BusinessHoursGrid calendarId={selected.id} canEdit={canEdit} />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Holidays</h3>
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
