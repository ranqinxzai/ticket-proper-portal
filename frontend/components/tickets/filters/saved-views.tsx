"use client";

import { Fragment, useState } from "react";
import { Check, ChevronDown, LayoutList, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { savedFiltersApi } from "@/lib/itsm/api";
import type { SavedFilter, SystemView } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SAVED_VIEW_HELP, VIEW_HELP } from "@/lib/itsm/help/queue";
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
 *  marks the caller's current personal default (applied on a fresh queue visit);
 *  clicking it again clears the default (the parent persists a blank key). */
function DefaultStar({ active, onSet, label }: { active: boolean; onSet: () => void; label: string }) {
  return (
    <Hint side="right" label={active ? SAVED_VIEW_HELP.starOn : SAVED_VIEW_HELP.starOff}>
    <button
      type="button"
      aria-label={active ? `Stop using ${label} as your default view` : `Set ${label} as your default view`}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-500",
      )}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSet(); }}
    >
      <Star className={cn("h-3.5 w-3.5", active && "fill-current")} aria-hidden="true" />
    </button>
    </Hint>
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
  compactTrigger = false,
}: {
  systemViews: SystemView[];
  savedFilters: SavedFilter[];
  currentUserId: string | number | null;
  activeLabel: string;
  /** The caller's current personal default view key (or null). */
  defaultViewKey: string | null;
  onApplySystem: (v: SystemView) => void;
  onApplySaved: (sf: SavedFilter) => void;
  /** Persist a view key (system key or "saved:<id>") as the caller's default; "" clears it. */
  onSetDefault: (key: string) => void;
  onDeleted: () => void;
  /** Modern queue (step B3): the view tabs show the active view, so the trigger is a
   *  small "Views" menu button. Default: today's filled active-view button. */
  compactTrigger?: boolean;
}) {
  const mine = savedFilters.filter((s) => isOwn(s, currentUserId));
  const shared = savedFilters.filter((s) => s.is_shared && !isOwn(s, currentUserId));
  // Shared from the helpdesk's All Tickets (project=null, every agent in the
  // helpdesk) vs. shared on this project's queue.
  const sharedGroups = [
    { label: "Helpdesk filters", detail: "Shared with this helpdesk", items: shared.filter((s) => s.project == null) },
    { label: "Project filters", detail: "Shared view", items: shared.filter((s) => s.project != null) },
  ].filter((g) => g.items.length > 0);

  // Clicking the active star clears the default (blank key); any other star sets it.
  const toggleDefault = (key: string) => onSetDefault(defaultViewKey === key ? "" : key);

  const remove = async (sf: SavedFilter) => {
    if (!window.confirm(`Delete “${sf.name}”? This can't be undone.`)) return;
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
      {compactTrigger ? (
        <Hint label={SAVED_VIEW_HELP.allViews} side="bottom" align="end">
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="gap-1 text-muted-foreground">
              Views
              <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
      ) : (
      <Hint label={`Current view: ${activeLabel}\nSwitch views, or star one to make it your default`} side="bottom" align="start">
      <DropdownMenuTrigger asChild>
        {/* The primary view selector — deliberately a filled `secondary` button (vs. the
            outline field-filter chips) so it reads as "which view am I in", not another filter. */}
        <Button type="button" variant="secondary" size="sm" className="gap-1.5">
          <LayoutList className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          <span className="max-w-[12rem] truncate font-semibold">{activeLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      </Hint>
      )}
      <DropdownMenuContent align={compactTrigger ? "end" : "start"} className="w-64">
        <DropdownMenuLabel>Default views</DropdownMenuLabel>
        {systemViews.map((v) => (
          <DropdownMenuItem
            key={v.key}
            onSelect={() => onApplySystem(v)}
            className="flex items-center justify-between gap-2"
          >
            {/* Native title on the NAME only (not the item): a title on the item would
                also pop up over the star's own tooltip. */}
            <span className="truncate" title={VIEW_HELP[v.key] ? `${v.name}\n${VIEW_HELP[v.key]}` : v.name}>
              {v.name}
            </span>
            <DefaultStar
              active={defaultViewKey === v.key}
              onSet={() => toggleDefault(v.key)}
              label={v.name}
            />
          </DropdownMenuItem>
        ))}
        {sharedGroups.map((g) => (
          <Fragment key={g.label}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
            {g.items.map((sf) => (
              <DropdownMenuItem
                key={sf.id}
                onSelect={() => onApplySaved(sf)}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate" title={`${sf.name}\n${g.detail}`}>{sf.name}</span>
                <DefaultStar
                  active={defaultViewKey === `saved:${sf.id}`}
                  onSet={() => toggleDefault(`saved:${sf.id}`)}
                  label={sf.name}
                />
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
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
                <span className="truncate" title={sf.is_shared ? `${sf.name}\nShared with others` : `${sf.name}\nOnly you see this view`}>
                  {sf.name}
                </span>
                <span className="flex items-center gap-1">
                  <DefaultStar
                    active={defaultViewKey === `saved:${sf.id}`}
                    onSet={() => toggleDefault(`saved:${sf.id}`)}
                    label={sf.name}
                  />
                  <IconButton
                    label={`Delete ${sf.name}`}
                    detail={sf.is_shared ? SAVED_VIEW_HELP.deleteShared : undefined}
                    side="right"
                    className="h-5 w-5 p-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void remove(sf); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </IconButton>
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
  crossProject = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (name: string, isShared: boolean) => Promise<void>;
  /** Saved from the combined "All tickets" queue (`project=null`) — it belongs to this
   *  helpdesk's All Tickets; shared, it also lists in this helpdesk's project queues
   *  (SavedFilterViewSet.get_queryset). */
  crossProject?: boolean;
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
              <Hint label={crossProject ? SAVED_VIEW_HELP.onlyMeAll : SAVED_VIEW_HELP.onlyMeProject}>
                <Button type="button" variant={shared ? "outline" : "default"} size="sm"
                  aria-pressed={!shared} onClick={() => setShared(false)} className="flex-1 gap-1.5">
                  {!shared && <Check className="h-3.5 w-3.5" aria-hidden="true" />} Only me
                </Button>
              </Hint>
              <Hint label={crossProject ? SAVED_VIEW_HELP.shareAll : SAVED_VIEW_HELP.shareProject}>
                <Button type="button" variant={shared ? "default" : "outline"} size="sm"
                  aria-pressed={shared} onClick={() => setShared(true)} className="flex-1 gap-1.5">
                  {shared && <Check className="h-3.5 w-3.5" aria-hidden="true" />}{" "}
                  {crossProject ? "Share with helpdesk" : "Share with project"}
                </Button>
              </Hint>
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
