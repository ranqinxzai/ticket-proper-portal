"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { projectsApi, savedFiltersApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import type { FilterCondition, Project, SavedFilter } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { FieldPicker } from "@/components/tickets/filters/field-picker";
import { FilterChip } from "@/components/tickets/filters/filter-chip";
import { useFilterOptions } from "@/components/tickets/filters/use-filter-options";
import { buildSpec, DEFAULT_FIELD_KEYS } from "@/components/tickets/filters/filter-utils";

const selectCls =
  "flex h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

type Opts = ReturnType<typeof useFilterOptions>;

const extrasFromConditions = (conds: FilterCondition[]) =>
  [...new Set(conds.map((c) => c.field).filter((k) => !DEFAULT_FIELD_KEYS.includes(k)))];

/** The chip-based condition builder reused from the queue filter bar (FilterChip
 *  + FieldPicker). Shows the standard quick-filter chips plus any extras added. */
function ConditionChips({
  opts,
  conditions,
  extraKeys,
  onConditionsChange,
  onExtraKeysChange,
}: {
  opts: Opts;
  conditions: FilterCondition[];
  extraKeys: string[];
  onConditionsChange: (next: FilterCondition[]) => void;
  onExtraKeysChange: (next: string[]) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const defaultKeys = DEFAULT_FIELD_KEYS.filter((k) => opts.fieldByKey(k));
  const chipKeys = [...new Set([...defaultKeys, ...extraKeys])];
  const isDefault = (k: string) => defaultKeys.includes(k);

  const upsert = (c: FilterCondition) => {
    const next = conditions.some((x) => x.field === c.field)
      ? conditions.map((x) => (x.field === c.field ? c : x))
      : [...conditions, c];
    onConditionsChange(next);
  };
  const removeChip = (key: string) => {
    onConditionsChange(conditions.filter((c) => c.field !== key));
    onExtraKeysChange(extraKeys.filter((k) => k !== key));
  };
  const addField = (key: string) => {
    if (!extraKeys.includes(key)) onExtraKeysChange([...extraKeys, key]);
    setOpenKey(key);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chipKeys.map((key) => {
        const field = opts.fieldByKey(key);
        if (!field) return null;
        const condition: FilterCondition =
          conditions.find((c) => c.field === key) ?? { field: key, op: field.operators[0] ?? "eq" };
        return (
          <FilterChip
            key={key}
            field={field}
            condition={condition}
            options={opts.optionsForField(field)}
            labelFor={opts.labelFor}
            registerUserLabel={opts.registerUserLabel}
            onChange={upsert}
            onRemove={isDefault(key) ? undefined : () => removeChip(key)}
            defaultOpen={openKey === key}
          />
        );
      })}
      <FieldPicker fields={opts.fields} shownKeys={new Set(chipKeys)} onAdd={addField} />
    </div>
  );
}

/** Create/edit dialog for a project (shared) saved filter. State resets each time
 *  the dialog opens from the (stable) initial values supplied by the parent. */
function FilterBuilderDialog({
  opts,
  open,
  onOpenChange,
  initialName,
  initialConditions,
  saving,
  onSubmit,
}: {
  opts: Opts;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialName: string;
  initialConditions: FilterCondition[];
  saving: boolean;
  onSubmit: (name: string, conditions: FilterCondition[]) => void;
}) {
  const [name, setName] = useState(initialName);
  const [conditions, setConditions] = useState<FilterCondition[]>(initialConditions);
  const [extraKeys, setExtraKeys] = useState<string[]>(() => extrasFromConditions(initialConditions));

  useEffect(() => {
    if (open) {
      setName(initialName);
      setConditions(initialConditions);
      setExtraKeys(extrasFromConditions(initialConditions));
    }
  }, [open, initialName, initialConditions]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initialName ? "Edit filter" : "New filter"}</DialogTitle>
          <DialogDescription>
            Build a query, then save it as a shared filter on this project&apos;s queue.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cf-name">Name</Label>
            <Input
              id="cf-name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Critical incidents"
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Conditions</span>
            <ConditionChips
              opts={opts}
              conditions={conditions}
              extraKeys={extraKeys}
              onConditionsChange={setConditions}
              onExtraKeysChange={setExtraKeys}
            />
            <p className="text-xs text-muted-foreground">
              Tickets matching all conditions are included. No conditions ⇒ matches every ticket.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!name.trim() || saving}
            onClick={() => onSubmit(name.trim(), conditions)}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save filter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Project settings → Filters tab. Admins toggle which built-in views appear,
 *  manage shared custom filters (full builder), and pick the project default. */
export function FiltersEditor({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const { refresh } = useWorkspace();
  const opts = useFilterOptions(project);

  const [disabled, setDisabled] = useState<Set<string>>(() => new Set(project.disabled_view_keys ?? []));
  const [defaultKey, setDefaultKey] = useState<string>(project.default_view_key ?? "");
  const [savingProject, setSavingProject] = useState(false);

  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [loadingFilters, setLoadingFilters] = useState(true);

  const [builder, setBuilder] = useState<{
    open: boolean;
    editing: SavedFilter | null;
    name: string;
    conditions: FilterCondition[];
  }>({ open: false, editing: null, name: "", conditions: [] });
  const [savingFilter, setSavingFilter] = useState(false);

  const loadFilters = useCallback(() => {
    setLoadingFilters(true);
    savedFiltersApi
      .list({ project: project.id })
      .then((rows) =>
        setFilters(
          rows
            .filter((f) => f.is_shared && String(f.project) === String(project.id))
            .sort((a, b) => a.sort_order - b.sort_order),
        ),
      )
      .catch(() => setFilters([]))
      .finally(() => setLoadingFilters(false));
  }, [project.id]);
  useEffect(() => loadFilters(), [loadFilters]);

  const toggleSystem = (key: string) => {
    if (key === "all") return; // All tickets is always available
    const next = new Set(disabled);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setDisabled(next);
    if (next.has(key) && defaultKey === key) setDefaultKey("");
  };

  const saveProjectSettings = async () => {
    setSavingProject(true);
    try {
      await projectsApi.update(project.id, {
        disabled_view_keys: [...disabled],
        default_view_key: defaultKey,
      });
      toast.success("Filter settings saved.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save filter settings.");
    } finally {
      setSavingProject(false);
    }
  };

  const openCreate = () => setBuilder({ open: true, editing: null, name: "", conditions: [] });
  const openEdit = (sf: SavedFilter) =>
    setBuilder({
      open: true,
      editing: sf,
      name: sf.name,
      conditions: (sf.query_spec?.conditions as FilterCondition[]) ?? [],
    });

  const submitFilter = async (name: string, conditions: FilterCondition[]) => {
    setSavingFilter(true);
    try {
      const query_spec = buildSpec(conditions, "all");
      if (builder.editing) {
        await savedFiltersApi.update(builder.editing.id, { name, query_spec });
        toast.success("Filter updated.");
      } else {
        await savedFiltersApi.create({
          name,
          query_spec,
          is_shared: true,
          project: project.id,
          sort_order: filters.length,
        });
        toast.success("Filter created.");
      }
      setBuilder((b) => ({ ...b, open: false }));
      loadFilters();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save the filter.");
    } finally {
      setSavingFilter(false);
    }
  };

  const removeFilter = async (sf: SavedFilter) => {
    try {
      await savedFiltersApi.delete(sf.id);
      // If this filter was the project default, the persisted reference is now
      // dangling — clear it on the server right away (don't wait for "Save
      // defaults", which the admin may never click).
      if (defaultKey === `saved:${sf.id}`) {
        setDefaultKey("");
        await projectsApi.update(project.id, { default_view_key: "" });
        await refresh();
      }
      toast.success(`Deleted “${sf.name}”`);
      loadFilters();
    } catch {
      toast.error("Could not delete the filter.");
    }
  };

  const moveFilter = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= filters.length) return;
    const next = filters.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    setFilters(next);
    try {
      await Promise.all(
        next.map((f, i) =>
          f.sort_order === i ? Promise.resolve(null) : savedFiltersApi.update(f.id, { sort_order: i }),
        ),
      );
    } catch {
      toast.error("Could not reorder filters.");
      loadFilters();
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      {/* ── Built-in (system) views ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Default views</h3>
          <p className="text-sm text-muted-foreground">
            Built-in views available in this project&apos;s queue dropdown. “All tickets” is always
            available; uncheck any other view to hide it for everyone on this project.
          </p>
        </div>
        <ul className="divide-y rounded-lg border">
          {opts.systemViews.map((v) => {
            const locked = v.key === "all";
            const enabled = locked || !disabled.has(v.key);
            return (
              <li key={v.key} className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={!canEdit || locked}
                  onChange={() => toggleSystem(v.key)}
                  aria-label={`Show ${v.name}`}
                  className="h-4 w-4"
                />
                <span className={cn("flex-1 text-sm", !enabled && "text-muted-foreground")}>{v.name}</span>
                {locked && <span className="text-xs text-muted-foreground">Always on</span>}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Project default view ────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Project default view</h3>
        <p className="text-sm text-muted-foreground">
          The view shown when an agent opens this queue without a personal default. Agents can set
          their own from the queue&apos;s view menu (the star).
        </p>
        <select
          className={selectCls}
          value={defaultKey}
          disabled={!canEdit}
          onChange={(e) => setDefaultKey(e.target.value)}
          aria-label="Project default view"
        >
          <option value="">Product default — Open tickets</option>
          <optgroup label="System views">
            {opts.systemViews
              .filter((v) => v.key === "all" || !disabled.has(v.key))
              .map((v) => (
                <option key={v.key} value={v.key}>
                  {v.name}
                </option>
              ))}
          </optgroup>
          {filters.length > 0 && (
            <optgroup label="Custom filters">
              {filters.map((f) => (
                <option key={f.id} value={`saved:${f.id}`}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {canEdit && (
          <div className="pt-1">
            <Button onClick={saveProjectSettings} disabled={savingProject}>
              {savingProject ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save defaults
            </Button>
          </div>
        )}
      </section>

      {/* ── Custom (shared) filters ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Custom filters</h3>
            <p className="text-sm text-muted-foreground">
              Shared filters that appear under “Project filters” in the queue dropdown.
            </p>
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New filter
            </Button>
          )}
        </div>
        {loadingFilters ? (
          <p className="text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading…
          </p>
        ) : filters.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            No custom filters yet.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {filters.map((f, idx) => {
              const count = f.query_spec?.conditions?.length ?? 0;
              return (
                <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-1 truncate text-sm">{f.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {count} condition{count === 1 ? "" : "s"}
                  </span>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => moveFilter(idx, -1)}
                        disabled={idx === 0}
                        aria-label={`Move ${f.name} up`}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveFilter(idx, 1)}
                        disabled={idx === filters.length - 1}
                        aria-label={`Move ${f.name} down`}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(f)}
                        aria-label={`Edit ${f.name}`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFilter(f)}
                        aria-label={`Delete ${f.name}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <FilterBuilderDialog
        opts={opts}
        open={builder.open}
        onOpenChange={(o) => setBuilder((b) => ({ ...b, open: o }))}
        initialName={builder.name}
        initialConditions={builder.conditions}
        saving={savingFilter}
        onSubmit={submitFilter}
      />
    </div>
  );
}
