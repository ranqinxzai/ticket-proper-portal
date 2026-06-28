"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Settings2, SlidersHorizontal, Trash2, X } from "lucide-react";

import { fieldsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { FieldDefinition, FieldType, Project } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";

import { FieldRow, fieldError } from "./field-row";
import { CascadeOptionsEditor } from "./cascade-options-editor";
import { FieldSettingsDialog } from "./field-settings-dialog";

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "multiline", label: "Multi-line text" },
  { value: "richtext", label: "Rich text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & time" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multiselect", label: "Multi-select" },
  { value: "checkbox", label: "Checkbox" },
  { value: "radio", label: "Radio" },
  { value: "user_picker", label: "User picker" },
  { value: "group_picker", label: "Group picker" },
  { value: "cascade", label: "Cascading (dependent)" },
  { value: "attachment", label: "Attachment" },
];

const OPTION_TYPES = new Set<FieldType>(["dropdown", "multiselect", "radio"]);
// True when this field's choices may be edited here: project-scoped fields, or
// value-backed fields (no column mapping). Column-backed system fields
// (priority/source — config.maps_to set) keep fixed, code-derived choices.
const optionsEditable = (f: FieldDefinition, projectId: string) =>
  f.project === projectId || !(f.config as { maps_to?: string } | undefined)?.maps_to;
const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);

export function FieldsEditor({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const [rows, setRows] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [optionsOf, setOptionsOf] = useState<FieldDefinition | null>(null);
  const [cascadeOf, setCascadeOf] = useState<FieldDefinition | null>(null);
  const [settingsOf, setSettingsOf] = useState<FieldDefinition | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const load = useCallback(() => {
    setLoading(true);
    fieldsApi
      .list(project.id)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function addField(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy("add");
    setErrors({});
    try {
      await fieldsApi.create({
        project: project.id,
        name: name.trim(),
        key: slugify(name),
        field_type: type,
        is_multi: type === "multiselect",
      });
      setName("");
      setType("text");
      load();
    } catch (err) {
      if (err instanceof ItsmApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        toast.error(err.message);
      } else toast.error("Could not add the field.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(f: FieldDefinition) {
    setBusy(f.id);
    try {
      await fieldsApi.delete(f.id);
      setRows((r) => r.filter((x) => x.id !== f.id));
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not delete the field.");
    } finally {
      setBusy(null);
    }
  }

  const projectFields = rows.filter((f) => f.project === project.id);
  const globalFields = rows.filter((f) => f.project == null);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Custom fields captured on tickets in this project. Arrange them on the form in the{" "}
        <span className="font-medium">Layout</span> tab.
      </p>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading fields…
        </p>
      ) : (
        <div className="space-y-4">
          <FieldTable
            title="Project fields"
            rows={projectFields}
            canEdit={canEdit}
            busy={busy}
            onOptions={setOptionsOf}
            onCascade={setCascadeOf}
            onSettings={setSettingsOf}
            onRemove={remove}
            empty="No custom fields yet."
          />
          {globalFields.length > 0 ? (
            <FieldTable
              title="Global fields (standard, shared across projects)"
              rows={globalFields}
              canEdit={false}
              busy={busy}
              onOptions={setOptionsOf}
              onCascade={setCascadeOf}
              onSettings={setSettingsOf}
              onRemove={remove}
              empty=""
            />
          ) : null}
        </div>
      )}

      {canEdit ? (
        <form onSubmit={addField} className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
          <FieldRow label="Field name" error={fieldError(errors, "name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Affected service" className="w-56" />
          </FieldRow>
          <FieldRow label="Type" error={fieldError(errors, "key")}>
            <Select value={type} onValueChange={(v) => setType(v as FieldType)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <Button type="submit" size="sm" className="gap-1" disabled={busy === "add" || !name.trim()}>
            {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add field
          </Button>
        </form>
      ) : null}

      <FieldOptionsSheet
        field={optionsOf}
        canEdit={canEdit && !!optionsOf && optionsEditable(optionsOf, project.id)}
        onOpenChange={(o) => !o && setOptionsOf(null)}
        onChanged={load}
      />

      <CascadeOptionsEditor
        field={cascadeOf}
        canEdit={canEdit && !!cascadeOf && optionsEditable(cascadeOf, project.id)}
        onOpenChange={(o) => !o && setCascadeOf(null)}
        onChanged={load}
      />

      <FieldSettingsDialog
        field={settingsOf}
        project={project}
        canEdit={canEdit}
        allFields={rows}
        onOpenChange={(o) => !o && setSettingsOf(null)}
        onChanged={load}
      />
    </div>
  );
}

function FieldTable({
  title,
  rows,
  canEdit,
  busy,
  onOptions,
  onCascade,
  onSettings,
  onRemove,
  empty,
}: {
  title: string;
  rows: FieldDefinition[];
  canEdit: boolean;
  busy: string | null;
  onOptions: (f: FieldDefinition) => void;
  onCascade: (f: FieldDefinition) => void;
  onSettings: (f: FieldDefinition) => void;
  onRemove: (f: FieldDefinition) => void;
  empty: string;
}) {
  if (rows.length === 0 && !empty) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-medium">{f.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{f.key}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{f.field_type}</span>
              {f.is_system ? (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">system</span>
              ) : null}
              <div className="ml-auto flex items-center gap-1">
                {f.field_type === "cascade" ? (
                  <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => onCascade(f)}>
                    <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Tree
                    {f.options?.length ? ` (${f.options.length})` : ""}
                  </Button>
                ) : OPTION_TYPES.has(f.field_type) ? (
                  <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => onOptions(f)}>
                    <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Options
                    {f.options?.length ? ` (${f.options.length})` : ""}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1 text-xs"
                  aria-label="Field settings"
                  onClick={() => onSettings(f)}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Settings
                </Button>
                {canEdit && !f.is_system ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete field"
                    disabled={busy === f.id}
                    onClick={() => onRemove(f)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldOptionsSheet({
  field,
  canEdit,
  onOpenChange,
  onChanged,
}: {
  field: FieldDefinition | null;
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [options, setOptions] = useState(field?.options ?? []);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setOptions(field?.options ?? []);
  }, [field]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!field || !label.trim()) return;
    setBusy("add");
    try {
      const created = await fieldsApi.createOption({
        field: field.id,
        label: label.trim(),
        value: slugify(label),
        sort_order: options.length,
      });
      setOptions((o) => [...o, created]);
      setLabel("");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not add the option.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await fieldsApi.deleteOption(id);
      setOptions((o) => o.filter((x) => x.id !== id));
      onChanged();
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not remove the option.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={Boolean(field)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Options{field ? ` · ${field.name}` : ""}</SheetTitle>
          <SheetDescription>Choices available for this field.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 py-5">
          {options.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No options yet.
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {options.map((o) => (
                <li key={o.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">{o.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{o.value}</span>
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label="Remove option"
                      disabled={busy === o.id}
                      onClick={() => void remove(o.id)}
                      className="ml-auto text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canEdit ? (
            <form onSubmit={add} className="flex items-center gap-2">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New option label" />
              <Button type="submit" size="sm" className="gap-1" disabled={busy === "add" || !label.trim()}>
                {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add
              </Button>
            </form>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
