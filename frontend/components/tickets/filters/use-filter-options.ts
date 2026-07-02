"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { groupsApi, ticketsApi, workflowsApi } from "@/lib/itsm/api";
import type {
  FilterFieldMeta,
  FilterFieldOption,
  Group,
  Project,
  SystemView,
  TicketType,
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

type FetchState = {
  fields: FilterFieldMeta[];
  systemViews: SystemView[];
  statuses: WorkflowStatus[];
  groups: Group[];
  types: TicketType[];
  loading: boolean;
};

const EMPTY_STATE: FetchState = {
  fields: [], systemViews: [], statuses: [], groups: [], types: [], loading: true,
};

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const m = new Map<string, T>();
  for (const r of rows) m.set(r.id, r);
  return [...m.values()];
}

/** The memoised derivations every filter bar needs, shared by the single-project
 *  and combined (cross-project) hooks — only the *fetch* differs between them. */
function useDerived({ fields, systemViews, statuses, groups, types, loading }: FetchState): Options {
  const [userLabels, setUserLabels] = useState<Record<string, string>>({});

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

/** Loads + memoizes everything the filter bar needs for ONE project. The parent
 *  queue remounts per project (key=project.key), so caches reset on switch. */
export function useFilterOptions(project: Project): Options {
  const [state, setState] = useState<FetchState>(EMPTY_STATE);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    Promise.all([
      ticketsApi.filterFields({ project: project.id }).catch(() => ({ fields: [], system_views: [] })),
      project.default_workflow
        ? workflowsApi.statuses(project.default_workflow).catch(() => [])
        : Promise.resolve([] as WorkflowStatus[]),
      groupsApi.list({ helpdesk: project.helpdesk, is_active: true }).catch(() => [] as Group[]),
    ]).then(([ff, sts, grps]) => {
      if (cancelled) return;
      setState({
        fields: ff.fields ?? [], systemViews: ff.system_views ?? [],
        statuses: sts ?? [], groups: grps ?? [], types: project.ticket_types ?? [],
        loading: false,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [project.id, project.default_workflow, project.helpdesk, project.ticket_types]);

  return useDerived(state);
}

/** The combined ("All tickets") variant: fields are the backend UNION across the
 *  helpdesk's projects (`?helpdesk=`); statuses + ticket types are unioned across
 *  every scoped project's workflow (deduped by id) so a specific-status / type chip
 *  still resolves. Groups come from the helpdesk. Same return shape as
 *  `useFilterOptions`. */
export function useCombinedFilterOptions(scope: {
  helpdeskKey: string;
  helpdeskId: string;
  projects: Project[];
}): Options {
  const [state, setState] = useState<FetchState>(EMPTY_STATE);
  // Stable dep key: the scoped projects + each one's workflow (types/workflow rarely
  // change mid-session, so keying by id + workflow is enough to refetch on change).
  const projectsKey = useMemo(
    () => scope.projects.map((p) => `${p.id}:${p.default_workflow ?? ""}`).join(","),
    [scope.projects],
  );

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const wfIds = [...new Set(scope.projects.map((p) => p.default_workflow).filter(Boolean))] as string[];
    const typeUnion = dedupeById(scope.projects.flatMap((p) => p.ticket_types ?? []));
    Promise.all([
      ticketsApi.filterFields({ helpdesk: scope.helpdeskKey }).catch(() => ({ fields: [], system_views: [] })),
      Promise.all(wfIds.map((id) => workflowsApi.statuses(id).catch(() => [] as WorkflowStatus[]))).then(
        (arrs) => dedupeById(arrs.flat()),
      ),
      groupsApi.list({ helpdesk: scope.helpdeskId, is_active: true }).catch(() => [] as Group[]),
    ]).then(([ff, sts, grps]) => {
      if (cancelled) return;
      setState({
        fields: ff.fields ?? [], systemViews: ff.system_views ?? [],
        statuses: sts, groups: grps ?? [], types: typeUnion,
        loading: false,
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.helpdeskKey, scope.helpdeskId, projectsKey]);

  return useDerived(state);
}
