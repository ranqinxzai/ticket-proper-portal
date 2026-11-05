"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { helpdesksApi, projectsApi, savedFiltersApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import type { FilterCondition, Helpdesk, Project, SavedFilter, SavedFilterInput } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
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
import { FILTERS_HELP } from "@/lib/itsm/help/settings";

import { FieldPicker } from "@/components/tickets/filters/field-picker";
import { FilterChip } from "@/components/tickets/filters/filter-chip";
import { useCombinedFilterOptions, useFilterOptions } from "@/components/tickets/filters/use-filter-options";
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

/** Create/edit dialog for a shared saved filter (project or helpdesk All Tickets).
 *  State resets each time the dialog opens from the (stable) initial values
 *  supplied by the parent. */
function FilterBuilderDialog({
  opts,
  open,
  onOpenChange,
  initialName,
  initialConditions,
  description,
  saving,
  onSubmit,
}: {
  opts: Opts;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialName: string;
  initialConditions: FilterCondition[];
  description: string;
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
          <DialogDescription>{description}</DialogDescription>
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
          <Hint label={!saving && !name.trim() ? "Enter a filter name first" : ""}>
            <Button
              type="button"
              disabled={!name.trim() || saving}
              onClick={() => onSubmit(name.trim(), conditions)}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save filter
            </Button>
          </Hint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Scope-specific wording for the shared editor (project tab vs All-Tickets page). */
type ViewFiltersCopy = {
  defaultViewsBlurb: string;
  defaultViewTitle: string;
  defaultViewBlurb: string;
  defaultViewHelp: string;
  customBlurb: string;
  customHelp: string;
  dialogDescription: string;
};

/** The queue view-menu admin shared by a project's Filters tab and the helpdesk's
 *  All-Tickets Filters page: toggle which built-in views appear, manage shared
 *  custom filters (full builder), and pick the queue's default view. The wrappers
 *  supply the scope — which filters belong here, what a new filter is scoped to,
 *  and where the defaults persist. */
function ViewFiltersEditor({
  opts,
  canEdit,
  initialDisabled,
  initialDefault,
  loadScopeFilters,
  scope,
  saveSettings,
  copy,
}: {
  opts: Opts;
  canEdit: boolean;
  initialDisabled: string[];
  initialDefault: string;
  /** This scope's shared filters (any order; sorted here by `sort_order`). */
  loadScopeFilters: () => Promise<SavedFilter[]>;
  /** Sent on create so the new filter belongs to this queue. */
  scope: Pick<SavedFilterInput, "project" | "helpdesk">;
  /** Persist the defaults; an omitted key is left unchanged. */
  saveSettings: (patch: { disabled?: string[]; defaultKey?: string }) => Promise<void>;
  copy: ViewFiltersCopy;
}) {
  const [disabled, setDisabled] = useState<Set<string>>(() => new Set(initialDisabled));
  const [defaultKey, setDefaultKey] = useState<string>(initialDefault);
  const [savingDefaults, setSavingDefaults] = useState(false);

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
    loadScopeFilters()
      .then((rows) => setFilters(rows.slice().sort((a, b) => a.sort_order - b.sort_order)))
      .catch(() => setFilters([]))
      .finally(() => setLoadingFilters(false));
  }, [loadScopeFilters]);
  useEffect(() => loadFilters(), [loadFilters]);

  const toggleSystem = (key: string) => {
    if (key === "all") return; // All tickets is always available
    const next = new Set(disabled);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setDisabled(next);
    if (next.has(key) && defaultKey === key) setDefaultKey("");
  };

  const saveDefaults = async () => {
    setSavingDefaults(true);
    try {
      await saveSettings({ disabled: [...disabled], defaultKey });
      toast.success("Filter settings saved.");
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save filter settings.");
    } finally {
      setSavingDefaults(false);
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
        // Keep the sort a view saved from the queue carries (applySaved restores it).
        const ordering = builder.editing.query_spec?.ordering;
        await savedFiltersApi.update(builder.editing.id, {
          name,
          query_spec: ordering ? { ...query_spec, ordering } : query_spec,
        });
        toast.success("Filter updated.");
      } else {
        await savedFiltersApi.create({
          name,
          query_spec,
          is_shared: true,
          ...scope,
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
    if (!window.confirm(`Delete “${sf.name}”? This can't be undone.`)) return;
    try {
      await savedFiltersApi.delete(sf.id);
      // If this filter was the default, the persisted reference is now dangling —
      // clear it on the server right away (don't wait for "Save defaults", which
      // the admin may never click).
      if (defaultKey === `saved:${sf.id}`) {
        setDefaultKey("");
        await saveSettings({ defaultKey: "" });
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
          <p className="text-sm text-muted-foreground">{copy.defaultViewsBlurb}</p>
        </div>
        <ul className="divide-y rounded-lg border">
          {opts.systemViews.map((v) => {
            const locked = v.key === "all";
            const enabled = locked || !disabled.has(v.key);
            return (
              <li key={v.key} className="flex items-center gap-3 px-3 py-2">
                <Hint label={locked ? "All tickets is always available" : ""} side="right">
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={!canEdit || locked}
                    onChange={() => toggleSystem(v.key)}
                    aria-label={`Show ${v.name}`}
                    className="h-4 w-4"
                  />
                </Hint>
                <span className={cn("flex-1 text-sm", !enabled && "text-muted-foreground")}>{v.name}</span>
                {locked && <span className="text-xs text-muted-foreground">Always on</span>}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Queue default view ──────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold">
          {copy.defaultViewTitle}
          <InfoTip label="Which view opens first?">{copy.defaultViewHelp}</InfoTip>
        </h3>
        <p className="text-sm text-muted-foreground">{copy.defaultViewBlurb}</p>
        <select
          className={selectCls}
          value={defaultKey}
          disabled={!canEdit}
          onChange={(e) => setDefaultKey(e.target.value)}
          aria-label={copy.defaultViewTitle}
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
            <Hint label={savingDefaults ? "" : FILTERS_HELP.saveDefaults}>
              <Button onClick={saveDefaults} disabled={savingDefaults}>
                {savingDefaults ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save defaults
              </Button>
            </Hint>
          </div>
        )}
      </section>

      {/* ── Custom (shared) filters ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-1 text-sm font-semibold">
              Custom filters
              <InfoTip label="Who sees custom filters?">{copy.customHelp}</InfoTip>
            </h3>
            <p className="text-sm text-muted-foreground">{copy.customBlurb}</p>
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
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm" title={f.name}>{f.name}</span>
                    {f.owner_name ? (
                      <span className="block truncate text-xs text-muted-foreground">by {f.owner_name}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {count} condition{count === 1 ? "" : "s"}
                  </span>
                  {canEdit && (
                    <>
                      <IconButton
                        label={`Move ${f.name} up`}
                        detail="Order in the queue's view menu"
                        disabledReason="Already first"
                        onClick={() => moveFilter(idx, -1)}
                        disabled={idx === 0}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`Move ${f.name} down`}
                        detail="Order in the queue's view menu"
                        disabledReason="Already last"
                        onClick={() => moveFilter(idx, 1)}
                        disabled={idx === filters.length - 1}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`Edit ${f.name}`}
                        onClick={() => openEdit(f)}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={`Delete ${f.name}`}
                        detail="Removes it for everyone"
                        onClick={() => removeFilter(f)}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </IconButton>
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
        description={copy.dialogDescription}
        saving={savingFilter}
        onSubmit={submitFilter}
      />
    </div>
  );
}

const PROJECT_COPY: ViewFiltersCopy = {
  defaultViewsBlurb:
    "Built-in views available in this project's queue dropdown. “All tickets” is always available; uncheck any other view to hide it for everyone on this project.",
  defaultViewTitle: "Project default view",
  defaultViewBlurb:
    "The view shown when an agent opens this queue without a personal default. Agents can set their own from the queue's view menu (the star).",
  defaultViewHelp: FILTERS_HELP.defaultView,
  customBlurb: "Shared filters that appear under “Project filters” in the queue dropdown.",
  customHelp: FILTERS_HELP.custom,
  dialogDescription: "Build a query, then save it as a shared filter on this project's queue.",
};

/** Project settings → Filters tab. Admins toggle which built-in views appear,
 *  manage shared custom filters (full builder), and pick the project default. */
export function FiltersEditor({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const { refresh } = useWorkspace();
  const opts = useFilterOptions(project);

  const loadScopeFilters = useCallback(
    () =>
      savedFiltersApi
        .list({ project: project.id })
        .then((rows) => rows.filter((f) => f.is_shared && String(f.project) === String(project.id))),
    [project.id],
  );
  const saveSettings = useCallback(
    async ({ disabled, defaultKey }: { disabled?: string[]; defaultKey?: string }) => {
      await projectsApi.update(project.id, {
        ...(disabled !== undefined && { disabled_view_keys: disabled }),
        ...(defaultKey !== undefined && { default_view_key: defaultKey }),
      });
      await refresh();
    },
    [project.id, refresh],
  );

  return (
    <ViewFiltersEditor
      opts={opts}
      canEdit={canEdit}
      initialDisabled={project.disabled_view_keys ?? []}
      initialDefault={project.default_view_key ?? ""}
      loadScopeFilters={loadScopeFilters}
      scope={{ project: project.id }}
      saveSettings={saveSettings}
      copy={PROJECT_COPY}
    />
  );
}

const HELPDESK_COPY: ViewFiltersCopy = {
  defaultViewsBlurb:
    "Built-in views available in this helpdesk's All Tickets dropdown. “All tickets” is always available; uncheck any other view to hide it there for everyone. Each project's queue keeps its own setting.",
  defaultViewTitle: "All Tickets default view",
  defaultViewBlurb:
    "The view shown when an agent opens All Tickets without a personal default. Agents can set their own from the queue's view menu (the star).",
  defaultViewHelp: FILTERS_HELP.helpdeskDefaultView,
  customBlurb:
    "Shared with every agent in this helpdesk, under “Helpdesk filters” in the All Tickets dropdown and in each project's queue. Views agents shared from All Tickets are listed here too.",
  customHelp: FILTERS_HELP.helpdeskCustom,
  dialogDescription:
    "Build a query, then save it as a filter every agent in this helpdesk can use from All Tickets.",
};

/** Configuration → All-Tickets Filters. The same admin as a project's Filters tab,
 *  for the helpdesk's cross-project All Tickets queue: shared filters are
 *  `project=null, helpdesk=<this>` SavedFilters, defaults live on the helpdesk. */
export function HelpdeskFiltersEditor({ canEdit }: { canEdit: boolean }) {
  const { helpdesk } = useWorkspace();
  if (!helpdesk) return null;
  return <HelpdeskFilters key={helpdesk.id} helpdesk={helpdesk} canEdit={canEdit} />;
}

function HelpdeskFilters({ helpdesk, canEdit }: { helpdesk: Helpdesk; canEdit: boolean }) {
  const { helpdeskKey, projects, refresh } = useWorkspace();
  const opts = useCombinedFilterOptions({ helpdeskKey, helpdeskId: helpdesk.id, projects });

  // `?helpdesk=` also returns the caller's personal All-Tickets views — keep only
  // the ones shared with everyone in this helpdesk.
  const loadScopeFilters = useCallback(
    () =>
      savedFiltersApi
        .list({ helpdesk: helpdesk.id })
        .then((rows) =>
          rows.filter((f) => f.is_shared && f.project == null && String(f.helpdesk) === String(helpdesk.id)),
        ),
    [helpdesk.id],
  );
  const saveSettings = useCallback(
    async ({ disabled, defaultKey }: { disabled?: string[]; defaultKey?: string }) => {
      await helpdesksApi.update(helpdesk.id, {
        ...(disabled !== undefined && { combined_disabled_view_keys: disabled }),
        ...(defaultKey !== undefined && { combined_default_view_key: defaultKey }),
      });
      await refresh();
    },
    [helpdesk.id, refresh],
  );

  return (
    <ViewFiltersEditor
      opts={opts}
      canEdit={canEdit}
      initialDisabled={helpdesk.combined_disabled_view_keys ?? []}
      initialDefault={helpdesk.combined_default_view_key ?? ""}
      loadScopeFilters={loadScopeFilters}
      scope={{ project: null, helpdesk: helpdesk.id }}
      saveSettings={saveSettings}
      copy={HELPDESK_COPY}
    />
  );
}
