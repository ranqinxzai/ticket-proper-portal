"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";

import type { FilterFieldMeta } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** "+ More" — searchable picker for fields not yet shown as chips. */
export function FieldPicker({
  fields,
  shownKeys,
  onAdd,
}: {
  fields: FilterFieldMeta[];
  shownKeys: Set<string>;
  onAdd: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const available = useMemo(
    () => fields.filter((f) => !shownKeys.has(f.key)
      && f.label.toLowerCase().includes(q.trim().toLowerCase())),
    [fields, shownKeys, q],
  );

  const groups = useMemo(() => {
    const map = new Map<string, FilterFieldMeta[]>();
    for (const f of available) {
      const g = f.group || "Fields";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(f);
    }
    return [...map.entries()];
  }, [available]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          More filters
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Find a field…"
            className="h-7 border-0 px-0 shadow-none focus-visible:ring-0" />
        </div>
        <div className="max-h-72 overflow-auto py-1">
          {groups.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No more fields.</p>
          ) : (
            groups.map(([group, items]) => (
              <div key={group}>
                <p className="px-3 pb-0.5 pt-2 text-xs font-medium text-muted-foreground">{group}</p>
                {items.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => { onAdd(f.key); setOpen(false); setQ(""); }}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
