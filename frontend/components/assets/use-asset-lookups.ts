"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  assetCategoriesApi,
  assetStatusesApi,
  departmentsApi,
  locationsApi,
  vendorsApi,
} from "@/lib/itsm/assets-api";
import type { AssetCategory, AssetStatus, Department, Location, Vendor } from "@/lib/itsm/assets-types";

export type AssetLookups = {
  loading: boolean;
  /** Every category + sub-category of the helpdesk (inactive included unless `activeOnly`). */
  categories: AssetCategory[];
  topCategories: AssetCategory[];
  subCategoriesOf: (categoryId: string | null | undefined) => AssetCategory[];
  statuses: AssetStatus[];
  vendors: Vendor[];
  locations: Location[];
  departments: Department[];
  reload: () => void;
};

/** Loads the pickers the asset screens share (categories are per helpdesk; statuses,
 *  vendors, locations and departments are org-wide). Each list loads independently, so
 *  one failure doesn't blank the rest. */
export function useAssetLookups(helpdeskId: string | null | undefined, { activeOnly = false } = {}): AssetLookups {
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [statuses, setStatuses] = useState<AssetStatus[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!helpdeskId) return;
    let alive = true;
    setLoading(true);
    const safe = <T,>(p: Promise<T[]>, set: (v: T[]) => void) =>
      p.then((v) => alive && set(v)).catch(() => alive && set([]));
    void Promise.all([
      safe(assetCategoriesApi.list({ helpdesk: helpdeskId, active: activeOnly }), setCategories),
      safe(assetStatusesApi.list(), setStatuses),
      safe(vendorsApi.list({ active: activeOnly }), setVendors),
      safe(locationsApi.list({ active: activeOnly }), setLocations),
      safe(departmentsApi.list({ active: activeOnly }), setDepartments),
    ]).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [helpdeskId, activeOnly, tick]);

  const topCategories = useMemo(() => categories.filter((c) => !c.parent), [categories]);
  const subCategoriesOf = useCallback(
    (id: string | null | undefined) => (id ? categories.filter((c) => c.parent === id) : []),
    [categories],
  );
  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { loading, categories, topCategories, subCategoriesOf, statuses, vendors, locations, departments, reload };
}
