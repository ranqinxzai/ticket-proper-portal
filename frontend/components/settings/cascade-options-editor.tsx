"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { fieldsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { FieldDefinition, FieldOption } from "@/lib/itsm/types";
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

const MAX_DEPTH = 7;
const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

type CascadeConfig = { levels?: string[]; depth?: number };

/**
 * Designer for a `cascade` (dependent) field: define the level labels (depth ≤ 7) and
 * build the option tree. Tree nodes are flat `FieldOption`s linked by `parent` + `level`
 * (1-based); a node's value is its parent's value plus its own slug, so paths stay unique.
 */
export function CascadeOptionsEditor({
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
  const [levels, setLevels] = useState<string[]>([]);
  const [options, setOptions] = useState<FieldOption[]>([]);
  const [savingLevels, setSavingLevels] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string>("__root__");
  const [label, setLabel] = useState("");

  useEffect(() => {
    const cfg = (field?.config as CascadeConfig | undefined) ?? {};
    setLevels(cfg.levels?.length ? cfg.levels : ["Category", "Subcategory"]);
    setOptions(field?.options ?? []);
    setParentId("__root__");
    setLabel("");
  }, [field]);

  const depth = levels.length;

  // children-of map keyed by parent id ("__root__" for top level), each sorted.
  const childrenOf = useMemo(() => {
    const map = new Map<string, FieldOption[]>();
    for (const o of options) {
      const key = o.parent ?? "__root__";
      (map.get(key) ?? map.set(key, []).get(key)!).push(o);
    }
    for (const list of map.values()) list.sort((a, b) => a.sort_order - b.sort_order);
    return map;
  }, [options]);

  // Nodes that may still take a child (their level is above the deepest level).
  const parentChoices = useMemo(
    () => options.filter((o) => (o.level ?? 1) < depth).sort((a, b) => (a.level ?? 1) - (b.level ?? 1)),
    [options, depth],
  );

  async function saveLevels() {
    if (!field) return;
    setSavingLevels(true);
    try {
      const cleaned = levels.map((l) => l.trim()).filter(Boolean);
      const updated = await fieldsApi.update(field.id, {
        config: { ...(field.config ?? {}), levels: cleaned, depth: cleaned.length },
      });
      setLevels((updated.config as CascadeConfig)?.levels ?? cleaned);
      onChanged();
      toast.success("Levels saved.");
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save levels.");
    } finally {
      setSavingLevels(false);
    }
  }

  async function addNode() {
    if (!field || !label.trim()) return;
    const parent = parentId === "__root__" ? null : options.find((o) => o.id === parentId) ?? null;
    const level = parent ? (parent.level ?? 1) + 1 : 1;
    const base = parent ? `${parent.value}__${slugify(label)}` : slugify(label);
    const siblings = childrenOf.get(parent?.id ?? "__root__") ?? [];
    setBusy("add");
    try {
      const created = await fieldsApi.createOption({
        field: field.id,
        parent: parent?.id ?? null,
        level,
        value: base,
        label: label.trim(),
        sort_order: siblings.length,
      });
      setOptions((o) => [...o, created]);
      setLabel("");
      onChanged();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not add the node.");
    } finally {
      setBusy(null);
    }
  }

  async function removeNode(node: FieldOption) {
    setBusy(node.id);
    try {
      await fieldsApi.deleteOption(node.id);
      // also drop descendants locally (DB cascades on delete)
      const doomed = new Set<string>([node.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const o of options) {
          if (o.parent && doomed.has(o.parent) && !doomed.has(o.id)) {
            doomed.add(o.id);
            grew = true;
          }
        }
      }
      setOptions((o) => o.filter((x) => !doomed.has(x.id)));
      onChanged();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not remove the node.");
    } finally {
      setBusy(null);
    }
  }

  function renderTree(parentKey: string, level: number) {
    const nodes = childrenOf.get(parentKey) ?? [];
    if (nodes.length === 0) return null;
    return (
      <ul className="space-y-1">
        {nodes.map((n) => (
          <li key={n.id}>
            <div
              className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/40"
              style={{ marginLeft: (level - 1) * 16 }}
            >
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                {levels[level - 1] ?? `L${level}`}
              </span>
              <span className="font-medium">{n.label}</span>
              <span className="font-mono text-xs text-muted-foreground">{n.value}</span>
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`Remove ${n.label}`}
                  disabled={busy === n.id}
                  onClick={() => void removeNode(n)}
                  className="ml-auto text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {renderTree(n.id, level + 1)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Sheet open={Boolean(field)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Category tree{field ? ` · ${field.name}` : ""}</SheetTitle>
          <SheetDescription>
            Define the dependent levels (up to {MAX_DEPTH}) and build the option tree.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-5">
          {/* Levels */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Levels ({depth})</h3>
            <div className="space-y-1.5">
              {levels.map((lvl, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 text-xs text-muted-foreground">{i + 1}.</span>
                  <Input
                    value={lvl}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setLevels((ls) => ls.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    className="h-8"
                  />
                </div>
              ))}
            </div>
            {canEdit ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={levels.length >= MAX_DEPTH}
                  onClick={() => setLevels((ls) => [...ls, `Level ${ls.length + 1}`])}
                >
                  <Plus className="h-4 w-4" /> Add level
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={levels.length <= 1}
                  onClick={() => setLevels((ls) => ls.slice(0, -1))}
                >
                  Remove last
                </Button>
                <Button type="button" size="sm" onClick={saveLevels} disabled={savingLevels}>
                  {savingLevels ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save levels
                </Button>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Removing a level does not delete existing nodes below it.
            </p>
          </section>

          {/* Tree */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Options</h3>
            {options.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No nodes yet.
              </div>
            ) : (
              <div className="rounded-lg border p-2">{renderTree("__root__", 1)}</div>
            )}

            {canEdit ? (
              <div className="flex flex-wrap items-end gap-2 pt-1">
                <Select value={parentId} onValueChange={setParentId}>
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__root__">Top level — {levels[0] ?? "Level 1"}</SelectItem>
                    {parentChoices.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {`${"— ".repeat((p.level ?? 1) - 1)}${p.label} → ${
                          levels[p.level ?? 1] ?? `L${(p.level ?? 1) + 1}`
                        }`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="New option label"
                  className="w-48"
                />
                <Button size="sm" className="gap-1" disabled={busy === "add" || !label.trim()} onClick={addNode}>
                  {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add node
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
