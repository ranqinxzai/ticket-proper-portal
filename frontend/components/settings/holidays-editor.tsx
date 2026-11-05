"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Loader2, Plus, X } from "lucide-react";

import { holidaysApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { Holiday } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CALENDAR_HELP } from "@/lib/itsm/help/admin";

export function HolidaysEditor({
  calendarId,
  canEdit,
}: {
  calendarId: string;
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [recurring, setRecurring] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    holidaysApi
      .list(calendarId)
      .then((r) => setRows([...r].sort((a, b) => a.date.localeCompare(b.date))))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [calendarId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!date) return;
    setBusy("add");
    try {
      await holidaysApi.create({
        calendar: calendarId,
        date,
        name: name.trim(),
        recurring_annually: recurring,
      });
      setDate("");
      setName("");
      setRecurring(false);
      load();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not add the holiday.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: Holiday) {
    if (!window.confirm(`Delete “${row.name || "Holiday"}” (${row.date})? This can't be undone.`)) return;
    setBusy(row.id);
    try {
      await holidaysApi.delete(row.id);
      setRows((r) => r.filter((x) => x.id !== row.id));
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not remove the holiday.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading holidays…
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No holidays configured.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-mono text-xs">{h.date}</span>
              <span className="font-medium">{h.name || "Holiday"}</span>
              {h.recurring_annually ? (
                <span
                  title={CALENDAR_HELP.recurring}
                  className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  every year
                </span>
              ) : null}
              {canEdit ? (
                <IconButton
                  label={`Remove ${h.name || "holiday"} (${h.date})`}
                  disabled={busy === h.id}
                  onClick={() => void remove(h)}
                  className="ml-auto h-6 w-6 text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            <Input
              type="date"
              aria-label="Holiday date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
              required
            />
          </div>
          <div className="min-w-[180px] flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <Input
              aria-label="Holiday name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Diwali"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox
              checked={recurring}
              onCheckedChange={(c) => setRecurring(c === true)}
            />
            Repeats annually
            <InfoTip label="About Repeats annually">{CALENDAR_HELP.recurring}</InfoTip>
          </label>
          <Hint label={!date ? "Pick a date first" : ""}>
            <Button type="submit" size="sm" className="gap-1" disabled={busy === "add" || !date}>
              {busy === "add" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              Add
            </Button>
          </Hint>
        </form>
      ) : null}
    </div>
  );
}
