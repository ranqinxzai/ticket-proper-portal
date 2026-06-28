"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TicketPriority } from "@/lib/itsm/types";

/** The email priority signals admins can map → ticket priority. */
const SIGNALS: { key: string; label: string }[] = [
  { key: "1", label: "X-Priority 1 (Highest)" },
  { key: "2", label: "X-Priority 2 (High)" },
  { key: "3", label: "X-Priority 3 (Normal)" },
  { key: "4", label: "X-Priority 4 (Low)" },
  { key: "5", label: "X-Priority 5 (Lowest)" },
  { key: "high", label: "Importance / X-MSMail-Priority: High" },
  { key: "normal", label: "Importance / X-MSMail-Priority: Normal" },
  { key: "low", label: "Importance / X-MSMail-Priority: Low" },
  { key: "urgent", label: "Priority: urgent" },
  { key: "non-urgent", label: "Priority: non-urgent" },
];

const PRIORITIES: TicketPriority[] = ["critical", "high", "medium", "low"];
const UNSET = "__unset__";

export function EmailPriorityMapEditor({
  value,
  onChange,
  disabled,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}) {
  function setSignal(key: string, mapped: string) {
    const next = { ...value };
    if (mapped === UNSET) delete next[key];
    else next[key] = mapped;
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Map each inbound email priority signal to a ticket priority. Signals with no mapping fall back
        to the default priority.
      </p>
      <div className="divide-y rounded-md border">
        {SIGNALS.map((sig) => {
          const current = value?.[sig.key] ?? UNSET;
          return (
            <div key={sig.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm">{sig.label}</span>
              <Select value={current} onValueChange={(v) => setSignal(sig.key, v)} disabled={disabled}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>Use default</SelectItem>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
