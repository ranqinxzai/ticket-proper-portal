"use client";

import { useCallback, useEffect, useState } from "react";
import { GripVertical, Loader2, PanelLeft, PanelRight, Plus, Trash2, X } from "lucide-react";
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
import type { FieldDefinition, FieldLayout, FieldLayoutItem, FieldLayoutSection, Project } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { FIELD_TYPE_HELP, FIELD_TYPE_LABEL, LAYOUT_HELP } from "@/lib/itsm/help/settings";

const regionOf = (i: FieldLayoutItem): "main" | "sidebar" => (i.region === "sidebar" ? "sidebar" : "main");
const CID = (region: string, section: string) => `${region}::${section}`;
const isCID = (id: string) => id.includes("::");
const parseCID = (id: string) => {
  const i = id.indexOf("::");
  return { region: id.slice(0, i) as "main" | "sidebar", section: id.slice(i + 2) };
};

type Group = { name: string; rows: FieldLayoutItem[] };
type Region = "main" | "sidebar";

/** Same limit as `FieldLayoutItem.section` (max_length=80). */
const SECTION_NAME_MAX = 80;

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
  // Which column's "+ Section" name input is open.
  const [addingIn, setAddingIn] = useState<Region | null>(null);

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
    if (
      !window.confirm(
        `Remove “${item.field_name ?? "this field"}” from the form? Its Required, Hidden, Portal and rule settings for this project are lost; the field stays in the Fields tab. This can't be undone.`,
      )
    )
      return;
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

  // Declared sections (FieldLayout.sections) persist even while empty.
  const saveSections = useCallback(
    async (next: FieldLayoutSection[]) => {
      if (!layout) return;
      const prevSections = layout.sections ?? [];
      setLayout((prev) => (prev ? { ...prev, sections: next } : prev));
      try {
        const saved = await layoutsApi.update(layout.id, { sections: next });
        setLayout((prev) => (prev ? { ...prev, sections: saved.sections ?? next } : prev));
      } catch (e) {
        setLayout((prev) => (prev ? { ...prev, sections: prevSections } : prev));
        throw e;
      }
    },
    [layout],
  );

  /** Add a named (possibly empty) section to a column. Returns an inline error, or "" on success. */
  const addSection = useCallback(
    async (region: Region, rawName: string): Promise<string> => {
      if (!layout) return "";
      const name = rawName.trim();
      if (!name) return "Enter a section name.";
      if (name.length > SECTION_NAME_MAX) return `Keep it under ${SECTION_NAME_MAX} characters.`;
      const taken =
        layout.items.some((i) => regionOf(i) === region && (i.section || "Details") === name) ||
        (layout.sections ?? []).some((sec) => sec.region === region && sec.name === name);
      if (taken) return "This column already has a section with that name.";
      setBusy(`sec:add:${region}`);
      try {
        await saveSections([...(layout.sections ?? []), { region, name }]);
        setAddingIn(null);
        return "";
      } catch (e) {
        return e instanceof ItsmApiError ? e.message : "Could not add the section.";
      } finally {
        setBusy(null);
      }
    },
    [layout, saveSections],
  );

  const removeSection = useCallback(
    async (region: Region, name: string) => {
      if (!layout) return;
      if (!window.confirm(`Delete the empty section “${name}”? This can't be undone.`)) return;
      setBusy(`sec:${region}:${name}`);
      try {
        await saveSections((layout.sections ?? []).filter((sec) => !(sec.region === region && sec.name === name)));
      } catch (e) {
        toast.error(e instanceof ItsmApiError ? e.message : "Could not delete the section.");
      } finally {
        setBusy(null);
      }
    },
    [layout, saveSections],
  );

  const renameSection = useCallback(
    async (region: "main" | "sidebar", oldName: string, rawName: string) => {
      const name = rawName.trim();
      if (!layout || !name || name === oldName) return;
      const targets = layout.items.filter((i) => regionOf(i) === region && (i.section || "Details") === oldName);
      const declared = (layout.sections ?? []).some((sec) => sec.region === region && sec.name === oldName);
      if (!targets.length && !declared) return;
      const ids = new Set(targets.map((t) => t.id));
      setLayout((prev) =>
        prev ? { ...prev, items: prev.items.map((i) => (ids.has(i.id) ? { ...i, section: name } : i)) } : prev,
      );
      setBusy(`sec:${region}:${oldName}`);
      try {
        await Promise.all(targets.map((t) => layoutsApi.updateItem(t.id, { section: name })));
        if (declared)
          await saveSections(
            (layout.sections ?? []).map((sec) =>
              // Spread: the section keeps its other settings (e.g. Collapsed).
              sec.region === region && sec.name === oldName ? { ...sec, name } : sec,
            ),
          );
      } catch (e) {
        toast.error(e instanceof ItsmApiError ? e.message : "Could not rename the section.");
        void load();
      } finally {
        setBusy(null);
      }
    },
    [layout, load, saveSections],
  );

  /** "Collapsed": the section starts collapsed on the agent ticket page. Stored on the
   *  declared section; a section that only exists through its fields (all seeded
   *  ones) is declared on first use — sections with fields are ordered by their
   *  fields, so appending doesn't move it. */
  const setSectionCollapsed = useCallback(
    async (region: Region, name: string, collapsed: boolean) => {
      if (!layout) return;
      const current = layout.sections ?? [];
      const exists = current.some((sec) => sec.region === region && sec.name === name);
      const next = exists
        ? current.map((sec) => {
            if (sec.region !== region || sec.name !== name) return sec;
            const updated: FieldLayoutSection = { ...sec };
            delete updated.collapsed; // sent only when true (the server drops false)
            if (collapsed) updated.collapsed = true;
            return updated;
          })
        : collapsed
          ? [...current, { region, name, collapsed: true }]
          : current;
      if (next === current) return;
      setBusy(`sec:collapse:${region}:${name}`);
      try {
        await saveSections(next);
      } catch (e) {
        toast.error(e instanceof ItsmApiError ? e.message : "Could not save the section.");
      } finally {
        setBusy(null);
      }
    },
    [layout, saveSections],
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
  // Append declared sections that have no field yet (they persist on the layout).
  const declared = layout.sections ?? [];
  for (const sec of declared) {
    const groups = sec.region === "sidebar" ? sidebarGroups : mainGroups;
    if (!groups.some((g) => g.name === sec.name)) groups.push({ name: sec.name, rows: [] });
  }
  const isDeclared = (region: Region, name: string) =>
    declared.some((sec) => sec.region === region && sec.name === name);
  const isCollapsed = (region: Region, name: string) =>
    declared.some((sec) => sec.region === region && sec.name === name && sec.collapsed);
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
  const sectionCommon = {
    onRename: renameSection,
    onRemoveSection: removeSection,
    onSetCollapsed: setSectionCollapsed,
    busy,
  };

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
            <ColumnHeader title="Main" subtitle="Ticket details · left" canEdit={canEdit} onAddSection={() => setAddingIn("main")} />
            {addingIn === "main" ? (
              <NewSectionInput
                busy={busy === "sec:add:main"}
                onAdd={(name) => addSection("main", name)}
                onCancel={() => setAddingIn(null)}
              />
            ) : null}
            {mainGroups.map((g) => (
              <SectionGroup
                key={CID("main", g.name)}
                region="main"
                section={g.name}
                rows={g.rows}
                declared={isDeclared("main", g.name)}
                collapsed={isCollapsed("main", g.name)}
                {...sectionCommon}
                {...cardCommon}
              />
            ))}
          </section>

          <section className="space-y-3">
            <ColumnHeader title="Sidebar" subtitle="Other details · right" canEdit={canEdit} onAddSection={() => setAddingIn("sidebar")} />
            {addingIn === "sidebar" ? (
              <NewSectionInput
                busy={busy === "sec:add:sidebar"}
                onAdd={(name) => addSection("sidebar", name)}
                onCancel={() => setAddingIn(null)}
              />
            ) : null}
            {sidebarGroups.map((g) => (
              <SectionGroup
                key={CID("sidebar", g.name)}
                region="sidebar"
                section={g.name}
                rows={g.rows}
                declared={isDeclared("sidebar", g.name)}
                collapsed={isCollapsed("sidebar", g.name)}
                {...sectionCommon}
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
            <SelectTrigger className="w-64" aria-label="Field to add">
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
          <Hint
            label={
              busy === "add" || addField
                ? ""
                : available.length
                  ? "Pick a field first"
                  : "Every field is already on the form"
            }
          >
            <Button size="sm" className="gap-1" disabled={!addField || busy === "add"} onClick={addItem}>
              {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Add to form
            </Button>
          </Hint>
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
  declared,
  collapsed,
  busy,
  canEdit,
  onRename,
  onRemoveSection,
  onSetCollapsed,
  ...card
}: {
  region: "main" | "sidebar";
  section: string;
  rows: FieldLayoutItem[];
  /** Saved on the layout (FieldLayout.sections) — an empty one can be deleted. */
  declared: boolean;
  /** Starts collapsed on the agent ticket page (FieldLayout.sections[].collapsed). */
  collapsed: boolean;
  busy: string | null;
  canEdit: boolean;
  onRename: (region: "main" | "sidebar", oldName: string, newName: string) => void;
  onRemoveSection: (region: "main" | "sidebar", name: string) => void;
  onSetCollapsed: (region: "main" | "sidebar", name: string, collapsed: boolean) => void;
} & CardCommon) {
  const { setNodeRef, isOver } = useDroppable({ id: CID(region, section) });
  const isMain = region === "main";
  const strategy = isMain ? rectSortingStrategy : verticalListSortingStrategy;

  return (
    <div className={cn("space-y-2 rounded-lg border bg-background/60 p-3 transition-shadow", isOver && "ring-2 ring-ring")}>
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <SectionHeader name={section} canEdit={canEdit} onRename={(nn) => onRename(region, section, nn)} />
        </div>
        {canEdit ? (
          <Hint label={LAYOUT_HELP.collapsed}>
            <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <Switch
                checked={collapsed}
                disabled={busy === `sec:collapse:${region}:${section}`}
                onCheckedChange={(c) => onSetCollapsed(region, section, c)}
                aria-label={`Start “${section}” collapsed on the ticket page`}
              />
              Collapsed
            </label>
          </Hint>
        ) : collapsed ? (
          <Hint label={LAYOUT_HELP.collapsed}>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              Starts collapsed
            </span>
          </Hint>
        ) : null}
        {canEdit && declared && rows.length === 0 ? (
          <IconButton
            label={`Delete the empty section “${section}”`}
            detail={LAYOUT_HELP.removeSection}
            disabledReason="Deleting…"
            disabled={busy === `sec:${region}:${section}`}
            onClick={() => onRemoveSection(region, section)}
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
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
          <Hint label={LAYOUT_HELP.section}>
            <button
              type="button"
              onClick={onAddSection}
              className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3 w-3" aria-hidden="true" /> Section
            </button>
          </Hint>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground">{subtitle}</span>
    </div>
  );
}

/** Inline name input for "+ Section" (replaces window.prompt). Enter / Add saves,
 *  Escape / Cancel closes; errors (empty, too long, duplicate) show inline.
 *  Module-level (React component-stability rule). */
function NewSectionInput({
  busy,
  onAdd,
  onCancel,
}: {
  busy: boolean;
  onAdd: (name: string) => Promise<string>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    const err = await onAdd(name);
    setError(err);
  };
  return (
    <div className="space-y-1.5 rounded-lg border border-dashed bg-background/60 p-2.5">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={name}
          maxLength={SECTION_NAME_MAX}
          disabled={busy}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder="Section name, e.g. Hardware details"
          aria-label="New section name"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "new-section-error" : undefined}
          className="h-8"
        />
        <Hint label={busy || name.trim() ? "" : "Enter a section name first"}>
          <Button size="sm" className="gap-1" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Add
          </Button>
        </Hint>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p id="new-section-error" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
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
    <Hint label={LAYOUT_HELP.rename} align="start">
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
      className="w-full max-w-[70%] truncate rounded px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/60 focus:bg-background focus:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    />
    </Hint>
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
    case "asset_picker":
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex h-6 items-center gap-1 rounded-full border bg-muted/40 px-2 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
            IT-AST-00001 · Laptop
          </span>
          <span className="inline-flex h-6 items-center rounded-md border border-dashed px-2 text-[11px] text-muted-foreground">
            + Find another asset
          </span>
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
    <Hint label={LAYOUT_HELP.width}>
    <div className="inline-flex overflow-hidden rounded-md border" role="group" aria-label="Width">
      {(["full", "half"] as const).map((w) => (
        <button
          key={w}
          type="button"
          aria-pressed={value === w}
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
    </Hint>
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
          <Hint label={LAYOUT_HELP.drag} side="left">
            <button
              type="button"
              aria-label={`Drag to move ${item.field_name ?? "field"}`}
              className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...dragHandle.attributes}
              {...dragHandle.listeners}
            >
              <GripVertical className="h-4 w-4" aria-hidden="true" />
            </button>
          </Hint>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={item.field_name ?? item.field}>
          {item.field_name ?? item.field}
          {item.is_mandatory ? <span className="ml-0.5 text-destructive">*</span> : null}
        </span>
        <Hint label={isRichtext ? LAYOUT_HELP.richtext : FIELD_TYPE_HELP[item.field_type ?? ""] ?? ""}>
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
            {FIELD_TYPE_LABEL[item.field_type ?? ""] ?? item.field_type}
          </span>
        </Hint>
        {isSystem ? (
          <Hint label={LAYOUT_HELP.system}>
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">sys</span>
          </Hint>
        ) : null}
        {canEdit ? (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {!isRichtext ? (
              <Hint label={region === "main" ? "Move to sidebar →" : "← Move to main"}>
                <button
                  type="button"
                  aria-label={region === "main" ? "Move to sidebar" : "Move to main"}
                  onClick={() => onPatch(item, region === "main" ? { region: "sidebar", width: "full" } : { region: "main" })}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {region === "main" ? <PanelRight className="h-3.5 w-3.5" aria-hidden="true" /> : <PanelLeft className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              </Hint>
            ) : null}
            {!isSystem ? (
              <Hint label={`Remove from layout\n${LAYOUT_HELP.remove}`}>
                <button
                  type="button"
                  aria-label={`Remove ${item.field_name ?? "field"} from layout`}
                  onClick={() => onRemove(item)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </Hint>
            ) : null}
          </div>
        ) : null}
      </div>

      <FieldPreview type={item.field_type} />

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-2 text-[11px]">
        {region === "main" && !isRichtext ? (
          <WidthToggle value={item.width === "half" ? "half" : "full"} disabled={!canEdit} onChange={(w) => onPatch(item, { width: w })} />
        ) : null}
        <Hint label={LAYOUT_HELP.required}>
          <label className="flex items-center gap-1">
            <Switch checked={item.is_mandatory} disabled={!canEdit} onCheckedChange={(c) => onPatch(item, { is_mandatory: c })} />
            Required
          </label>
        </Hint>
        <Hint label={LAYOUT_HELP.hidden}>
          <label className="flex items-center gap-1">
            <Switch checked={item.is_hidden} disabled={!canEdit} onCheckedChange={(c) => onPatch(item, { is_hidden: c })} />
            Hidden
          </label>
        </Hint>
        <Hint label={LAYOUT_HELP.portal}>
          <label className="flex items-center gap-1">
            <Switch
              checked={item.portal_visible !== false}
              disabled={!canEdit}
              onCheckedChange={(c) => onPatch(item, { portal_visible: c })}
            />
            Portal
          </label>
        </Hint>
      </div>
    </div>
  );
}
