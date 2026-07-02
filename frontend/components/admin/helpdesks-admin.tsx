"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Building2, GripVertical, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { helpdesksApi } from "@/lib/itsm/api";
import { useItsmAuth } from "@/lib/itsm/auth";
import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { cn } from "@/lib/utils";
import type { Helpdesk } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/shell/empty-state";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { SettingsSection } from "@/components/settings/settings-section";
import { HelpdeskCreateDialog } from "./helpdesk-create-dialog";

/** Central helpdesk admin: create, enable/disable, and drag to set the global
 * Home-card order. Editing name/icon/colour + members stays in per-helpdesk Settings. */
export function HelpdesksAdmin({ canManage }: { canManage: boolean }) {
  const { refreshUser } = useItsmAuth();
  const [items, setItems] = useState<Helpdesk[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await helpdesksApi.list();
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
      setItems(list);
    } catch {
      toast.error("Could not load helpdesks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((h) => h.id === active.id);
    const newIndex = items.findIndex((h) => h.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const prev = items;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    try {
      await helpdesksApi.reorder(next.map((h) => h.id));
      await refreshUser();
    } catch {
      setItems(prev); // revert on failure
      toast.error("Could not save the new order.");
    }
  }

  async function toggleStatus(hd: Helpdesk, enabled: boolean) {
    const nextStatus = enabled ? "active" : "inactive";
    setBusyId(hd.id);
    setItems((cur) => cur.map((h) => (h.id === hd.id ? { ...h, status: nextStatus } : h)));
    try {
      await helpdesksApi.update(hd.id, { status: nextStatus });
      await refreshUser();
    } catch {
      setItems((cur) => cur.map((h) => (h.id === hd.id ? { ...h, status: hd.status } : h)));
      toast.error("Could not update the helpdesk.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsSection
      title="Helpdesks"
      description="Create helpdesks, enable or disable them, and drag to set the order their cards appear on Home."
      action={
        canManage ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New helpdesk
          </Button>
        ) : null
      }
    >
      {!canManage ? <ReadOnlyBanner /> : null}

      {loading ? (
        <ul className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No helpdesks yet"
          description={
            canManage
              ? "Create your first helpdesk to start organising incoming work."
              : "No helpdesks have been created yet."
          }
          action={
            canManage ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                New helpdesk
              </Button>
            ) : null
          }
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((h) => h.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {items.map((hd) => (
                <SortableHelpdeskRow
                  key={hd.id}
                  helpdesk={hd}
                  canManage={canManage}
                  busy={busyId === hd.id}
                  onToggle={(v) => toggleStatus(hd, v)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <HelpdeskCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
    </SettingsSection>
  );
}

function SortableHelpdeskRow({
  helpdesk,
  canManage,
  busy,
  onToggle,
}: {
  helpdesk: Helpdesk;
  canManage: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: helpdesk.id,
  });
  const { org = "" } = useParams<{ org: string }>();
  const style = { transform: CSS.Transform.toString(transform), transition };
  const active = helpdesk.status === "active";

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-card p-3 shadow-soft",
        isDragging && "z-10 ring-2 ring-ring",
        !active && "opacity-70",
      )}
    >
      {canManage ? (
        <button
          type="button"
          aria-label="Drag to reorder"
          className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}

      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
        style={{ backgroundColor: helpdesk.color || "#6366f1", color: readableOn(helpdesk.color) }}
      >
        <ItsmIcon name={helpdesk.icon} className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{helpdesk.name}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {helpdesk.key}
          </span>
          {!active ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {helpdesk.status === "archived" ? "Archived" : "Inactive"}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {helpdesk.member_count ?? 0} member{(helpdesk.member_count ?? 0) === 1 ? "" : "s"}
        </p>
      </div>

      {active ? (
        <Link
          href={`/t/${org}/agent/w/${helpdesk.key}/settings/helpdesk`}
          aria-label={`Edit ${helpdesk.name}`}
          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}

      {canManage ? (
        <div className="flex items-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
          <Switch
            checked={active}
            onCheckedChange={onToggle}
            disabled={busy}
            aria-label={active ? `Disable ${helpdesk.name}` : `Enable ${helpdesk.name}`}
          />
        </div>
      ) : null}
    </li>
  );
}
