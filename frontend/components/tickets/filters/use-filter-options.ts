"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { groupsApi, ticketsApi, workflowsApi } from "@/lib/itsm/api";
import type {
  FilterFieldMeta,
  FilterFieldOption,
  Group,
  Project,
  SystemView,
  WorkflowStatus,
} from "@/lib/itsm/types";
import type { LabelResolver } from "./filter-utils";

type Options = {
  fields: FilterFieldMeta[];
  systemViews: SystemView[];
  statuses: WorkflowStatus[];
  loading: boolean;
  fieldByKey: (key: string) => FilterFieldMeta | undefined;
  optionsForField: (field: FilterFieldMeta) => FilterFieldOption[];
  labelFor: LabelResolver;
  /** Cache a user's display name so chip summaries can resolve picked users. */
  registerUserLabel: (id: string, label: string) => void;
};

/** Loads + memoizes everything the filter bar needs for one project. The parent
 *  queue remounts per project (key=project.key), so caches reset on switch. */
export function useFilterOptions(project: Project): Options {
  const [fields, setFields] = useState<FilterFieldMeta[]>([]);
  const [systemViews, setSystemViews] = useState<SystemView[]>([]);
  const [statuses, setStatuses] = useState<WorkflowStatus[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [userLabels, setUserLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      ticketsApi.filterFields(project.id).catch(() => ({ fields: [], system_views: [] })),
      project.default_workflow
        ? workflowsApi.statuses(project.default_workflow).catch(() => [])
        : Promise.resolve([] as WorkflowStatus[]),
      groupsApi.list({ helpdesk: project.helpdesk, is_active: true }).catch(() => [] as Group[]),
    ]).then(([ff, sts, grps]) => {
      if (cancelled) return;
      setFields(ff.fields ?? []);
      setSystemViews(ff.system_views ?? []);
      setStatuses(sts ?? []);
      setGroups(grps ?? []);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [project.id, project.default_workflow, project.helpdesk]);

  const types = useMemo(() => project.ticket_types ?? [], [project.ticket_types]);

  const statusById = useMemo(
    () => Object.fromEntries(statuses.map((s) => [s.id, s.name])),
    [statuses],
  );
  const groupById = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups]);
  const typeById = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t.name])), [types]);
  const inlineByKey = useMemo(() => {
    const map: Record<string, Record<string, string>> = {};
    for (const f of fields) {
      if (f.options) map[f.key] = Object.fromEntries(f.options.map((o) => [o.value, o.label]));
    }
    return map;
  }, [fields]);

  const fieldByKey = useCallback((key: string) => fields.find((f) => f.key === key), [fields]);

  const optionsForField = useCallback(
    (field: FilterFieldMeta): FilterFieldOption[] => {
      if (field.options) return field.options;
      switch (field.options_source) {
        case "statuses":
          return statuses.map((s) => ({ value: s.id, label: s.name, color: s.color }));
        case "groups":
          return groups.map((g) => ({ value: g.id, label: g.name }));
        case "ticket_types":
          return types.map((t) => ({ value: t.id, label: t.name }));
        default:
          return [];
      }
    },
    [statuses, groups, types],
  );

  const labelFor = useCallback<LabelResolver>(
    (fieldKey, value) => {
      if (userLabels[value]) return userLabels[value];
      if (inlineByKey[fieldKey]?.[value]) return inlineByKey[fieldKey][value];
      const field = fields.find((f) => f.key === fieldKey);
      switch (field?.options_source) {
        case "statuses":
          return statusById[value];
        case "groups":
          return groupById[value];
        case "ticket_types":
          return typeById[value];
        default:
          return undefined;
      }
    },
    [userLabels, inlineByKey, fields, statusById, groupById, typeById],
  );

  const registerUserLabel = useCallback(
    (id: string, label: string) => setUserLabels((m) => (m[id] === label ? m : { ...m, [id]: label })),
    [],
  );

  return {
    fields, systemViews, statuses, loading,
    fieldByKey, optionsForField, labelFor, registerUserLabel,
  };
}
