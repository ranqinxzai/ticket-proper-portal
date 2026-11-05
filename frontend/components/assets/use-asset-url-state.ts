"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  filtersFromParams,
  intParam,
  type FilterValues,
} from "./asset-utils";

export type AssetUrlPatch = Record<string, string | number | null | undefined>;

/** Filters, page, page size, ordering (and any extra keys, e.g. `group_by`) kept in the
 *  URL with `router.replace(…, { scroll: false })`, so dashboard tiles can deep-link and
 *  back/forward restore the view. Any change other than `page` goes back to page 1. */
export function useAssetUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const spKey = sp.toString();

  const state = useMemo(() => {
    const p = new URLSearchParams(spKey);
    return {
      filters: filtersFromParams(p) as FilterValues,
      page: intParam(p.get("page"), 1),
      pageSize: intParam(p.get("page_size"), DEFAULT_PAGE_SIZE, PAGE_SIZES),
      ordering: p.get("ordering") ?? "",
      get: (key: string) => p.get(key) ?? "",
    };
  }, [spKey]);

  const update = useCallback(
    (patch: AssetUrlPatch) => {
      const next = new URLSearchParams(spKey);
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === "") next.delete(k);
        else next.set(k, String(v));
      }
      if (!("page" in patch)) next.delete("page");
      if (next.get("page") === "1") next.delete("page");
      if (next.get("page_size") === String(DEFAULT_PAGE_SIZE)) next.delete("page_size");
      const q = next.toString();
      if (q === spKey) return;
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [spKey, pathname, router],
  );

  return { ...state, spKey, update };
}
