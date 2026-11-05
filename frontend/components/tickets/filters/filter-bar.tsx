"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { savedFiltersApi } from "@/lib/itsm/api";
import type {
  FilterCondition,
  SavedFilter,
  SystemView,
} from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { FieldPicker } from "./field-picker";
import { FilterChip } from "./filter-chip";
import { SaveViewDialog, SavedViewsMenu } from "./saved-views";
import { buildSpec, DEFAULT_FIELD_KEYS } from "./filter-utils";
import type { useFilterOptions } from "./use-filter-options";

type Opts = ReturnType<typeof useFilterOptions>;

export function FilterBar({
  saveProjectId,
  opts,
  conditions,
  extraKeys,
  ordering,
  savedFilters,
  systemViews,
  currentUserId,
  activeLabel,
  defaultViewKey,
  onConditionsChange,
  onExtraKeysChange,
  onApplySystem,
  onApplySaved,
  onSetDefault,
  onClearAll,
  onReloadSaved,
  hideViews = false,
}: {
  /** Project id a newly-saved view is scoped to — `null` in the combined queue
   *  (a cross-project shared/personal filter, `project=null`). */
  saveProjectId: string | null;
  opts: Opts;
  conditions: FilterCondition[];
  extraKeys: string[];
  ordering: string;
  savedFilters: SavedFilter[];
  /** System views to offer in the dropdown (already filtered to the project's enabled set). */
  systemViews: SystemView[];
  currentUserId: string | number | null;
  activeLabel: string;
  defaultViewKey: string | null;
  onConditionsChange: (next: FilterCondition[]) => void;
  onExtraKeysChange: (next: string[]) => void;
  onApplySystem: (v: SystemView) => void;
  onApplySaved: (sf: SavedFilter) => void;
  onSetDefault: (key: string) => void;
  onClearAll: () => void;
  onReloadSaved: () => void;
  /** Modern queue (step B3): views live in the tab strip, so the bar is chips only. */
  hideViews?: boolean;
}) {
  // A view saved from All Tickets (no project) belongs to THIS helpdesk's All Tickets.
  const { helpdesk } = useWorkspace();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

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

  const hasActive = conditions.length > 0 || extraKeys.length > 0;
  const canSave = buildSpec(conditions, "all").conditions.length > 0;

  const saveView = async (name: string, isShared: boolean) => {
    try {
      await savedFiltersApi.create({
        name,
        // Persist the active sort alongside the spec so applying the view restores it
        // (applySaved reads query_spec.ordering).
        query_spec: { ...buildSpec(conditions, "all"), ordering },
        is_shared: isShared,
        project: saveProjectId,
        helpdesk: saveProjectId === null ? helpdesk?.id ?? null : null,
      });
      toast.success(`Saved “${name}”`);
      onReloadSaved();
    } catch {
      toast.error("Could not save filter");
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {hideViews ? null : (
        <>
        <SavedViewsMenu
          systemViews={systemViews}
          savedFilters={savedFilters}
          currentUserId={currentUserId}
          activeLabel={activeLabel}
          defaultViewKey={defaultViewKey}
          onApplySystem={onApplySystem}
          onApplySaved={onApplySaved}
          onSetDefault={onSetDefault}
          onDeleted={onReloadSaved}
        />
        {/* Separate the primary view selector from the per-field filter chips so the bar
            reads as two groups: [view] | [field filters]. */}
        <div className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        </>
        )}
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
        <Hint label={canSave ? "Save these filters and the current sort as a named view" : "Pick a value for at least one filter first"}>
          <Button type="button" variant="ghost" size="sm"
            onClick={() => setSaveOpen(true)} disabled={!canSave}>
            Save view
          </Button>
        </Hint>
        {hasActive && (
          <Hint label="Removes every filter, resets sorting and switches to the All tickets view. Your search text is kept.">
            <Button type="button" variant="ghost" size="sm" className="gap-1 text-muted-foreground"
              onClick={onClearAll}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear all
            </Button>
          </Hint>
        )}
      </div>

      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        onSave={saveView}
        crossProject={saveProjectId === null}
      />
    </>
  );
}
