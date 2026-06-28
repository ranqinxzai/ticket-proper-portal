"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

import { groupsApi } from "@/lib/itsm/api";
import type { GroupMembership, UserRef } from "@/lib/itsm/types";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const DEFAULT_TRIGGER =
  "h-8 w-44 max-w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** Small "Lead" badge — mirrors the group-members sheet pill style. */
function LeadBadge() {
  return (
    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase leading-none text-primary">
      Lead
    </span>
  );
}

/** Strict assignee picker — the candidate list is the assigned group's active
 *  members, **leads first with a Lead badge**. A click-driven Popover (not a native
 *  <select>) so the badge can render; selection is click-based so focus stays stable.
 *  When no group is set, assignment is blocked (a group must be chosen first). */
export function GroupMemberPicker({
  groupId,
  value,
  disabled,
  className,
  onChange,
}: {
  groupId: string | null;
  value: UserRef | null;
  disabled?: boolean;
  className?: string;
  onChange: (u: UserRef | null) => void;
}) {
  const [members, setMembers] = useState<GroupMembership[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!groupId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    groupsApi
      .members(groupId)
      .then((rows) => !cancelled && setMembers(rows.filter((m) => m.is_active !== false)))
      .catch(() => !cancelled && setMembers([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // Leads first, then members; stable within each band.
  const sorted = useMemo(
    () =>
      [...members].sort(
        (a, b) => (b.role_in_group === "lead" ? 1 : 0) - (a.role_in_group === "lead" ? 1 : 0),
      ),
    [members],
  );

  const selectedMembership = value
    ? sorted.find((m) => String(m.user) === String(value.id))
    : undefined;
  const currentInList = Boolean(selectedMembership);

  if (!groupId) {
    return <span className="text-xs text-muted-foreground">Set a group first</span>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label="Assignee"
          disabled={disabled || loading}
          className={cn(
            className ?? DEFAULT_TRIGGER,
            "inline-flex items-center justify-between gap-2",
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {value ? (
              <>
                <span className="flex min-w-0 flex-col items-start leading-tight">
                  <span className="truncate">{value.full_name || value.username}</span>
                  {value.email ? (
                    <span className="truncate text-[10px] font-normal text-muted-foreground">
                      {value.email}
                    </span>
                  ) : null}
                </span>
                {selectedMembership?.role_in_group === "lead" ? <LeadBadge /> : null}
                {!currentInList ? (
                  <span className="text-xs text-muted-foreground">(not in group)</span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">Unassigned</span>
            )}
          </span>
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-50" aria-hidden="true" />
          ) : (
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        <ul className="max-h-64 overflow-auto">
          <li>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <span className="text-muted-foreground">Unassigned</span>
              {!value ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
            </button>
          </li>
          {sorted.map((m) => {
            const isSelected = value && String(m.user) === String(value.id);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onChange({ id: String(m.user), username: m.username, full_name: m.full_name });
                    setOpen(false);
                  }}
                >
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-medium">{m.full_name || m.username}</span>
                    <span className="truncate text-xs text-muted-foreground">@{m.username}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {m.role_in_group === "lead" ? <LeadBadge /> : null}
                    {isSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                  </span>
                </button>
              </li>
            );
          })}
          {sorted.length === 0 && !loading ? (
            <li className="px-2 py-2 text-xs text-muted-foreground">No members in this group.</li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
