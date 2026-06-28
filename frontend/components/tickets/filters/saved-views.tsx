"use client";

import { useState } from "react";
import { Check, ChevronDown, LayoutList, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { savedFiltersApi } from "@/lib/itsm/api";
import type { SavedFilter, SystemView } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function isOwn(sf: SavedFilter, userId: string | number | null) {
  return userId != null && String(sf.owner) === String(userId);
}

/** A "make this my default" toggle shown on each view row. The filled amber star
 *  marks the caller's current personal default (applied on a fresh queue visit). */
function DefaultStar({ active, onSet, label }: { active: boolean; onSet: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={active ? `${label} is your default view` : `Set ${label} as your default view`}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-500",
      )}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSet(); }}
    >
      <Star className={cn("h-3.5 w-3.5", active && "fill-current")} aria-hidden="true" />
    </button>
  );
}

export function SavedViewsMenu({
  systemViews,
  savedFilters,
  currentUserId,
  activeLabel,
  defaultViewKey,
  onApplySystem,
  onApplySaved,
  onSetDefault,
  onDeleted,
}: {
  systemViews: SystemView[];
  savedFilters: SavedFilter[];
  currentUserId: string | number | null;
  activeLabel: string;
  /** The caller's current personal default view key (or null). */
  defaultViewKey: string | null;
  onApplySystem: (v: SystemView) => void;
  onApplySaved: (sf: SavedFilter) => void;
  /** Persist a view key (system key or "saved:<id>") as the caller's default. */
  onSetDefault: (key: string) => void;
  onDeleted: () => void;
}) {
  const mine = savedFilters.filter((s) => isOwn(s, currentUserId));
  const shared = savedFilters.filter((s) => s.is_shared && !isOwn(s, currentUserId));

  const remove = async (sf: SavedFilter) => {
    try {
      await savedFiltersApi.delete(sf.id);
      toast.success(`Deleted “${sf.name}”`);
      onDeleted();
    } catch {
      toast.error("Could not delete filter");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* The primary view selector — deliberately a filled `secondary` button (vs. the
            outline field-filter chips) so it reads as "which view am I in", not another filter. */}
        <Button type="button" variant="secondary" size="sm" className="h-8 gap-1.5">
          <LayoutList className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          <span className="max-w-[12rem] truncate font-semibold">{activeLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Default views</DropdownMenuLabel>
        {systemViews.map((v) => (
          <DropdownMenuItem
            key={v.key}
            onSelect={() => onApplySystem(v)}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate">{v.name}</span>
            <DefaultStar active={defaultViewKey === v.key} onSet={() => onSetDefault(v.key)} label={v.name} />
          </DropdownMenuItem>
        ))}
        {shared.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Project filters</DropdownMenuLabel>
            {shared.map((sf) => (
              <DropdownMenuItem
                key={sf.id}
                onSelect={() => onApplySaved(sf)}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{sf.name}</span>
                <DefaultStar
                  active={defaultViewKey === `saved:${sf.id}`}
                  onSet={() => onSetDefault(`saved:${sf.id}`)}
                  label={sf.name}
                />
              </DropdownMenuItem>
            ))}
          </>
        )}
        {mine.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>My filters</DropdownMenuLabel>
            {mine.map((sf) => (
              <DropdownMenuItem
                key={sf.id}
                onSelect={() => onApplySaved(sf)}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{sf.name}</span>
                <span className="flex items-center gap-1">
                  <DefaultStar
                    active={defaultViewKey === `saved:${sf.id}`}
                    onSet={() => onSetDefault(`saved:${sf.id}`)}
                    label={sf.name}
                  />
                  <button
                    type="button"
                    aria-label={`Delete ${sf.name}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void remove(sf); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SaveViewDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (name: string, isShared: boolean) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim(), shared);
      onOpenChange(false);
      setName("");
      setShared(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save filter</DialogTitle>
          <DialogDescription>Save the current filters as a reusable view.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="filter-name">Name</Label>
            <Input id="filter-name" value={name} autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              placeholder="e.g. My critical incidents" />
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Visibility</span>
            <div className="flex gap-2">
              <Button type="button" variant={shared ? "outline" : "default"} size="sm"
                aria-pressed={!shared} onClick={() => setShared(false)} className="flex-1 gap-1.5">
                {!shared && <Check className="h-3.5 w-3.5" aria-hidden="true" />} Only me
              </Button>
              <Button type="button" variant={shared ? "default" : "outline"} size="sm"
                aria-pressed={shared} onClick={() => setShared(true)} className="flex-1 gap-1.5">
                {shared && <Check className="h-3.5 w-3.5" aria-hidden="true" />} Share with project
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={!name.trim() || saving}
            className={cn(saving && "opacity-70")}>
            {saving ? "Saving…" : "Save filter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
