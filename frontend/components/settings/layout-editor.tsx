"use client";

import { useCallback, useEffect, useState } from "react";
import { GripVertical, Loader2, PanelLeft, PanelRight, Plus, Trash2 } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { fieldsApi, layoutsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { cn } from "@/lib/utils";
import type { FieldDefinition, FieldLayout, FieldLayoutItem, Project } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const regionOf = (i: FieldLayoutItem): "main" | "sidebar" => (i.region === "sidebar" ? "sidebar" : "main");
const CID = (region: string, section: string) => `${region}::${section}`;
const isCID = (id: string) => id.includes("::");
const parseCID = (id: string) => {
  const i = id.indexOf("::");
  return { region: id.slice(0, i) as "main" | "sidebar", section: id.slice(i + 2) };
};

type Group = { name: string; rows: FieldLayoutItem[] };

function groupBySection(rows: FieldLayoutItem[]): Group[] {
  const out: Group[] = [];
  for (const r of rows) {
    const name = r.section || "Details";
    let g = out.find((s) => s.name === name);
    if (!g) {
      g = { name, rows: [] };
      out.push(g);
    }
    g.rows.push(r);
  }
  return out;
}

export function LayoutEditor({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const [layout, setLayout] = useState<FieldLayout | null>(null);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [addField, setAddField] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  // Locally-created empty sections (persist once a field is dragged in).
  const [extraSections, setExtraSections] = useState<{ main: string[]; sidebar: string[] }>({ main: [], sidebar: [] });

  const addSection = useCallback((region: "main" | "sidebar") => {
    const raw = typeof window !== "undefined" ? window.prompt("New section name") : null;
    const name = raw?.trim();
    if (!name) return;
    setExtraSections((prev) => (prev[region].includes(name) ? prev : { ...prev, [region]: [...prev[region], name] }));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [layouts, defs] = await Promise.all([layoutsApi.list(project.id), fieldsApi.list(project.id)]);
      setLayout(layouts.find((l) => l.ticket_type == null) ?? layouts[0] ?? null);
      setFields(defs);
    } catch {
      setLayout(null);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createLayout() {
    setBusy("layout");
    try {
      await layoutsApi.create({ project: project.id, name: "Default Layout" });
      await load();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not create the layout.");
    } finally {
      setBusy(null);
    }
  }

  async function addItem() {
    if (!layout || !addField) return;
    setBusy("add");
    try {
      const created = await layoutsApi.createItem({
        layout: layout.id,
        field: addField,
        sort_order: (layout.items.at(-1)?.sort_order ?? 0) + 10,
        section: "Ticket details",
      });
      setLayout({ ...layout, items: [...layout.items, created] });
      setAddField("");
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not add the field.");
    } finally {
      setBusy(null);
    }
  }

  const patchItem = useCallback(
    async (item: FieldLayoutItem, body: Partial<FieldLayoutItem>) => {
      setLayout((prev) =>
        prev ? { ...prev, items: prev.items.map((i) => (i.id === item.id ? { ...i, ...body } : i)) } : prev,
      );
      setBusy(item.id);
      try {
        const saved = await layoutsApi.updateItem(item.id, body);
        setLayout((prev) =>
          prev ? { ...prev, items: prev.items.map((i) => (i.id === item.id ? { ...i, ...saved } : i)) } : prev,
        );
      } catch (e) {
        toast.error(e instanceof ItsmApiError ? e.message : "Could not save.");
        void load();
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const removeItem = useCallback(async (item: FieldLayoutItem) => {
    setBusy(item.id);
    try {
      await layoutsApi.deleteItem(item.id);
      setLayout((prev) => (prev ? { ...prev, items: prev.items.filter((i) => i.id !== item.id) } : prev));
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not remove.");
    } finally {
      setBusy(null);
    }
  }, []);

  const renameSection = useCallback(
    async (region: "main" | "sidebar", oldName: string, rawName: string) => {
      const name = rawName.trim();
      if (!layout || !name || name === oldName) return;
      const targets = layout.items.filter((i) => regionOf(i) === region && (i.section || "Details") === oldName);
      if (!targets.length) return;
      const ids = new Set(targets.map((t) => t.id));
      setLayout((prev) =>
        prev ? { ...prev, items: prev.items.map((i) => (ids.has(i.id) ? { ...i, section: name } : i)) } : prev,
      );
      setBusy(`sec:${region}:${oldName}`);
      try {
        await Promise.all(targets.map((t) => layoutsApi.updateItem(t.id, { section: name })));
      } catch (e) {
        toast.error(e instanceof ItsmApiError ? e.message : "Could not rename the section.");
        void load();
      } finally {
        setBusy(null);
      }
    },
    [layout, load],
  );

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading layout…
      </p>
    );
  }

  if (!layout) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">No field layout configured for this project yet.</p>
        {canEdit ? (
          <Button className="gap-1" onClick={createLayout} disabled={busy === "layout"}>
            {busy === "layout" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create default layout
          </Button>
        ) : null}
      </div>
    );
  }

  const sorted = [...layout.items].sort((a, b) => a.sort_order - b.sort_order);
  const byId: Record<string, FieldLayoutItem> = Object.fromEntries(layout.items.map((i) => [i.id, i]));
  const mainItems = sorted.filter((i) => regionOf(i) === "main");
  const sidebarItems = sorted.filter((i) => regionOf(i) === "sidebar");
  const mainGroups = groupBySection(mainItems);
  const sidebarGroups = groupBySection(sidebarItems);
  // Append locally-created empty sections (skip names that already exist).
  for (const s of extraSections.main) if (!mainGroups.some((g) => g.name === s)) mainGroups.push({ name: s, rows: [] });
  for (const s of extraSections.sidebar) if (!sidebarGroups.some((g) => g.name === s)) sidebarGroups.push({ name: s, rows: [] });
  if (mainGroups.length === 0) mainGroups.push({ name: "Ticket details", rows: [] });
  if (sidebarGroups.length === 0) sidebarGroups.push({ name: "Details", rows: [] });
  const systemFieldIds = new Set(fields.filter((f) => f.is_system).map((f) => f.id));
  const usedFieldIds = new Set(layout.items.map((i) => i.field));
  const available = fields.filter((f) => !usedFieldIds.has(f.id));
  const activeItem = activeId ? byId[activeId] : null;

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || !layout) return;
    const activeItem = byId[String(active.id)];
    if (!activeItem) return;

    const overId = String(over.id);
    const target = isCID(overId)
      ? parseCID(overId)
      : (() => {
          const ov = byId[overId];
          return ov ? { region: regionOf(ov), section: ov.section || "Details" } : null;
        })();
    if (!target) return;
    if (activeItem.field_type === "richtext" && target.region === "sidebar") return; // RTE locked to main

    const cols: Record<"main" | "sidebar", string[]> = {
      main: sorted.filter((i) => regionOf(i) === "main").map((i) => i.id),
      sidebar: sorted.filter((i) => regionOf(i) === "sidebar").map((i) => i.id),
    };
    cols[regionOf(activeItem)] = cols[regionOf(activeItem)].filter((id) => id !== active.id);

    let insertIndex: number;
    if (!isCID(overId) && overId !== String(active.id)) {
      insertIndex = cols[target.region].indexOf(overId);
    } else if (isCID(overId)) {
      let last = -1;
      cols[target.region].forEach((id, idx) => {
        if ((byId[id]?.section || "Details") === target.section) last = idx;
      });
      insertIndex = last >= 0 ? last + 1 : cols[target.region].length;
    } else {
      insertIndex = cols[target.region].length;
    }
    if (insertIndex < 0) insertIndex = cols[target.region].length;
    cols[target.region].splice(insertIndex, 0, String(active.id));

    const updates: { id: string; region: "main" | "sidebar"; section: string; sort_order: number; width: "full" | "half" }[] = [];
    let so = 10;
    (["main", "sidebar"] as const).forEach((region) => {
      for (const id of cols[region]) {
        const isActive = id === String(active.id);
        const section = isActive ? target.section : byId[id].section || "Details";
        const rt = byId[id].field_type === "richtext";
        const width: "full" | "half" = region === "sidebar" || rt ? "full" : byId[id].width === "half" ? "half" : "full";
        updates.push({ id, region, section, sort_order: so, width });
        so += 10;
      }
    });

    const changed = updates.filter((u) => {
      const c = byId[u.id];
      return (
        c &&
        (regionOf(c) !== u.region ||
          (c.section || "Details") !== u.section ||
          c.sort_order !== u.sort_order ||
          (c.width === "half" ? "half" : "full") !== u.width)
      );
    });
    if (!changed.length) return;

    setLayout((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((i) => {
              const u = updates.find((x) => x.id === i.id);
              return u ? { ...i, region: u.region, section: u.section, sort_order: u.sort_order, width: u.width } : i;
            }),
          }
        : prev,
    );
    setBusy("dnd");
    Promise.all(
      changed.map((u) =>
        layoutsApi.updateItem(u.id, { region: u.region, section: u.section, sort_order: u.sort_order, width: u.width }),
      ),
    )
      .catch(() => {
        toast.error("Could not save the layout.");
        void load();
      })
      .finally(() => setBusy(null));
  }

  const cardCommon = { canEdit, systemFieldIds, onPatch: patchItem, onRemove: removeItem };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A live preview of the ticket form. <span className="font-medium">Drag</span> fields by the handle to
        reorder or move them between columns and sections; set width and toggle required/hidden/portal
        (Portal = shown on the end-user request form). ({layout.name})
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 lg:grid-cols-3">
          <section className="space-y-3 lg:col-span-2">
            <ColumnHeader title="Main" subtitle="Ticket details · left" canEdit={canEdit} onAddSection={() => addSection("main")} />
            {mainGroups.map((g) => (
              <SectionGroup
                key={CID("main", g.name)}
                region="main"
                section={g.name}
                rows={g.rows}
                onRename={renameSection}
                {...cardCommon}
              />
            ))}
          </section>

          <section className="space-y-3">
            <ColumnHeader title="Sidebar" subtitle="Other details · right" canEdit={canEdit} onAddSection={() => addSection("sidebar")} />
            {sidebarGroups.map((g) => (
              <SectionGroup
                key={CID("sidebar", g.name)}
                region="sidebar"
                section={g.name}
                rows={g.rows}
                onRename={renameSection}
                {...cardCommon}
              />
            ))}
          </section>
        </div>

        <DragOverlay>
          {activeItem ? (
            <div className="rounded-lg border bg-background p-2.5 shadow-lg ring-2 ring-ring">
              <div className="mb-1.5 flex items-center gap-1.5">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{activeItem.field_name ?? activeItem.field}</span>
                <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{activeItem.field_type}</span>
              </div>
              <FieldPreview type={activeItem.field_type} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={addField} onValueChange={setAddField}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={available.length ? "Add a field…" : "All fields placed"} />
            </SelectTrigger>
            <SelectContent>
              {available.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="gap-1" disabled={!addField || busy === "add"} onClick={addItem}>
            {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add to form
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type CardCommon = {
  canEdit: boolean;
  systemFieldIds: Set<string>;
  onPatch: (item: FieldLayoutItem, body: Partial<FieldLayoutItem>) => void;
  onRemove: (item: FieldLayoutItem) => void;
};

function SectionGroup({
  region,
  section,
  rows,
  canEdit,
  onRename,
  ...card
}: {
  region: "main" | "sidebar";
  section: string;
  rows: FieldLayoutItem[];
  canEdit: boolean;
  onRename: (region: "main" | "sidebar", oldName: string, newName: string) => void;
} & CardCommon) {
  const { setNodeRef, isOver } = useDroppable({ id: CID(region, section) });
  const isMain = region === "main";
  const strategy = isMain ? rectSortingStrategy : verticalListSortingStrategy;

  return (
    <div className={cn("space-y-2 rounded-lg border bg-background/60 p-3 transition-shadow", isOver && "ring-2 ring-ring")}>
      <SectionHeader name={section} canEdit={canEdit} onRename={(nn) => onRename(region, section, nn)} />
      <div ref={setNodeRef}>
        <SortableContext items={rows.map((r) => r.id)} strategy={strategy}>
          {rows.length === 0 ? (
            <EmptyDrop label="Drop a field here" />
          ) : (
            <div className={isMain ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "space-y-3"}>
              {rows.map((it) => (
                <SortableFieldCard
                  key={it.id}
                  item={it}
                  region={region}
                  canEdit={canEdit}
                  spanClass={isMain ? (it.field_type === "richtext" || it.width !== "half" ? "sm:col-span-2" : "sm:col-span-1") : ""}
                  {...card}
                />
              ))}
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
}

function SortableFieldCard({
  item,
  region,
  spanClass,
  ...card
}: { item: FieldLayoutItem; region: "main" | "sidebar"; spanClass: string } & CardCommon) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={cn(spanClass, isDragging && "opacity-40")}>
      <FieldCardBody item={item} region={region} dragHandle={{ attributes, listeners }} {...card} />
    </div>
  );
}

function ColumnHeader({
  title,
  subtitle,
  canEdit,
  onAddSection,
}: {
  title: string;
  subtitle: string;
  canEdit: boolean;
  onAddSection: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b pb-1.5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {canEdit ? (
          <button
            type="button"
            onClick={onAddSection}
            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-3 w-3" aria-hidden="true" /> Section
          </button>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground">{subtitle}</span>
    </div>
  );
}

function SectionLabel({ name }: { name: string }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{name}</p>;
}

/** Editable section heading — renaming it renames every field in the group. */
function SectionHeader({ name, canEdit, onRename }: { name: string; canEdit: boolean; onRename: (newName: string) => void }) {
  const [val, setVal] = useState(name);
  useEffect(() => setVal(name), [name]);
  if (!canEdit) return <SectionLabel name={name} />;
  return (
    <input
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        const t = val.trim();
        if (t && t !== name) onRename(t);
        else setVal(name);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          setVal(name);
          e.currentTarget.blur();
        }
      }}
      aria-label="Section name"
      title="Rename section"
      className="w-full max-w-[70%] truncate rounded px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/60 focus:bg-background focus:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

function EmptyDrop({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-background/40 p-6 text-center text-xs text-muted-foreground">
      {label}
    </div>
  );
}

/** A faux rendering of the field's control, so the canvas previews the real form. */
function FieldPreview({ type }: { type?: string }) {
  const bar = "rounded-md border bg-muted/40";
  switch (type) {
    case "richtext":
    case "multiline":
      return (
        <div className={`${bar} h-14`}>
          <div className="flex gap-1 border-b px-2 py-1">
            <span className="h-2 w-3 rounded-sm bg-muted-foreground/30" />
            <span className="h-2 w-3 rounded-sm bg-muted-foreground/30" />
            <span className="h-2 w-3 rounded-sm bg-muted-foreground/30" />
          </div>
        </div>
      );
    case "checkbox":
      return (
        <div className="flex items-center gap-2">
          <span className="h-4 w-4 rounded border bg-muted/40" />
          <span className="text-xs text-muted-foreground">Yes / No</span>
        </div>
      );
    case "attachment":
      return (
        <div className="flex h-10 items-center justify-center rounded-md border border-dashed bg-muted/30 text-[11px] text-muted-foreground">
          Drop or choose files
        </div>
      );
    case "cascade":
      return (
        <div className="space-y-1.5">
          <div className={`${bar} flex h-8 items-center justify-end px-2`}>
            <span className="text-muted-foreground/50">▾</span>
          </div>
          <div className={`${bar} flex h-8 items-center justify-end px-2`}>
            <span className="text-muted-foreground/50">▾</span>
          </div>
        </div>
      );
    case "dropdown":
    case "radio":
    case "user_picker":
    case "group_picker":
      return (
        <div className={`${bar} flex h-8 items-center justify-end px-2`}>
          <span className="text-muted-foreground/50">▾</span>
        </div>
      );
    default:
      return <div className={`${bar} h-8`} />;
  }
}

function WidthToggle({
  value,
  disabled,
  onChange,
}: {
  value: "full" | "half";
  disabled: boolean;
  onChange: (v: "full" | "half") => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border">
      {(["full", "half"] as const).map((w) => (
        <button
          key={w}
          type="button"
          disabled={disabled}
          onClick={() => onChange(w)}
          className={`px-2 py-0.5 text-[11px] capitalize transition-colors disabled:opacity-50 ${
            value === w ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
          }`}
        >
          {w}
        </button>
      ))}
    </div>
  );
}

function FieldCardBody({
  item,
  region,
  canEdit,
  systemFieldIds,
  dragHandle,
  onPatch,
  onRemove,
}: {
  item: FieldLayoutItem;
  region: "main" | "sidebar";
  dragHandle: { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners };
  canEdit: boolean;
  systemFieldIds: Set<string>;
  onPatch: (item: FieldLayoutItem, body: Partial<FieldLayoutItem>) => void;
  onRemove: (item: FieldLayoutItem) => void;
}) {
  const isSystem = systemFieldIds.has(item.field);
  const isRichtext = item.field_type === "richtext";

  return (
    <div className={cn("group relative rounded-lg border bg-background p-2.5 shadow-sm transition-shadow hover:shadow", item.is_hidden && "opacity-50")}>
      <div className="mb-1.5 flex items-center gap-1.5">
        {canEdit ? (
          <button
            type="button"
            aria-label="Drag to move"
            className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {item.field_name ?? item.field}
          {item.is_mandatory ? <span className="ml-0.5 text-destructive">*</span> : null}
        </span>
        <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{item.field_type}</span>
        {isSystem ? <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">sys</span> : null}
        {canEdit ? (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {!isRichtext ? (
              <button
                type="button"
                aria-label={region === "main" ? "Move to sidebar" : "Move to main"}
                title={region === "main" ? "Move to sidebar →" : "← Move to main"}
                onClick={() => onPatch(item, region === "main" ? { region: "sidebar", width: "full" } : { region: "main" })}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {region === "main" ? <PanelRight className="h-3.5 w-3.5" /> : <PanelLeft className="h-3.5 w-3.5" />}
              </button>
            ) : null}
            {!isSystem ? (
              <button
                type="button"
                aria-label="Remove from layout"
                onClick={() => onRemove(item)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <FieldPreview type={item.field_type} />

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-2 text-[11px]">
        {region === "main" && !isRichtext ? (
          <WidthToggle value={item.width === "half" ? "half" : "full"} disabled={!canEdit} onChange={(w) => onPatch(item, { width: w })} />
        ) : null}
        <label className="flex items-center gap-1">
          <Switch checked={item.is_mandatory} disabled={!canEdit} onCheckedChange={(c) => onPatch(item, { is_mandatory: c })} />
          Required
        </label>
        <label className="flex items-center gap-1">
          <Switch checked={item.is_hidden} disabled={!canEdit} onCheckedChange={(c) => onPatch(item, { is_hidden: c })} />
          Hidden
        </label>
        <label className="flex items-center gap-1" title="Show this field on the end-user Service Portal request form">
          <Switch
            checked={item.portal_visible !== false}
            disabled={!canEdit}
            onCheckedChange={(c) => onPatch(item, { portal_visible: c })}
          />
          Portal
        </label>
      </div>
    </div>
  );
}
