"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { useItsmAuth } from "@/lib/itsm/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { queueColumnsApi, queueViewApi, savedFiltersApi, ticketsApi } from "@/lib/itsm/api";
import { useLivePoll } from "@/lib/itsm/use-live-poll";
import type {
  FilterCondition,
  Project,
  SavedFilter,
  SystemView,
  TicketListItem,
} from "@/lib/itsm/types";
import { cn } from "@/lib/utils";
import { FilterBar } from "./filters/filter-bar";
import { useFilterOptions } from "./filters/use-filter-options";
import {
  DEFAULT_FIELD_KEYS,
  PRODUCT_DEFAULT_VIEW_KEY,
  parseSpec,
  serializeSpec,
} from "./filters/filter-utils";
import { ColumnPicker } from "./column-picker";
import { QUEUE_COLUMN_MAP, renderQueueCell, resolveQueueColumns } from "./queue-columns";

const PAGE_SIZE = 25;
const DEFAULT_ORDERING = "-created_at";

/** Windowed list of page numbers with ellipsis gaps: 1 … 11 12 13 … 25 */
function pageList(current: number, total: number): (number | "ellipsis")[] {
  const wanted = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("ellipsis");
    out.push(p);
    prev = p;
  }
  return out;
}

const extrasFromConditions = (conds: FilterCondition[]) =>
  [...new Set(conds.map((c) => c.field).filter((k) => !DEFAULT_FIELD_KEYS.includes(k)))];

/** Per-project sessionStorage key holding the last-used queue query string
 *  (the same `q`/`search`/`ordering`/`page`/`view` params synced to the URL).
 *  Lets a return to the queue (Back to queue link, browser back, re-clicking the
 *  project in nav) restore the agent's active filters instead of the default view. */
const queueStateKey = (projectId: string) => `itsm:queue:${projectId}`;

/** Read the stored queue query string for a project, or null if none / unavailable. */
function readStoredQueueState(projectId: string): URLSearchParams | null {
  try {
    const raw = window.sessionStorage.getItem(queueStateKey(projectId));
    return raw === null ? null : new URLSearchParams(raw);
  } catch {
    return null; // sessionStorage disabled / unavailable — fall back to defaults
  }
}

/** Whole-row → ticket navigation. A bare left-click anywhere in the row opens the
 *  ticket; clicks on a real interactive element (the ID/Summary anchors, a button,
 *  a form control) are left to handle themselves, and a modified click (Ctrl/Cmd/
 *  Shift/middle — "open in new tab", "select") is not hijacked. The ID & Summary
 *  cells keep their `<a>` so keyboard/AT users and new-tab still work. */
function openTicketFromRow(e: React.MouseEvent<HTMLTableRowElement>, open: () => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label, [role='button']")) return;
  open();
}

export function TicketQueue({ project }: { project: Project }) {
  const { org, helpdeskKey } = useWorkspace();
  const { user } = useItsmAuth();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const base = `/t/${org}/agent/w/${helpdeskKey}/p/${project.key}`;

  const opts = useFilterOptions(project);

  // System views offered in this project's dropdown — "All tickets" is always
  // shown; admins hide the rest via Settings → Filters (project.disabled_view_keys).
  const disabledViews = useMemo(
    () => new Set(project.disabled_view_keys ?? []),
    [project.disabled_view_keys],
  );
  const enabledSystemViews = useMemo(
    () => opts.systemViews.filter((v) => v.key === "all" || !disabledViews.has(v.key)),
    [opts.systemViews, disabledViews],
  );

  // ── filter / sort state (hydrated once from the URL) ──────────────────────
  const [conditions, setConditions] = useState<FilterCondition[]>(() => parseSpec(sp.get("q")).conditions);
  const [extraKeys, setExtraKeys] = useState<string[]>(() => extrasFromConditions(parseSpec(sp.get("q")).conditions));
  const [search, setSearch] = useState(() => sp.get("search") ?? "");
  const [ordering, setOrdering] = useState(() => sp.get("ordering") ?? DEFAULT_ORDERING);
  const [page, setPage] = useState(() => Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1));
  const [viewKey, setViewKey] = useState<string | null>(() => sp.get("view"));

  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [savedLoaded, setSavedLoaded] = useState(false);

  // ── personal default view (applied on a fresh visit with no ?view/?q) ──────
  const [defaultViewKey, setDefaultViewKey] = useState<string | null>(null);
  const [prefLoaded, setPrefLoaded] = useState(false);
  // A deep link (?view / ?q present) is honoured verbatim — skip resolution and
  // render immediately; otherwise hold the first fetch until the default resolves.
  const hadUrlView = useRef<boolean>(!!(sp.get("view") || sp.get("q")));
  const [ready, setReady] = useState<boolean>(() => hadUrlView.current);
  const resolvedRef = useRef(false);

  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  // A background refresh that arrives while the agent is mid-action (scrolled, on a
  // later page, or hovering a row) is staged here instead of swapping rows underneath
  // them — surfaced as a "Refresh" pill, mirroring Jira's "board updated" banner.
  const [pending, setPending] = useState<{ results: TicketListItem[]; count: number } | null>(null);
  const tableHoverRef = useRef(false);

  // ── column layout (per-agent override → project default → built-in) ───────
  const [colPref, setColPref] = useState<string[] | null>(null);
  const columns = useMemo(
    () => resolveQueueColumns(colPref, project.queue_columns),
    [colPref, project.queue_columns],
  );
  // `now` drives the relative SLA labels; bump once a minute so they stay fresh.
  const [now, setNow] = useState(() => Date.now());

  const qParam = useMemo(() => serializeSpec(conditions, "all"), [conditions]);

  // ── load saved filters for this project ───────────────────────────────────
  const reloadSaved = useMemo(
    () => () => {
      savedFiltersApi
        .list({ project: project.id })
        .then(setSavedFilters)
        .catch(() => setSavedFilters([]))
        .finally(() => setSavedLoaded(true));
    },
    [project.id],
  );
  useEffect(() => reloadSaved(), [reloadSaved]);

  // ── load this agent's personal default view for the project ───────────────
  useEffect(() => {
    let cancelled = false;
    queueViewApi
      .get(project.id)
      .then((k) => !cancelled && setDefaultViewKey(k))
      .catch(() => !cancelled && setDefaultViewKey(null))
      .finally(() => !cancelled && setPrefLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  // ── load this agent's saved column layout for the project ─────────────────
  useEffect(() => {
    let cancelled = false;
    queueColumnsApi
      .get(project.id)
      .then((cols) => !cancelled && setColPref(cols))
      .catch(() => !cancelled && setColPref(null));
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  // Refresh relative SLA labels every minute.
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(h);
  }, []);

  // Persist a column change (empty list ⇒ clear the override → project/default).
  const changeColumns = (next: string[]) => {
    setColPref(next);
    queueColumnsApi.set(project.id, next).catch(() => undefined);
  };
  const resetColumns = () => {
    setColPref(null);
    queueColumnsApi.set(project.id, []).catch(() => undefined);
  };

  // ── keep the URL in sync (shareable / bookmarkable) + remember last-used ────
  useEffect(() => {
    const params = new URLSearchParams();
    if (qParam) params.set("q", qParam);
    if (search) params.set("search", search);
    if (ordering && ordering !== DEFAULT_ORDERING) params.set("ordering", ordering);
    if (page > 1) params.set("page", String(page));
    if (viewKey) params.set("view", viewKey);
    const s = params.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    // Persist the active state so returning to the queue restores it. Gated on
    // `ready` so the pre-resolution empty state never clobbers a stored value.
    if (ready) {
      try {
        window.sessionStorage.setItem(queueStateKey(project.id), s);
      } catch {
        /* sessionStorage disabled / full — URL stays the source of truth */
      }
    }
  }, [qParam, search, ordering, page, viewKey, pathname, router, ready, project.id]);

  // ── live params (the filter scope, page-independent) for the pulse poller ────
  const liveParams = useMemo(
    () => ({ project: project.id, q: qParam, search: search || undefined, ordering }),
    [project.id, qParam, search, ordering],
  );

  // ── fetch the current page ──────────────────────────────────────────────────
  // `silent` (a background poll) never flips the loading spinner and routes the
  // result through the hybrid apply rule below; the user-driven path shows the
  // spinner and replaces rows immediately. A monotonic seq guards against a slow
  // fetch overwriting a newer one (debounce-cancel + silent/user races).
  const fetchSeq = useRef(0);
  const loadPage = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const seq = ++fetchSeq.current;
      if (!silent) setLoading(true);
      try {
        const r = await ticketsApi.listPaged({ ...liveParams, page, page_size: PAGE_SIZE });
        if (seq !== fetchSeq.current) return; // a newer fetch superseded this one
        if (silent) {
          // Apply silently only when the agent is idle at the top of page 1 and not
          // hovering a row (about to click); otherwise stage behind the refresh pill
          // so rows never shift under an in-progress action.
          const safe =
            page === 1 &&
            !tableHoverRef.current &&
            (typeof window === "undefined" || window.scrollY < 40);
          if (safe) {
            setTickets(r.results);
            setCount(r.count);
            setPending(null);
          } else {
            setPending({ results: r.results, count: r.count });
          }
        } else {
          setTickets(r.results);
          setCount(r.count);
          setPending(null);
        }
      } catch {
        if (seq !== fetchSeq.current) return;
        if (!silent) {
          setTickets([]);
          setCount(0);
        }
        // silent failures: keep the current rows and retry on the next tick
      } finally {
        if (seq === fetchSeq.current && !silent) setLoading(false);
      }
    },
    [liveParams, page],
  );

  // User-driven fetch (filters / sort / page change) — debounced, shows the spinner.
  useEffect(() => {
    if (!ready) return; // hold until the default view is resolved (fresh visit)
    const handle = setTimeout(() => void loadPage(), 300);
    return () => clearTimeout(handle);
  }, [loadPage, ready]);

  // Silent live refresh — poll the cheap pulse token; on change, refetch silently.
  useLivePoll({
    enabled: ready,
    key: `${JSON.stringify(liveParams)}|p${page}`,
    pulse: async () => (await ticketsApi.pulse(liveParams)).version,
    onChange: () => loadPage({ silent: true }),
  });

  // Apply a staged background refresh (the "Refresh" pill) and jump back to the top.
  const applyPending = () => {
    if (!pending) return;
    setTickets(pending.results);
    setCount(pending.count);
    setPending(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── state mutators (filter changes always reset to page 1) ────────────────
  const changeConditions = (next: FilterCondition[]) => {
    setConditions(next);
    setViewKey(null);
    setPage(1);
  };
  const onSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const applySpec = (conds: FilterCondition[], orderingNext: string, key: string | null) => {
    setConditions(conds);
    setExtraKeys(extrasFromConditions(conds));
    setOrdering(orderingNext);
    setViewKey(key);
    setPage(1);
  };
  const applySystem = (v: SystemView) =>
    applySpec((v.query_spec?.conditions as FilterCondition[]) ?? [], v.ordering ?? DEFAULT_ORDERING, v.key);
  const applySaved = (sf: SavedFilter) =>
    applySpec(
      (sf.query_spec?.conditions as FilterCondition[]) ?? [],
      (sf.query_spec?.ordering as string) ?? DEFAULT_ORDERING,
      `saved:${sf.id}`,
    );
  const clearAll = () => applySpec([], DEFAULT_ORDERING, "all");

  // ── resolve the active view on a fresh visit (no ?view/?q in the URL) ──────
  // Precedence: last-used (this session, restored from sessionStorage) → personal
  // default → project default → product default ("open") → All tickets. Each
  // candidate must still resolve to an available view; runs once.
  useEffect(() => {
    if (ready || resolvedRef.current) return;
    if (opts.loading || !prefLoaded || !savedLoaded) return; // wait for inputs
    resolvedRef.current = true;

    // 1) Restore the last-used filter/sort/view/page for this project so opening
    //    a ticket and returning to the queue keeps the agent's active filters.
    const stored = readStoredQueueState(project.id);
    if (stored) {
      const parsed = parseSpec(stored.get("q"));
      setConditions(parsed.conditions);
      setExtraKeys(extrasFromConditions(parsed.conditions));
      setSearch(stored.get("search") ?? "");
      setOrdering(stored.get("ordering") ?? DEFAULT_ORDERING);
      setPage(Math.max(1, parseInt(stored.get("page") ?? "1", 10) || 1));
      setViewKey(stored.get("view"));
      setReady(true);
      return;
    }

    // 2) No stored state (genuinely fresh session) — resolve the default view.
    const candidates = [defaultViewKey, project.default_view_key, PRODUCT_DEFAULT_VIEW_KEY, "all"];
    for (const key of candidates) {
      if (!key) continue;
      if (key.startsWith("saved:")) {
        const sf = savedFilters.find((s) => s.id === key.slice(6));
        if (sf) { applySaved(sf); break; }
        continue;
      }
      const v = enabledSystemViews.find((x) => x.key === key);
      if (v) { applySystem(v); break; }
    }
    setReady(true);
    // applySystem/applySaved are stable enough for a once-guarded resolver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, opts.loading, prefLoaded, savedLoaded, defaultViewKey, savedFilters, enabledSystemViews, project.default_view_key, project.id]);

  // Persist a view key (system key or "saved:<id>") as this agent's default.
  const setDefault = (key: string) => {
    const prev = defaultViewKey;
    setDefaultViewKey(key);
    queueViewApi
      .set(project.id, key)
      .then(() => toast.success("Default view updated"))
      .catch(() => { setDefaultViewKey(prev); toast.error("Could not set default view"); });
  };

  // Reconcile after the saved-filter list (re)loads — e.g. a filter was deleted
  // from the dropdown. A `saved:<id>` that no longer exists is dropped: the active
  // view degrades to an ad-hoc "Custom filter" (instead of a stale "Saved filter"
  // label), and a personal default pointing at the gone filter is cleared server-
  // side (it can never resolve again). Disabled *system* views are left intact —
  // an admin may re-enable them, so the stored key is preserved.
  useEffect(() => {
    if (!savedLoaded) return;
    if (viewKey?.startsWith("saved:") && !savedFilters.some((s) => s.id === viewKey.slice(6))) {
      setViewKey(null);
    }
    if (defaultViewKey?.startsWith("saved:") && !savedFilters.some((s) => s.id === defaultViewKey.slice(6))) {
      setDefaultViewKey(null);
      queueViewApi.set(project.id, "").catch(() => undefined);
    }
  }, [savedLoaded, savedFilters, viewKey, defaultViewKey, project.id]);

  const cycleSort = (col: string) => {
    setOrdering((prev) => (prev === col ? `-${col}` : prev === `-${col}` ? DEFAULT_ORDERING : col));
    setPage(1);
  };

  const activeLabel = useMemo(() => {
    if (viewKey === "all" || (!viewKey && conditions.length === 0)) return "All tickets";
    if (viewKey?.startsWith("saved:")) {
      const id = viewKey.slice(6);
      return savedFilters.find((s) => s.id === id)?.name ?? "Saved filter";
    }
    if (viewKey) return opts.systemViews.find((v) => v.key === viewKey)?.name ?? "Filter";
    return "Custom filter";
  }, [viewKey, conditions.length, savedFilters, opts.systemViews]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const rangeStart = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, count);

  return (
    <div className="space-y-4">
      {/* Live-refresh pill — a background update arrived while the agent was mid-action;
          clicking it swaps in the fresh rows and scrolls to the top. Bottom-centre so it
          never fights the sticky toolbar; above the sticky pager (z-40 > z-30). */}
      {pending ? (
        <div className="fixed bottom-16 left-1/2 z-40 -translate-x-1/2">
          <button
            type="button"
            onClick={applyPending}
            className="inline-flex items-center gap-1.5 rounded-full border bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {pending.count > count
              ? `${pending.count - count} new ${pending.count - count === 1 ? "ticket" : "tickets"} · Refresh`
              : "List updated · Refresh"}
          </button>
        </div>
      ) : null}

      {/* Toolbar: frozen below the workspace header — the title/search row + the
          filter bar stay visible while the long ticket table scrolls behind them,
          mirroring the sticky top WorkspaceHeader and the frozen bottom pager.
          `top-14` parks it flush under the 56px (`h-14`) header; full-bleed negative
          gutters cancel <main>'s px so the bottom border spans edge-to-edge like the
          header. z-30 sits below the header (z-40) but above table rows; the
          filter/Columns popovers portal above both. */}
      <div className="sticky top-14 z-30 -mx-3 space-y-3 border-b bg-card/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold tracking-tight">{project.name}</h2>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative w-48 sm:w-64 md:w-72">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={`Search ${project.name}…`}
                aria-label={`Search ${project.name}`}
                className="h-9 pl-9"
              />
            </div>
            <ColumnPicker columns={columns} onChange={changeColumns} onReset={resetColumns} />
            <Button asChild size="sm">
              <Link href={`${base}/new`}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New ticket
              </Link>
            </Button>
          </div>
        </div>

        <FilterBar
          project={project}
          opts={opts}
          conditions={conditions}
          extraKeys={extraKeys}
          ordering={ordering}
          savedFilters={savedFilters}
          systemViews={enabledSystemViews}
          currentUserId={user?.id ?? null}
          activeLabel={activeLabel}
          defaultViewKey={defaultViewKey}
          onConditionsChange={changeConditions}
          onExtraKeysChange={setExtraKeys}
          onApplySystem={applySystem}
          onApplySaved={applySaved}
          onSetDefault={setDefault}
          onClearAll={clearAll}
          onReloadSaved={reloadSaved}
        />
      </div>

      <div
        className="rounded-lg border bg-card"
        onMouseEnter={() => (tableHoverRef.current = true)}
        onMouseLeave={() => (tableHoverRef.current = false)}
      >
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((key) => {
                const def = QUEUE_COLUMN_MAP[key];
                if (!def) return null;
                return def.sortKey ? (
                  <SortHead
                    key={key}
                    label={def.label}
                    col={def.sortKey}
                    ordering={ordering}
                    onSort={cycleSort}
                    className={def.width}
                  />
                ) : (
                  <TableHead key={key} className={def.width}>
                    {def.label}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : tickets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-sm text-muted-foreground">
                  No tickets match your filters.
                </TableCell>
              </TableRow>
            ) : (
              tickets.map((t) => {
                const href = `${base}/${t.ticket_number}`;
                return (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={(e) => openTicketFromRow(e, () => router.push(href))}
                  >
                    {columns.map((key) => (
                      <TableCell key={key} className={QUEUE_COLUMN_MAP[key]?.width}>
                        {renderQueueCell(key, t, { base, now })}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pager: frozen at the bottom of the viewport — always visible while the
          table scrolls behind it, mirroring the sticky top workspace header.
          Works because the window is the scroll container (globals.css keeps
          `overflow-x-clip`, not hidden, on html/body) and the whole table sits
          above this last child in the same `space-y-4` containing block, so
          `bottom-0` pins it up until the final page is reached. Full-bleed:
          negative gutters cancel <main>'s px so the top border spans edge-to-edge
          like the header; z-30 sits below the header (z-40) but above table rows. */}
      <div className="sticky bottom-0 z-30 -mx-3 flex flex-wrap items-center justify-between gap-3 border-t bg-card/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {count === 0 ? "No tickets" : `Showing ${rangeStart}–${rangeEnd} of ${count}`}
        </p>
        {totalPages > 1 && (
          <nav className="flex items-center gap-1" aria-label="Pagination">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Prev
            </Button>
            {pageList(page, totalPages).map((item, i) =>
              item === "ellipsis" ? (
                <span key={`e${i}`} className="px-2 text-sm text-muted-foreground" aria-hidden="true">
                  …
                </span>
              ) : (
                <Button
                  key={item}
                  variant={item === page ? "default" : "outline"}
                  size="sm"
                  className="min-w-9"
                  onClick={() => setPage(item)}
                  disabled={loading}
                  aria-label={`Page ${item}`}
                  aria-current={item === page ? "page" : undefined}
                >
                  {item}
                </Button>
              ),
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              aria-label="Next page"
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </nav>
        )}
      </div>
    </div>
  );
}

function SortHead({
  label,
  col,
  ordering,
  onSort,
  className,
}: {
  label: string;
  col: string;
  ordering: string;
  onSort: (col: string) => void;
  className?: string;
}) {
  const dir = ordering === col ? "asc" : ordering === `-${col}` ? "desc" : null;
  return (
    <TableHead
      className={className}
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          "inline-flex items-center gap-1 rounded font-medium hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dir ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {dir === "asc" ? (
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
        ) : dir === "desc" ? (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" aria-hidden="true" />
        )}
      </button>
    </TableHead>
  );
}
