"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

import { businessHoursApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { BusinessHours } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { CALENDAR_HELP } from "@/lib/itsm/help/admin";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_START = "09:00:00";
const DEFAULT_END = "17:00:00";

/** time "HH:MM:SS" -> "HH:MM" for <input type=time>. */
const toInput = (t: string) => t.slice(0, 5);
/** "HH:MM" -> "HH:MM:SS". */
const toApi = (t: string) => (t.length === 5 ? `${t}:00` : t);

/** Confirm-dialog suffix when a delete would leave the calendar with no working hours. */
const EMPTIES_CALENDAR =
  " The calendar will then have no working hours, so SLA clocks on it run 24/7.";

export function BusinessHoursGrid({
  calendarId,
  canEdit,
  onCountChange,
}: {
  calendarId: string;
  canEdit: boolean;
  /** Reports the number of working windows once loaded and after every change, so the
   *  calendar editor can flag a calendar with no working hours. */
  onCountChange?: (count: number) => void;
}) {
  const [rows, setRows] = useState<BusinessHours[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) onCountChange?.(rows.length);
  }, [loading, rows.length, onCountChange]);

  const load = useCallback(() => {
    setLoading(true);
    businessHoursApi
      .list(calendarId)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [calendarId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addWindow(weekday: number) {
    setBusy(`add-${weekday}`);
    try {
      const created = await businessHoursApi.create({
        calendar: calendarId,
        weekday,
        start_time: DEFAULT_START,
        end_time: DEFAULT_END,
      });
      setRows((r) => [...r, created]);
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not add the window.");
    } finally {
      setBusy(null);
    }
  }

  async function updateTime(row: BusinessHours, field: "start_time" | "end_time", value: string) {
    const next = toApi(value);
    setRows((r) => r.map((x) => (x.id === row.id ? { ...x, [field]: next } : x)));
    setBusy(row.id);
    try {
      await businessHoursApi.update(row.id, { [field]: next });
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save the time.");
      load();
    } finally {
      setBusy(null);
    }
  }

  async function removeWindow(row: BusinessHours, ask = true) {
    if (
      ask &&
      !window.confirm(
        `Delete the ${toInput(row.start_time)}–${toInput(row.end_time)} window on ${DAYS[row.weekday]}? ` +
          `This can't be undone.${rows.length === 1 ? EMPTIES_CALENDAR : ""}`,
      )
    )
      return;
    setBusy(row.id);
    try {
      await businessHoursApi.delete(row.id);
      setRows((r) => r.filter((x) => x.id !== row.id));
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not remove the window.");
    } finally {
      setBusy(null);
    }
  }

  function closeDay(weekday: number, windows: BusinessHours[]) {
    const empties = windows.length === rows.length;
    if (
      !window.confirm(
        `Mark ${DAYS[weekday]} as closed? Its working hours are deleted. ` +
          `This can't be undone.${empties ? EMPTIES_CALENDAR : ""}`,
      )
    )
      return;
    windows.forEach((w) => void removeWindow(w, false));
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading hours…
      </p>
    );
  }

  return (
    <div className="divide-y rounded-lg border">
      {DAYS.map((day, weekday) => {
        const windows = rows
          .filter((r) => r.weekday === weekday)
          .sort((a, b) => a.start_time.localeCompare(b.start_time));
        const enabled = windows.length > 0;
        return (
          <div key={day} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex w-32 items-center gap-2">
              <Hint
                label={
                  !canEdit
                    ? "You don't have permission to edit calendars"
                    : enabled
                      ? `Mark ${day} as closed — removes its working hours`
                      : `Open ${day} with 09:00–17:00 working hours`
                }
              >
                <Switch
                  checked={enabled}
                  disabled={!canEdit || busy === `add-${weekday}`}
                  onCheckedChange={(on) => {
                    if (on) void addWindow(weekday);
                    else closeDay(weekday, windows);
                  }}
                  aria-label={`Working day: ${day}`}
                />
              </Hint>
              <span className="text-sm font-medium">{day}</span>
            </div>

            {enabled ? (
              <div className="flex flex-wrap items-center gap-2">
                {windows.map((w) => (
                  <div key={w.id} className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
                    <input
                      type="time"
                      aria-label={`${day} start time`}
                      value={toInput(w.start_time)}
                      disabled={!canEdit || busy === w.id}
                      onChange={(e) => void updateTime(w, "start_time", e.target.value)}
                      className="rounded border bg-background px-1.5 py-0.5 text-sm disabled:opacity-50"
                    />
                    <span className="text-muted-foreground">–</span>
                    <input
                      type="time"
                      aria-label={`${day} end time`}
                      value={toInput(w.end_time)}
                      disabled={!canEdit || busy === w.id}
                      onChange={(e) => void updateTime(w, "end_time", e.target.value)}
                      className="rounded border bg-background px-1.5 py-0.5 text-sm disabled:opacity-50"
                    />
                    {canEdit ? (
                      <IconButton
                        label={`Remove ${toInput(w.start_time)}–${toInput(w.end_time)} window`}
                        disabled={busy === w.id}
                        onClick={() => void removeWindow(w)}
                        className="h-5 w-5 text-muted-foreground hover:text-destructive disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </IconButton>
                    ) : null}
                  </div>
                ))}
                {canEdit ? (
                  <Hint label={CALENDAR_HELP.addInterval}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={busy === `add-${weekday}`}
                      onClick={() => void addWindow(weekday)}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" /> interval
                    </Button>
                  </Hint>
                ) : null}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
