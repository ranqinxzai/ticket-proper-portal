"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Loader2, Search, X } from "lucide-react";

import { usersApi } from "@/lib/itsm/api";
import type { UserRef } from "@/lib/itsm/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Debounced user picker backed by GET /users/?search=. Returns the selected user id. */
export function UserSearchCombobox({
  value,
  label,
  onSelect,
  onClear,
  disabled,
  placeholder = "Search people…",
}: {
  /** The currently selected user's display label (full_name/username), if any. */
  value?: string | null;
  /** Optional label override for the trigger. */
  label?: string | null;
  onSelect: (user: UserRef) => void;
  onClear?: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<UserRef[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLoading(true);
      usersApi
        .search(q)
        .then(setRows)
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, open]);

  const display = label ?? value;

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            className={cn("h-9 w-full justify-between font-normal", !display && "text-muted-foreground")}
          >
            <span className="truncate">{display || placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or username…"
              className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
            />
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
          <ul className="max-h-64 overflow-auto py-1">
            {rows.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                {loading ? "Searching…" : "No matches."}
              </li>
            ) : (
              rows.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(u);
                      setOpen(false);
                      setQ("");
                    }}
                    className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-medium">{u.full_name || u.username}</span>
                    <span className="text-xs text-muted-foreground">
                      @{u.username}
                      {u.email ? ` · ${u.email}` : ""}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </PopoverContent>
      </Popover>
      {display && onClear ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          disabled={disabled}
          aria-label="Clear selection"
          onClick={onClear}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
