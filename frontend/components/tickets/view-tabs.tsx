"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Hint } from "@/components/ui/hint";
import { ticketsApi, type TicketListParams } from "@/lib/itsm/api";
import { MODERN_QUEUE_HELP, VIEW_HELP } from "@/lib/itsm/help/queue";
import type { FilterCondition, SavedFilter, SystemView } from "@/lib/itsm/types";
import { cn } from "@/lib/utils";
import { serializeSpec } from "./filters/filter-utils";

/**
 * Modern queue view tabs (step B3, 2026-11-05): the queue's views as a tab strip with
 * live counts, like Jira's queues and Linear's views. Classic keeps the "Open ▾"
 * dropdown (`SavedViewsMenu`); Modern shows the same views here and keeps that menu,
 * with a small "Views" trigger, for the long tail, stars and deletes.
 */
export type QueueViewTab = { key: string; name: string; conditions: FilterCondition[]; help: string };

export const MAX_VIEW_TABS = 6;

/** The tabs to show, in order: the agent's starred default, the system views, their
 *  own saved views, then shared ones. At most `max`; the active view is always shown
 *  (it takes the last slot when it would otherwise fall off). */
export function buildViewTabs({
  systemViews,
  savedFilters,
  currentUserId,
  defaultViewKey,
  activeKey,
  max = MAX_VIEW_TABS,
}: {
  systemViews: SystemView[];
  savedFilters: SavedFilter[];
  currentUserId: string | number | null;
  defaultViewKey: string | null;
  activeKey: string | null;
  max?: number;
}): QueueViewTab[] {
  const own = (sf: SavedFilter) => currentUserId != null && String(sf.owner) === String(currentUserId);
  const all: QueueViewTab[] = [
    ...systemViews.map((v) => ({
      key: v.key,
      name: v.name,
      conditions: (v.query_spec?.conditions as FilterCondition[]) ?? [],
      help: VIEW_HELP[v.key] ?? v.name,
    })),
    ...[...savedFilters.filter(own), ...savedFilters.filter((sf) => sf.is_shared && !own(sf))].map((sf) => ({
      key: `saved:${sf.id}`,
      name: sf.name,
      conditions: (sf.query_spec?.conditions as FilterCondition[]) ?? [],
      help: own(sf) ? (sf.is_shared ? "Your saved view, shared with others" : "Your saved view") : "Shared view",
    })),
  ];
  const byKey = new Map(all.map((t) => [t.key, t]));
  const ordered: QueueViewTab[] = [];
  const push = (t: QueueViewTab | undefined) => {
    if (t && !ordered.includes(t)) ordered.push(t);
  };
  if (defaultViewKey) push(byKey.get(defaultViewKey));
  all.forEach(push);
  const shown = ordered.slice(0, max);
  const active = activeKey ? byKey.get(activeKey) : undefined;
  if (active && !shown.includes(active)) shown[shown.length - 1] = active;
  return shown;
}

// Counts are `tickets/pulse/` aggregates (one cheap COUNT per view), cached per
// scope + view for a minute so switching queues or views doesn't refetch.
const COUNT_TTL_MS = 60_000;
const countCache = new Map<string, { n: number; at: number }>();

/** Live counts for `tabs` within `listParams` (the queue scope, no search). `refreshKey`
 *  changes when the queue's own live poll saw a change: that refetches past the cache. */
export function useViewCounts(
  tabs: QueueViewTab[],
  listParams: TicketListParams,
  refreshKey: number,
  enabled: boolean,
): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const scopeSig = JSON.stringify(listParams);
  const specs = useMemo(
    () => tabs.map((t) => ({ key: t.key, q: serializeSpec(t.conditions, "all") })),
    [tabs],
  );
  const specSig = JSON.stringify(specs);
  const lastRefresh = useRef(refreshKey);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const force = lastRefresh.current !== refreshKey;
    lastRefresh.current = refreshKey;
    const now = Date.now();
    const fresh: Record<string, number> = {};
    const stale: { key: string; q?: string; cacheKey: string }[] = [];
    for (const s of JSON.parse(specSig) as { key: string; q?: string }[]) {
      const cacheKey = `${scopeSig}|${s.q ?? ""}`;
      const hit = countCache.get(cacheKey);
      if (hit && !force && now - hit.at < COUNT_TTL_MS) fresh[s.key] = hit.n;
      else stale.push({ ...s, cacheKey });
    }
    setCounts(fresh);
    const params = JSON.parse(scopeSig) as TicketListParams;
    void Promise.allSettled(
      stale.map(async (s) => {
        const r = await ticketsApi.pulse({ ...params, q: s.q });
        countCache.set(s.cacheKey, { n: r.count, at: Date.now() });
        if (!cancelled) setCounts((cur) => ({ ...cur, [s.key]: r.count }));
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, scopeSig, specSig, refreshKey]);

  return counts;
}

export function ViewTabs({
  tabs,
  activeKey,
  counts,
  liveCount,
  customActive,
  panelId,
  onSelect,
  onCustom,
  className,
}: {
  tabs: QueueViewTab[];
  /** The selected view's key, or null for an ad-hoc ("Custom filter") view. */
  activeKey: string | null;
  counts: Record<string, number>;
  /** The list's own total for the active view (fresher than the cached count), when known. */
  liveCount: number | null;
  /** Show the "Custom filter" tab (filters edited away from a saved/system view). */
  customActive: boolean;
  panelId: string;
  onSelect: (key: string) => void;
  onCustom: () => void;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Arrow keys move focus between tabs; Enter / Space opens one (manual activation:
  // each view is a server fetch, so we don't fetch on every arrow press).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
    items[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const tabCls = (selected: boolean) =>
    cn(
      "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 text-sm font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      selected
        ? "text-foreground after:absolute after:inset-x-1.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Views"
      onKeyDown={onKeyDown}
      className={cn(
        "flex min-w-0 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {tabs.map((t) => {
        const selected = !customActive && t.key === activeKey;
        const n = selected && liveCount != null ? liveCount : counts[t.key];
        return (
          <Hint key={t.key} label={`${t.help}\n${MODERN_QUEUE_HELP.tabCount}`} side="bottom">
            <button
              type="button"
              role="tab"
              id={`view-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(t.key)}
              className={tabCls(selected)}
            >
              {t.name}
              {n != null ? (
                <span className="tabular-nums text-xs font-normal text-muted-foreground">{n.toLocaleString()}</span>
              ) : null}
            </button>
          </Hint>
        );
      })}
      {customActive ? (
        <Hint label="Filters you changed by hand. Save them as a view from the filter row." side="bottom">
          <button
            type="button"
            role="tab"
            id="view-tab-custom"
            aria-selected
            aria-controls={panelId}
            tabIndex={0}
            onClick={onCustom}
            className={tabCls(true)}
          >
            Custom filter
            {liveCount != null ? (
              <span className="tabular-nums text-xs font-normal text-muted-foreground">{liveCount.toLocaleString()}</span>
            ) : null}
          </button>
        </Hint>
      ) : null}
    </div>
  );
}
