"use client";

/**
 * Org-admin editor for custom user attributes (Tenant Settings → User Attributes).
 * Define an attribute (text / number / date / checkbox / dropdown / multi-select),
 * its options, whether it's required at user creation, and whether it shows as a
 * roster column by default. Mirrors the ticket Fields editor, scoped to users.
 *
 * All sub-components are module-top-level (React focus stability).
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { userAttributesApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type {
  UserAttributeDefinition,
  UserAttributeOption,
  UserAttributeType,
} from "@/lib/itsm/types";
import { USER_ATTR_OPTION_TYPES } from "@/lib/itsm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

const TYPES: { value: UserAttributeType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox (yes / no)" },
  { value: "dropdown", label: "Dropdown (single choice)" },
  { value: "multiselect", label: "Multi-select (multiple choice)" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function UserAttributesEditor({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<UserAttributeDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    userAttributesApi
      .list()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading attributes…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No custom attributes yet. Add one below — it appears on the create-user form, and as a
          filter and column on the Users list.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((def) => (
            <AttributeRow key={def.id} def={def} canManage={canManage} onChanged={reload} />
          ))}
        </div>
      )}
      {canManage ? <AddAttributeForm onCreated={reload} /> : null}
    </div>
  );
}

function AttributeRow({
  def,
  canManage,
  onChanged,
}: {
  def: UserAttributeDefinition;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOption = USER_ATTR_OPTION_TYPES.includes(def.attr_type);

  async function patch(body: Partial<UserAttributeDefinition>) {
    setBusy(true);
    try {
      await userAttributesApi.update(def.id, body);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not update the attribute.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the "${def.name}" attribute? Existing values are removed.`)) return;
    setBusy(true);
    try {
      await userAttributesApi.delete(def.id);
      toast.success("Attribute deleted.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not delete the attribute.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium">{def.name}</p>
            <Badge variant="secondary" className="font-normal">
              {TYPE_LABEL[def.attr_type] ?? def.attr_type}
            </Badge>
            {!def.is_active ? (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                Inactive
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">key: {def.key}</p>
        </div>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            checked={def.is_required}
            disabled={!canManage || busy}
            onCheckedChange={(v) => void patch({ is_required: v })}
          />
          Required
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            checked={def.show_in_table}
            disabled={!canManage || busy}
            onCheckedChange={(v) => void patch({ show_in_table: v })}
          />
          Show column
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            checked={def.is_active}
            disabled={!canManage || busy}
            onCheckedChange={(v) => void patch({ is_active: v })}
          />
          Active
        </label>

        {isOption ? (
          <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronDown className="mr-1 h-4 w-4" /> : <ChevronRight className="mr-1 h-4 w-4" />}
            Options ({def.options.length})
          </Button>
        ) : null}
        {canManage ? (
          <Button variant="ghost" size="sm" onClick={remove} disabled={busy} aria-label="Delete">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        ) : null}
      </div>

      {isOption && open ? (
        <div className="border-t p-3">
          <OptionsEditor def={def} canManage={canManage} onChanged={onChanged} />
        </div>
      ) : null}
    </div>
  );
}

function OptionsEditor({
  def,
  canManage,
  onChanged,
}: {
  def: UserAttributeDefinition;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const lbl = label.trim();
    if (!lbl) return;
    const value = slugify(lbl) || lbl;
    setBusy(true);
    try {
      await userAttributesApi.createOption({
        attribute: def.id,
        value,
        label: lbl,
        sort_order: def.options.length,
      });
      setLabel("");
      onChanged();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not add the option.");
    } finally {
      setBusy(false);
    }
  }

  async function removeOption(o: UserAttributeOption) {
    setBusy(true);
    try {
      await userAttributesApi.deleteOption(o.id);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not remove the option.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {def.options.length === 0 ? (
        <p className="text-xs text-muted-foreground">No options yet.</p>
      ) : (
        <ul className="space-y-1">
          {def.options.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1 text-sm"
            >
              <span className="min-w-0 truncate">
                {o.label} <span className="text-xs text-muted-foreground">({o.value})</span>
              </span>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => void removeOption(o)}
                  disabled={busy}
                  aria-label="Remove option"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <div className="flex items-center gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            placeholder="Add an option…"
            className="h-8 max-w-xs"
          />
          <Button size="sm" variant="outline" onClick={() => void add()} disabled={busy || !label.trim()}>
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AddAttributeForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [attrType, setAttrType] = useState<UserAttributeType>("text");
  const [busy, setBusy] = useState(false);

  async function create() {
    const nm = name.trim();
    if (!nm) {
      toast.error("Give the attribute a name.");
      return;
    }
    setBusy(true);
    try {
      await userAttributesApi.create({ name: nm, key: slugify(nm), attr_type: attrType });
      setName("");
      setAttrType("text");
      toast.success("Attribute added.");
      onCreated();
    } catch (e) {
      const msg =
        e instanceof ItsmApiError
          ? e.fieldErrors?.key?.[0] ?? e.message
          : "Could not create the attribute.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed p-3">
      <p className="mb-2 text-sm font-medium">Add attribute</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="na-name">Name</Label>
          <Input
            id="na-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Department"
            className="h-9 w-56"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="na-type">Type</Label>
          <select
            id="na-type"
            value={attrType}
            onChange={(e) => setAttrType(e.target.value as UserAttributeType)}
            className={`${SELECT_CLASS} w-56`}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={() => void create()} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Add
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Dropdown / multi-select types: add their choices from the <strong>Options</strong> panel on
        the attribute row after creating it.
      </p>
    </div>
  );
}
