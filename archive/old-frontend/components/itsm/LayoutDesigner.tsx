"use client";

import { useCallback, useMemo, useState } from "react";
import { Eye, EyeOff, GripVertical, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { fieldAdminApi } from "@/lib/itsm/admin-api";
import type { FieldDefinition, FieldLayoutFull, FieldLayoutItem } from "@/lib/itsm/admin-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { cn } from "@/lib/utils";

const DEFAULT_SECTION = "Details";

/** Field types we can render in a layout / preview. */
const FIELD_TYPES: { value: string; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "multiline", label: "Multi-line text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & time" },
  { value: "dropdown", label: "Dropdown (single)" },
  { value: "multiselect", label: "Multi-select" },
  { value: "checkbox", label: "Checkbox" },
  { value: "radio", label: "Radio" },
  { value: "user_picker", label: "User picker" },
  { value: "group_picker", label: "Group picker" },
];

const HAS_OPTIONS = new Set(["dropdown", "multiselect", "radio"]);

type Props = {
  layout: FieldLayoutFull;
  /** All field definitions available for this project. */
  definitions: FieldDefinition[];
  /** Refetch layout + definitions after a mutation. */
  onRefresh: () => Promise<void> | void;
};

type Section = { name: string; items: FieldLayoutItem[] };

export function LayoutDesigner({ layout, definitions, onRefresh }: Props) {
  const [busy, setBusy] = useState(false);
  const [dragItem, setDragItem] = useState<FieldLayoutItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Group items by section, preserving sort_order.
  const sections: Section[] = useMemo(() => {
    const map = new Map<string, FieldLayoutItem[]>();
    const ordered = [...layout.items].sort((a, b) => a.sort_order - b.sort_order);
    for (const item of ordered) {
      const key = item.section || DEFAULT_SECTION;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    if (map.size === 0) map.set(DEFAULT_SECTION, []);
    return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
  }, [layout.items]);

  const usedFieldIds = useMemo(() => new Set(layout.items.map((i) => i.field)), [layout.items]);
  const available = useMemo(
    () => definitions.filter((d) => !usedFieldIds.has(d.id)),
    [definitions, usedFieldIds],
  );

  const handleError = useCallback((e: unknown, fallback: string) => {
    toast.error(e instanceof ItsmApiError ? e.message : e instanceof Error ? e.message : fallback);
  }, []);

  const mutate = useCallback(
    async (fn: () => Promise<unknown>, fallback: string) => {
      setBusy(true);
      try {
        await fn();
        await onRefresh();
      } catch (e) {
        handleError(e, fallback);
      } finally {
        setBusy(false);
      }
    },
    [onRefresh, handleError],
  );

  // --- per-row mutations ---
  const toggleMandatory = (item: FieldLayoutItem) =>
    mutate(() => fieldAdminApi.updateItem(item.id, { is_mandatory: !item.is_mandatory }), "Could not update field");

  const toggleHidden = (item: FieldLayoutItem) =>
    mutate(() => fieldAdminApi.updateItem(item.id, { is_hidden: !item.is_hidden }), "Could not update field");

  const removeItem = (item: FieldLayoutItem) =>
    mutate(() => fieldAdminApi.deleteItem(item.id), "Could not remove field");

  const addField = (field: FieldDefinition, section: string) => {
    const nextOrder = layout.items.reduce((m, i) => Math.max(m, i.sort_order), 0) + 1;
    return mutate(
      () => fieldAdminApi.createItem({ layout: layout.id, field: field.id, section, sort_order: nextOrder }),
      "Could not add field",
    );
  };

  // --- HTML5 drag & drop reordering ---
  // Persist new sort_order across the whole layout, and the section of the dropped item.
  const persistOrder = useCallback(
    async (ordered: FieldLayoutItem[]) => {
      setBusy(true);
      try {
        // Only patch rows whose sort_order or section actually changed.
        const original = new Map(layout.items.map((i) => [i.id, i]));
        const changed = ordered.filter((it, idx) => {
          const o = original.get(it.id);
          return !o || o.sort_order !== idx || o.section !== it.section;
        });
        await Promise.all(
          changed.map((it, _i) =>
            fieldAdminApi.updateItem(it.id, {
              sort_order: ordered.indexOf(it),
              section: it.section || DEFAULT_SECTION,
            }),
          ),
        );
        await onRefresh();
      } catch (e) {
        handleError(e, "Could not reorder fields");
      } finally {
        setBusy(false);
      }
    },
    [layout.items, onRefresh, handleError],
  );

  const onDropOnItem = (target: FieldLayoutItem) => {
    if (!dragItem || dragItem.id === target.id) {
      setDragItem(null);
      return;
    }
    const flat = sections.flatMap((s) => s.items);
    const without = flat.filter((i) => i.id !== dragItem.id);
    const targetIdx = without.findIndex((i) => i.id === target.id);
    const moved: FieldLayoutItem = { ...dragItem, section: target.section || DEFAULT_SECTION };
    without.splice(targetIdx, 0, moved);
    setDragItem(null);
    void persistOrder(without);
  };

  const onDropOnSection = (sectionName: string) => {
    if (!dragItem) return;
    const flat = sections.flatMap((s) => s.items);
    const without = flat.filter((i) => i.id !== dragItem.id);
    const moved: FieldLayoutItem = { ...dragItem, section: sectionName };
    // Append to the end of the target section.
    const lastIdxInSection = (() => {
      let idx = -1;
      without.forEach((i, n) => {
        if ((i.section || DEFAULT_SECTION) === sectionName) idx = n;
      });
      return idx;
    })();
    without.splice(lastIdxInSection + 1, 0, moved);
    setDragItem(null);
    void persistOrder(without);
  };

  return (
    <div className="space-y-4">
      {busy && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Layout sections */}
        <div className="space-y-4">
          {sections.map((section) => (
            <div
              key={section.name}
              className="rounded-lg border bg-white"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDropOnSection(section.name)}
            >
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="text-sm font-semibold">{section.name}</span>
                <span className="text-xs text-muted-foreground">
                  {section.items.length} field{section.items.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="divide-y">
                {section.items.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Drop a field here.
                  </div>
                ) : (
                  section.items.map((item) => (
                    <LayoutRow
                      key={item.id}
                      item={item}
                      definition={definitions.find((d) => d.id === item.field)}
                      isDragging={dragItem?.id === item.id}
                      onDragStart={() => setDragItem(item)}
                      onDragEnd={() => setDragItem(null)}
                      onDrop={() => onDropOnItem(item)}
                      onToggleMandatory={() => toggleMandatory(item)}
                      onToggleHidden={() => toggleHidden(item)}
                      onRemove={() => removeItem(item)}
                      disabled={busy}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Add-field panel */}
        <div className="space-y-3">
          <div className="rounded-lg border bg-white">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-semibold">Available fields</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" /> New
              </Button>
            </div>
            <div className="max-h-[420px] divide-y overflow-y-auto">
              {available.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Every field is already on the layout.
                </div>
              ) : (
                available.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{d.name}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {d.key} · {fieldTypeLabel(d.field_type)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1"
                      disabled={busy}
                      onClick={() => addField(d, sections[0]?.name || DEFAULT_SECTION)}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <NewFieldDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={layout.project}
        onCreated={async (def) => {
          // Place the new field at the end of the first section.
          await addField(def, sections[0]?.name || DEFAULT_SECTION);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function LayoutRow({
  item, definition, isDragging, onDragStart, onDragEnd, onDrop,
  onToggleMandatory, onToggleHidden, onRemove, disabled,
}: {
  item: FieldLayoutItem;
  definition?: FieldDefinition;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onToggleMandatory: () => void;
  onToggleHidden: () => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.stopPropagation();
        onDrop();
      }}
      className={cn(
        "flex items-start gap-3 px-3 py-2.5 transition-colors",
        isDragging ? "opacity-40" : "hover:bg-muted/40",
        item.is_hidden && "opacity-60",
      )}
    >
      <GripVertical className="mt-1 h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{item.field_name}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{item.field_key}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {fieldTypeLabel(item.field_type)}
          </span>
        </div>
        {/* Live preview */}
        <FieldPreview fieldType={item.field_type} definition={definition} mandatory={item.is_mandatory} />
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Required">
          <Switch checked={item.is_mandatory} onCheckedChange={onToggleMandatory} disabled={disabled} />
          Req
        </label>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title={item.is_hidden ? "Hidden — click to show" : "Visible — click to hide"}
          disabled={disabled}
          onClick={onToggleHidden}
        >
          {item.is_hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive hover:text-destructive"
          title="Remove from layout"
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** A small, read-only preview of how the field renders. */
function FieldPreview({
  fieldType, definition, mandatory,
}: {
  fieldType: string;
  definition?: FieldDefinition;
  mandatory: boolean;
}) {
  const options = definition?.options ?? [];
  const placeholder = mandatory ? "Required" : "Optional";

  switch (fieldType) {
    case "multiline":
      return (
        <textarea
          disabled
          placeholder={placeholder}
          className="h-12 w-full max-w-md resize-none rounded-md border border-input bg-muted/30 px-2 py-1 text-xs"
        />
      );
    case "number":
      return <PreviewInput type="number" placeholder={placeholder} />;
    case "date":
      return <PreviewInput type="date" placeholder={placeholder} />;
    case "datetime":
      return <PreviewInput type="datetime-local" placeholder={placeholder} />;
    case "checkbox":
      return (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox disabled /> {definition?.name ?? "Checkbox"}
        </label>
      );
    case "dropdown":
    case "multiselect":
      return (
        <select
          disabled
          className="w-full max-w-xs rounded-md border border-input bg-muted/30 px-2 py-1 text-xs"
        >
          <option>{options.length ? options[0].label : "Select…"}</option>
          {options.slice(1, 4).map((o) => (
            <option key={o.id}>{o.label}</option>
          ))}
        </select>
      );
    case "radio":
      return (
        <div className="flex flex-wrap gap-3">
          {(options.length ? options.slice(0, 3) : [{ id: "x", label: "Option" }]).map((o) => (
            <label key={o.id} className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="radio" disabled /> {o.label}
            </label>
          ))}
        </div>
      );
    case "user_picker":
      return <PreviewInput type="text" placeholder="Pick a user…" />;
    case "group_picker":
      return <PreviewInput type="text" placeholder="Pick a group…" />;
    default:
      return <PreviewInput type="text" placeholder={placeholder} />;
  }
}

function PreviewInput({ type, placeholder }: { type: string; placeholder: string }) {
  return (
    <input
      type={type}
      disabled
      placeholder={placeholder}
      className="w-full max-w-xs rounded-md border border-input bg-muted/30 px-2 py-1 text-xs"
    />
  );
}

// ---------------------------------------------------------------------------

function NewFieldDialog({
  open, onOpenChange, projectId, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  onCreated: (def: FieldDefinition) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [fieldType, setFieldType] = useState("text");
  const [optionsText, setOptionsText] = useState("");
  const [isMulti, setIsMulti] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyTouched, setKeyTouched] = useState(false);

  const reset = () => {
    setName("");
    setKey("");
    setFieldType("text");
    setOptionsText("");
    setIsMulti(false);
    setKeyTouched(false);
  };

  function onNameChange(v: string) {
    setName(v);
    if (!keyTouched) setKey(slugifyKey(v));
  }

  async function submit() {
    if (!name.trim() || !key.trim()) {
      toast.error("Name and key are required");
      return;
    }
    setSaving(true);
    try {
      const body: Partial<FieldDefinition> = {
        project: projectId,
        key: key.trim(),
        name: name.trim(),
        field_type: fieldType,
        is_multi: fieldType === "multiselect" ? true : isMulti,
      };
      if (HAS_OPTIONS.has(fieldType)) {
        const opts = optionsText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((label, i) => ({ value: slugifyKey(label) || `opt_${i + 1}`, label }));
        body.options = opts.map((o, i) => ({ id: "", value: o.value, label: o.label, sort_order: i }));
      }
      const def = await fieldAdminApi.createDefinition(body);
      toast.success(`Created field “${def.name}”`);
      await onCreated(def);
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : e instanceof Error ? e.message : "Could not create field");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New custom field</DialogTitle>
          <DialogDescription>Create a field definition and add it to this layout.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="nf-name">Name</Label>
            <Input id="nf-name" value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Affected system" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nf-key">Key</Label>
            <Input
              id="nf-key"
              value={key}
              onChange={(e) => { setKeyTouched(true); setKey(slugifyKey(e.target.value)); }}
              placeholder="affected_system"
              className="font-mono"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Select value={fieldType} onValueChange={setFieldType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {HAS_OPTIONS.has(fieldType) && (
            <div className="grid gap-1.5">
              <Label htmlFor="nf-opts">Options (one per line)</Label>
              <textarea
                id="nf-opts"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder={"Low\nMedium\nHigh"}
                className="min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}

          {fieldType !== "multiselect" && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isMulti} onCheckedChange={setIsMulti} />
              Allow multiple values
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            <X className="mr-1 h-4 w-4" /> Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
            Create &amp; add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function fieldTypeLabel(type: string): string {
  return FIELD_TYPES.find((t) => t.value === type)?.label ?? type;
}

function slugifyKey(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}
