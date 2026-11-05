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
  Inbox,
  ListFilter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { usePageShortcuts } from "@/components/shell/shortcuts-host";
import { useUi } from "@/components/theme/density-provider";
import { useItsmAuth } from "@/lib/itsm/auth";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  MODERN_QUEUE_HELP,
  NO_CREATE_TICKET_PERMISSION,
  QUEUE_COLUMN_HELP,
  NOT_SORTABLE_HELP,
  QUEUE_REFRESH_HELP,
  QUEUE_SEARCH_HELP,
  RELEVANCE_SORT_HELP,
  RELEVANCE_SORT_NOTE,
  sortActionHelp,
} from "@/lib/itsm/help/queue";
import type {
  FilterCondition,
  Project,
  SavedFilter,
  SystemView,
  TicketListItem,
} from "@/lib/itsm/types";
import { cn } from "@/lib/utils";
import { FilterBar } from "./filters/filter-bar";
import { SavedViewsMenu } from "./filters/saved-views";
import { useCombinedFilterOptions, useFilterOptions } from "./filters/use-filter-options";
import {
  DEFAULT_FIELD_KEYS,
  PRODUCT_DEFAULT_VIEW_KEY,
  buildSpec,
  parseSpec,
  serializeSpec,
} from "./filters/filter-utils";
import { ColumnPicker } from "./column-picker";
import {
  QUEUE_COLUMNS,
  isColumnEligibleCf,
  queueColumnDef,
  renderQueueCell,
  resolveCombinedColumns,
  resolveCombinedLayout,
  resolveQueueColumns,
  resolveQueueLayout,
} from "./queue-columns";
import { ViewTabs, buildViewTabs, useViewCounts } from "./view-tabs";
import { useWorkbench } from "./workbench/workbench-context";

const PAGE_SIZE = 25;
/** Modern infinite scroll: the live refresh re-reads every loaded row in one request,
 *  capped at the API's `max_page_size` (accounts/auth.py). */
const MAX_LIVE_WINDOW = 500;
/** Modern infinite scroll: start loading the next batch this far before the list's end. */
const LOOK_AHEAD_PX = 120;
/** Modern workbench (step B4): with a ticket docked beside it the 440px list shows a
 *  fixed, narrow column set (status dot · priority · ID · summary · resolution SLA). */
const DOCKED_COLUMNS = ["status_dot", "priority", "ticket_number", "summary", "sla_compact"];
const DOCKED_WIDTH: Record<string, string> = {
  status_dot: "w-8",
  priority: "w-[52px]",
  ticket_number: "w-[84px]",
  summary: "",
  sla_compact: "w-[96px]",
};
const DOCKED_LABEL: Record<string, string> = { priority: "Pri" };
/** Header for the docked-only SLA pill column (not a picker column). */
const SLA_COMPACT_DEF = { label: "SLA", description: QUEUE_COLUMN_HELP.sla_resolution };
const DEFAULT_ORDERING = "-created_at";

/** Everything the shared queue body (`QueueView`) needs that differs between a
 *  single-project queue and the combined ("All tickets") cross-project queue.
 *  Built once (memoised) by each wrapper so its identity is stable across renders
 *  (QueueView's effects depend on it). */
type QueueScope = {
  kind: "project" | "combined";
  title: string;
  /** The queue's own URL path. The URL-sync effect only writes the query string while
   *  the queue IS the page, never onto a ticket docked beside it (Modern workbench). */
  queuePath: string;
  searchPlaceholder: string;
  /** Id used for the last-used sessionStorage key (per project | per helpdesk). */
  storageId: string;
  /** Page-independent list/pulse scope params ({project} | {helpdesk}). */
  listParams: { project?: string; helpdesk?: string };
  /** Project a newly-saved view is scoped to (null = cross-project shared/personal). */
  saveProjectId: string | null;
  /** Which saved views belong to this queue: `{project}` or `{helpdesk}` (All Tickets). */
  savedFiltersParams: { project?: string; helpdesk?: string };
  disabledViewKeys: string[];
  scopeDefaultViewKey: string | null;
  showProjectColumn: boolean;
  /** "New ticket" link, or null (the combined queue has no single project to create in). */
  newTicketHref: string | null;
  rowHref: (t: TicketListItem) => string;
  projectFor: (t: TicketListItem) => { name: string; color?: string } | null;
  resolveColumns: (pref: string[] | null) => string[];
  /** The stored layout behind `resolveColumns` (`!`-hidden keys keep their place). */
  resolveLayout: (pref: string[] | null) => string[];
  defaultColumns: string[];
  loadColumns: () => Promise<string[] | null>;
  persistColumns: (cols: string[]) => void;
  loadDefaultView: () => Promise<string | null>;
  persistDefaultView: (key: string) => Promise<void>;
};

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

/** Per-scope sessionStorage key holding the last-used queue query string
 *  (the same `q`/`search`/`ordering`/`page`/`view` params synced to the URL).
 *  Lets a return to the queue (Back to queue link, browser back, re-clicking the
 *  tab in nav) restore the agent's active filters instead of the default view. */
const queueStateKey = (storageId: string) => `itsm:queue:${storageId}`;

/** Read the stored queue query string for a scope, or null if none / unavailable. */
function readStoredQueueState(storageId: string): URLSearchParams | null {
  try {
    const raw = window.sessionStorage.getItem(queueStateKey(storageId));
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

/** localStorage helpers for the combined queue's per-user prefs (column layout +
 *  default view). Client-side (no migration) — the single-project queue persists
 *  these server-side per (owner, project); a combined scope has no single project. */
function readLocalCols(key: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : null;
  } catch {
    return null;
  }
}
function writeLocalCols(key: string, cols: string[]) {
  try {
    if (!cols.length) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(cols));
  } catch {
    /* localStorage disabled / full — prefs just don't persist */
  }
}
function readLocalStr(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocalStr(key: string, val: string) {
  try {
    if (!val) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, val);
  } catch {
    /* ignore */
  }
}

type Opts = ReturnType<typeof useFilterOptions>;

/** The shared queue body — filter bar, sortable/paginated table, live silent
 *  refresh — driven by a `QueueScope`. Rendered by both `TicketQueue` (one project)
 *  and `CombinedTicketQueue` (all projects in a helpdesk). */
function QueueView({ scope, opts }: { scope: QueueScope; opts: Opts }) {
  const { user, hasPerm } = useItsmAuth();
  const canCreateTicket = hasPerm("itsm.tickets.create", "create");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  // Modern interface (step B3): view tabs, Find vs Filters rows, infinite scroll with a
  // loaded-count footer, J/K keys. Classic keeps the toolbar band + pager below as is.
  const { ui } = useUi();
  const modern = ui === "modern";
  // Modern workbench (B4): the queue sits in the route layout; `docked` = a ticket is open beside it.
  const wb = useWorkbench();
  const docked = modern && !!wb?.currentNumber;

  // System views offered in this scope's dropdown — "All tickets" is always shown;
  // admins hide the rest via a project's Filters tab (disabled_view_keys) or, for
  // All Tickets, Configuration → All-Tickets Filters (combined_disabled_view_keys).
  const disabledViews = useMemo(() => new Set(scope.disabledViewKeys), [scope.disabledViewKeys]);
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
  // The table card is the queue's scroll pane (it pins the column header), so
  // "scrolled" / "back to top" checks read it rather than the window.
  const paneRef = useRef<HTMLDivElement>(null);

  // ── Modern-only state (step B3) ─────────────────────────────────────────────
  const [quickOpen, setQuickOpen] = useState(false); // the "Find in this view" row
  const [filtersOpen, setFiltersOpen] = useState(false); // the filter-chip row
  const [loadingMore, setLoadingMore] = useState(false);
  // A "load more" failed (or returned nothing): stop auto-loading until Try again.
  const [exhausted, setExhausted] = useState(false);
  const [nearEnd, setNearEnd] = useState(false); // the load-more sentinel is in view
  const [cursorId, setCursorId] = useState<string | null>(null); // J/K highlight
  const [showTop, setShowTop] = useState(false);
  // Bumped when the live poll sees a change → the view tabs refetch their counts.
  const [liveTick, setLiveTick] = useState(0);
  const quickRef = useRef<HTMLInputElement>(null);
  const findBtnRef = useRef<HTMLButtonElement>(null);

  // ── column layout (per-agent override → scope default → built-in) ─────────
  const [colPref, setColPref] = useState<string[] | null>(null);
  const columns = useMemo(() => scope.resolveColumns(colPref), [scope, colPref]);
  const columnLayout = useMemo(() => scope.resolveLayout(colPref), [scope, colPref]);

  // Labels for any `cf:` column (incl. column-backed ones, so a legacy stored key
  // still renders a sane header rather than the raw key).
  const cfLabels = useMemo(
    () =>
      Object.fromEntries(
        opts.fields.filter((f) => f.key.startsWith("cf:")).map((f) => [f.key, f.label]),
      ) as Record<string, string>,
    [opts.fields],
  );
  // Which `cf:` columns the server will let us sort by, and under what `ordering=`
  // key. Published as `ordering_key` in the filter registry (a value-backed field of
  // an orderable type); a field without one renders a plain, non-clickable header.
  const cfSortKeys = useMemo(
    () =>
      Object.fromEntries(
        opts.fields
          .filter((f) => f.key.startsWith("cf:") && f.ordering_key)
          .map((f) => [f.key, f.ordering_key as string]),
      ) as Record<string, string>,
    [opts.fields],
  );
  const colDef = useCallback(
    (key: string) => queueColumnDef(key, cfLabels, cfSortKeys),
    [cfLabels, cfSortKeys],
  );
  // Only column-eligible custom fields may be OFFERED as columns — see isColumnEligibleCf.
  const cfColumnFields = useMemo(() => opts.fields.filter(isColumnEligibleCf), [opts.fields]);
  const columnUniverse = useMemo(() => {
    const base = QUEUE_COLUMNS.filter((c) => scope.showProjectColumn || c.key !== "project").map(
      (c) => ({ key: c.key as string, label: c.label, description: c.description }),
    );
    // Custom-field columns are offered in every scope now — single-project
    // (`opts.fields` = that project's custom fields) and combined (the union).
    return [...base, ...cfColumnFields.map((f) => ({ key: f.key, label: f.label }))];
  }, [scope.showProjectColumn, cfColumnFields]);
  // The custom-field columns actually visible → sent as `?cf=` so the list attaches
  // their display-ready values (batched server-side).
  const cfParam = useMemo(() => columns.filter((c) => c.startsWith("cf:")).join(","), [columns]);
  // An unassigned row's Assignee cell repeats the group name only when no Group column shows it.
  const groupVisible = columns.includes("assigned_group");

  // `now` drives the relative SLA labels; bump once a minute so they stay fresh.
  const [now, setNow] = useState(() => Date.now());

  const qParam = useMemo(() => serializeSpec(conditions, "all"), [conditions]);

  // ── load saved filters for this scope ─────────────────────────────────────
  const reloadSaved = useCallback(() => {
    savedFiltersApi
      .list(scope.savedFiltersParams)
      .then(setSavedFilters)
      .catch(() => setSavedFilters([]))
      .finally(() => setSavedLoaded(true));
  }, [scope]);
  useEffect(() => reloadSaved(), [reloadSaved]);

  // ── load this agent's personal default view for the scope ─────────────────
  useEffect(() => {
    let cancelled = false;
    scope
      .loadDefaultView()
      .then((k) => !cancelled && setDefaultViewKey(k))
      .catch(() => !cancelled && setDefaultViewKey(null))
      .finally(() => !cancelled && setPrefLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [scope]);

  // ── load this agent's saved column layout for the scope ───────────────────
  useEffect(() => {
    let cancelled = false;
    scope
      .loadColumns()
      .then((cols) => !cancelled && setColPref(cols))
      .catch(() => !cancelled && setColPref(null));
    return () => {
      cancelled = true;
    };
  }, [scope]);

  // Refresh relative SLA labels every minute.
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(h);
  }, []);

  // Persist a column change (empty list ⇒ clear the override → scope/default).
  const changeColumns = (next: string[]) => {
    setColPref(next);
    scope.persistColumns(next);
  };
  const resetColumns = () => {
    setColPref(null);
    scope.persistColumns([]);
  };

  // ── keep the URL in sync (shareable / bookmarkable) + remember last-used ────
  useEffect(() => {
    const params = new URLSearchParams();
    if (qParam) params.set("q", qParam);
    if (search) params.set("search", search);
    if (ordering && ordering !== DEFAULT_ORDERING) params.set("ordering", ordering);
    if (page > 1 && !modern) params.set("page", String(page));
    if (viewKey) params.set("view", viewKey);
    const s = params.toString();
    if (pathname === scope.queuePath) router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    // Persist the active state so returning to the queue restores it. Gated on
    // `ready` so the pre-resolution empty state never clobbers a stored value.
    if (ready) {
      try {
        window.sessionStorage.setItem(queueStateKey(scope.storageId), s);
      } catch {
        /* sessionStorage disabled / full — URL stays the source of truth */
      }
    }
  }, [qParam, search, ordering, page, viewKey, pathname, router, ready, scope.storageId, scope.queuePath, modern]);

  // ── live params (the filter scope, page-independent) for the pulse poller ────
  const liveParams = useMemo(
    () => ({ ...scope.listParams, q: qParam, search: search || undefined, ordering, cf: cfParam || undefined }),
    [scope.listParams, qParam, search, ordering, cfParam],
  );

  // ── fetch the current page ──────────────────────────────────────────────────
  // `silent` (a background poll) never flips the loading spinner and routes the
  // result through the hybrid apply rule below; the user-driven path shows the
  // spinner and replaces rows immediately. A monotonic seq guards against a slow
  // fetch overwriting a newer one (debounce-cancel + silent/user races).
  const fetchSeq = useRef(0);
  // Modern: how many 25-row batches are loaded (a ref, so loading more never re-creates
  // `loadPage` and re-triggers the debounced first-page fetch).
  const loadedPagesRef = useRef(1);
  const loadPage = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const seq = ++fetchSeq.current;
      if (!silent) setLoading(true);
      try {
        // Modern always reads from the first row: the first batch on a user change,
        // every loaded row (one request) on a silent refresh.
        const r = await ticketsApi.listPaged(
          modern
            ? {
                ...liveParams,
                page: 1,
                page_size: silent ? Math.min(MAX_LIVE_WINDOW, loadedPagesRef.current * PAGE_SIZE) : PAGE_SIZE,
              }
            : { ...liveParams, page, page_size: PAGE_SIZE },
        );
        if (seq !== fetchSeq.current) return; // a newer fetch superseded this one
        if (modern) {
          if (!silent) {
            loadedPagesRef.current = 1;
            setExhausted(false);
          } else {
            loadedPagesRef.current = Math.max(1, Math.ceil(r.results.length / PAGE_SIZE));
          }
        }
        if (silent) {
          // Apply silently only when the agent is idle at the top of page 1 and not
          // hovering a row (about to click); otherwise stage behind the refresh pill
          // so rows never shift under an in-progress action.
          const safe =
            (modern || page === 1) &&
            !tableHoverRef.current &&
            (paneRef.current?.scrollTop ?? 0) < 40 &&
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
    [liveParams, page, modern],
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
    onChange: () => {
      if (modern) setLiveTick((n) => n + 1);
      return loadPage({ silent: true });
    },
  });

  // Apply a staged background refresh (the "Refresh" pill) and jump back to the top.
  const applyPending = () => {
    if (!pending) return;
    setTickets(pending.results);
    setCount(pending.count);
    setPending(null);
    paneRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // A new page / filter / search / sort starts at the first row, not wherever the
  // pane was left (e.g. "Next" clicked after scrolling to the bottom).
  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0 });
  }, [page, qParam, search, ordering]);

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
  // default → scope default → product default ("open") → All tickets. Each
  // candidate must still resolve to an available view; runs once.
  useEffect(() => {
    if (ready || resolvedRef.current) return;
    if (opts.loading || !prefLoaded || !savedLoaded) return; // wait for inputs
    resolvedRef.current = true;

    // 1) Restore the last-used filter/sort/view/page for this scope so opening a
    //    ticket and returning to the queue keeps the agent's active filters.
    const stored = readStoredQueueState(scope.storageId);
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
    const candidates = [defaultViewKey, scope.scopeDefaultViewKey, PRODUCT_DEFAULT_VIEW_KEY, "all"];
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
  }, [ready, opts.loading, prefLoaded, savedLoaded, defaultViewKey, savedFilters, enabledSystemViews, scope]);

  // Persist a view key (system key or "saved:<id>") as this agent's default.
  // A blank key clears it (the ★ toggles off) — the queue then falls back to the
  // project default.
  const setDefault = (key: string) => {
    const prev = defaultViewKey;
    setDefaultViewKey(key || null);
    scope
      .persistDefaultView(key)
      .then(() => toast.success(key ? "Default view updated" : "Default view cleared"))
      .catch(() => { setDefaultViewKey(prev); toast.error("Could not set default view"); });
  };

  // Reconcile after the saved-filter list (re)loads — a `saved:<id>` that no longer
  // exists degrades the active view to an ad-hoc "Custom filter", and a personal
  // default pointing at the gone filter is cleared (it can never resolve again).
  useEffect(() => {
    if (!savedLoaded) return;
    if (viewKey?.startsWith("saved:") && !savedFilters.some((s) => s.id === viewKey.slice(6))) {
      setViewKey(null);
    }
    if (defaultViewKey?.startsWith("saved:") && !savedFilters.some((s) => s.id === defaultViewKey.slice(6))) {
      setDefaultViewKey(null);
      scope.persistDefaultView("").catch(() => undefined);
    }
  }, [savedLoaded, savedFilters, viewKey, defaultViewKey, scope]);

  const cycleSort = (col: string) => {
    // asc → desc → default. When the column IS the default order (Created, newest
    // first) "reset" would be a no-op, so the next click goes back to ascending.
    setOrdering((prev) => {
      const next = prev === col ? `-${col}` : prev === `-${col}` ? DEFAULT_ORDERING : col;
      return next === prev ? col : next;
    });
    setPage(1);
  };

  // The backend ranks a search by best match unless the user picked a column sort
  // (the default `-created_at` doesn't count) — so no column arrow is truthful then.
  const relevanceRanked = search.trim() !== "" && ordering === DEFAULT_ORDERING;

  const activeLabel = useMemo(() => {
    if (viewKey === "all" || (!viewKey && conditions.length === 0)) return "All tickets";
    if (viewKey?.startsWith("saved:")) {
      const id = viewKey.slice(6);
      return savedFilters.find((s) => s.id === id)?.name ?? "Saved filter";
    }
    if (viewKey) return opts.systemViews.find((v) => v.key === viewKey)?.name ?? "Filter";
    return "Custom filter";
  }, [viewKey, conditions.length, savedFilters, opts.systemViews]);

  // ── Modern (step B3): infinite scroll, view tabs, Find / Filters rows, keys ────
  // Modern has no pages: `page` stays 1 (a Classic `?page=` link is ignored).
  useEffect(() => {
    if (modern) setPage(1);
  }, [modern]);

  // Open the filter row on arrival when the queue opens on hand-edited filters.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!ready || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    if (!viewKey && conditions.length > 0) setFiltersOpen(true);
  }, [ready, viewKey, conditions.length]);

  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = fetchSeq.current; // a newer first-page fetch makes this batch stale
    const next = loadedPagesRef.current + 1;
    try {
      const r = await ticketsApi.listPaged({ ...liveParams, page: next, page_size: PAGE_SIZE });
      if (seq !== fetchSeq.current) return;
      loadedPagesRef.current = next;
      setCount(r.count);
      if (r.results.length === 0) setExhausted(true);
      // Rows can shift between batches (new tickets arrive on top): drop repeats.
      setTickets((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        const add = r.results.filter((t) => !seen.has(t.id));
        return add.length ? [...prev, ...add] : prev;
      });
    } catch {
      if (seq === fetchSeq.current) setExhausted(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [liveParams]);

  // The sentinel row under the last ticket: observed inside the pane (its scroll root)
  // with a short look-ahead, so the next batch is usually there before you reach it.
  const ioRef = useRef<IntersectionObserver | null>(null);
  const sentinelElRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (!modern || !paneRef.current) return;
    const io = new IntersectionObserver((entries) => setNearEnd(entries.some((e) => e.isIntersecting)), {
      root: paneRef.current,
      rootMargin: `0px 0px ${LOOK_AHEAD_PX}px 0px`,
    });
    ioRef.current = io;
    if (sentinelElRef.current) io.observe(sentinelElRef.current);
    return () => {
      io.disconnect();
      ioRef.current = null;
    };
  }, [modern]);
  const sentinelRef = useCallback((el: HTMLTableRowElement | null) => {
    if (sentinelElRef.current) ioRef.current?.unobserve(sentinelElRef.current);
    sentinelElRef.current = el;
    if (el) ioRef.current?.observe(el);
    else setNearEnd(false);
  }, []);
  const hasMoreRows = !loading && tickets.length < count;
  useEffect(() => {
    if (!modern || !nearEnd || !hasMoreRows || loadingMore || exhausted) return;
    // `nearEnd` lags one observer callback behind an append, so re-measure: load again
    // only while the sentinel really is within the look-ahead (a tall screen fills up,
    // a normal one stops after the batch it needed).
    const el = sentinelElRef.current;
    const pane = paneRef.current;
    if (!el || !pane) return;
    if (el.getBoundingClientRect().top - pane.getBoundingClientRect().bottom > LOOK_AHEAD_PX) return;
    void loadMore();
  }, [modern, nearEnd, hasMoreRows, loadingMore, exhausted, loadMore, tickets.length]);

  // Hand the loaded rows to the workbench so the docked ticket can page through them
  // (← 1 of N →, J/K). `publishList` is a state setter: stable, so no render loop.
  const publishList = wb?.publishList;
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  useEffect(() => {
    if (!publishList) return;
    publishList({
      numbers: tickets.map((t) => t.ticket_number),
      count,
      hasMore: tickets.length < count,
      loadMore: () => loadMoreRef.current(),
    });
  }, [publishList, tickets, count]);
  useEffect(() => () => publishList?.(null), [publishList]);

  // Paging tickets from the docked card (J/K, ← →) keeps the open row in view.
  const openNumber = wb?.currentNumber ?? null;
  useEffect(() => {
    if (!openNumber) return;
    const row = paneRef.current?.querySelector<HTMLTableRowElement>('tr[aria-current="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [openNumber, tickets.length]);

  // View tabs + their live counts (the queue scope, without the Find text).
  const selectedViewKey = viewKey ?? (conditions.length === 0 ? "all" : null);
  const customActive = !viewKey && conditions.length > 0;
  const viewTabs = useMemo(
    () =>
      buildViewTabs({
        systemViews: enabledSystemViews,
        savedFilters,
        currentUserId: user?.id ?? null,
        defaultViewKey,
        activeKey: selectedViewKey,
      }),
    [enabledSystemViews, savedFilters, user?.id, defaultViewKey, selectedViewKey],
  );
  const viewCounts = useViewCounts(viewTabs, scope.listParams, liveTick, modern && ready);
  const selectView = (key: string) => {
    if (key.startsWith("saved:")) {
      const sf = savedFilters.find((x) => x.id === key.slice(6));
      if (sf) applySaved(sf);
      return;
    }
    const v = enabledSystemViews.find((x) => x.key === key);
    if (v) applySystem(v);
  };

  const showQuick = quickOpen || search !== "";
  const openQuick = () => {
    setQuickOpen(true);
    requestAnimationFrame(() => quickRef.current?.focus());
  };
  const closeQuick = () => {
    if (search) onSearchChange("");
    setQuickOpen(false);
    requestAnimationFrame(() => findBtnRef.current?.focus());
  };

  // J/K move a highlight through the rows and put focus on that row's summary link,
  // so Enter opens it natively and a screen reader reads the ticket out.
  const focusRow = (id: string) =>
    requestAnimationFrame(() => {
      const row = paneRef.current?.querySelector<HTMLTableRowElement>(`tr[data-ticket-id="${id}"]`);
      row?.scrollIntoView({ block: "nearest" });
      (row?.querySelector<HTMLAnchorElement>("a[data-row-link]") ?? row?.querySelector<HTMLAnchorElement>("a"))?.focus({
        preventScroll: true,
      });
    });
  const moveCursor = (delta: number) => {
    if (loading || tickets.length === 0) return;
    const i = cursorId ? tickets.findIndex((t) => t.id === cursorId) : -1;
    const next = i < 0 ? 0 : Math.min(tickets.length - 1, Math.max(0, i + delta));
    setCursorId(tickets[next].id);
    focusRow(tickets[next].id);
  };
  const openCursor = (): boolean => {
    const t = cursorId ? tickets.find((x) => x.id === cursorId) : undefined;
    if (!t) return false;
    router.push(scope.rowHref(t));
    return true;
  };
  const onRows = (e: KeyboardEvent) => {
    const el = e.target as Element | null;
    return !el || el === document.body || !!el.closest("[data-ticket-id]");
  };
  const onControl = (e: KeyboardEvent) => {
    const el = e.target as Element | null;
    return !!el && el !== document.body && !!el.closest("a, button, [role='tab'], [role='button'], [role='menuitem'], summary");
  };
  usePageShortcuts(
    {
      j: () => moveCursor(1),
      k: () => moveCursor(-1),
      arrowdown: (e) => (onRows(e) ? moveCursor(1) : false),
      arrowup: (e) => (onRows(e) ? moveCursor(-1) : false),
      enter: (e) => (onControl(e) ? false : openCursor()),
      o: () => openCursor(),
      "/": () => openQuick(),
      f: () => setFiltersOpen((o) => !o),
    },
    modern && ready,
  );

  if (modern) {
    const viewColumns = docked ? DOCKED_COLUMNS : columns;
    const panelId = `queue-panel-${scope.storageId}`;
    const filterCount = customActive ? buildSpec(conditions, "all").conditions.length : 0;
    const loadState = loading
      ? null
      : loadingMore
        ? "Loading more…"
        : hasMoreRows
          ? exhausted
            ? null
            : "scroll for more"
          : count > 0
            ? "all loaded"
            : null;
    return (
      // The queue IS the page in Modern: full-bleed (`-mx-main-x -my-main-y` cancel
      // <main>'s padding), one viewport-tall column: tabs → Find → filters → table
      // pane (the only scroller) → count footer.
      <div
        className={cn(
          "flex min-h-0 flex-col",
          // In the workbench the layout owns the viewport box; alone, the queue is the page.
          wb ? "flex-1" : "-mx-main-x -my-main-y h-[calc(100dvh-var(--header-h))] min-h-[28rem]",
          !docked && "bg-card",
        )}
      >
        {/* The top bar's breadcrumb shows the queue's name; this keeps one h1 per page
            (an h2 while a ticket is docked: the ticket's title is the h1 then). */}
        {docked ? <h2 className="sr-only">{scope.title}</h2> : <h1 className="sr-only">{scope.title}</h1>}

        <div className="flex h-9 shrink-0 items-stretch gap-2 border-b px-2">
          {docked ? (
            <div className="flex min-w-0 flex-1 items-center">
              <SavedViewsMenu
                systemViews={enabledSystemViews}
                savedFilters={savedFilters}
                currentUserId={user?.id ?? null}
                activeLabel={activeLabel}
                defaultViewKey={defaultViewKey}
                onApplySystem={applySystem}
                onApplySaved={applySaved}
                onSetDefault={setDefault}
                onDeleted={reloadSaved}
              />
              <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                {!loading ? count.toLocaleString() : null}
              </span>
            </div>
          ) : (
          <ViewTabs
            tabs={viewTabs}
            activeKey={selectedViewKey}
            counts={viewCounts}
            liveCount={!loading && !search ? count : null}
            customActive={customActive}
            panelId={panelId}
            onSelect={selectView}
            onCustom={() => setFiltersOpen(true)}
            className="flex-1"
          />
          )}
          <div className="flex shrink-0 items-center gap-0.5">
            {docked ? null : (
            <SavedViewsMenu
              compactTrigger
              systemViews={enabledSystemViews}
              savedFilters={savedFilters}
              currentUserId={user?.id ?? null}
              activeLabel={activeLabel}
              defaultViewKey={defaultViewKey}
              onApplySystem={applySystem}
              onApplySaved={applySaved}
              onSetDefault={setDefault}
              onDeleted={reloadSaved}
            />
            )}
            <IconButton
              ref={findBtnRef}
              label={MODERN_QUEUE_HELP.find}
              detail={MODERN_QUEUE_HELP.findDetail}
              side="bottom"
              aria-pressed={showQuick}
              onClick={() => (showQuick ? closeQuick() : openQuick())}
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={filterCount ? `${MODERN_QUEUE_HELP.filters} · ${filterCount} active` : MODERN_QUEUE_HELP.filters}
              detail={MODERN_QUEUE_HELP.filtersDetail}
              side="bottom"
              aria-pressed={filtersOpen}
              className="relative"
              onClick={() => setFiltersOpen((o) => !o)}
            >
              <ListFilter className="h-4 w-4" aria-hidden="true" />
              {filterCount ? (
                <span
                  aria-hidden="true"
                  className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs font-medium leading-none text-primary-foreground"
                >
                  {filterCount}
                </span>
              ) : null}
            </IconButton>
            {docked ? null : (
            <ColumnPicker
              iconOnly
              columns={columns}
              layout={columnLayout}
              allColumns={columnUniverse}
              defaultColumns={scope.defaultColumns}
              onChange={changeColumns}
              onReset={resetColumns}
              saveNote={
                scope.kind === "project"
                  ? "Saved to your account for this project — only you see it"
                  : "Saved in this browser only — only you see it"
              }
            />
            )}
            {/* The top bar's Create menu covers every project; this one is "here". */}
            {docked ? null : scope.newTicketHref && canCreateTicket ? (
              <Hint label={`Raise a new ticket in ${scope.title}`} side="bottom">
                <Button asChild size="sm" variant="outline" className="ml-1 hidden sm:inline-flex">
                  <Link href={scope.newTicketHref}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    New ticket
                  </Link>
                </Button>
              </Hint>
            ) : scope.newTicketHref ? (
              <Hint label={NO_CREATE_TICKET_PERMISSION} side="bottom">
                <Button size="sm" variant="outline" className="ml-1 hidden sm:inline-flex" disabled>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New ticket
                </Button>
              </Hint>
            ) : null}
          </div>
        </div>

        {showQuick ? (
          // The whole row is the field: focus shows as a brand underline across it.
          <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 focus-within:shadow-[inset_0_-2px_0_hsl(var(--primary))]">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={quickRef}
              type="search"
              spellCheck={false}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeQuick();
                }
              }}
              placeholder="Find in this view: number, summary, description or comments…"
              aria-label="Find in this view"
              className="h-7 min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus-visible:ring-0 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {search && !loading ? (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {count.toLocaleString()} {count === 1 ? "match" : "matches"}
              </span>
            ) : null}
            <InfoTip label="How Find searches">{QUEUE_SEARCH_HELP}</InfoTip>
            <IconButton label={MODERN_QUEUE_HELP.findClose} side="bottom" className="h-7 w-7" onClick={closeQuick}>
              <X className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
        ) : null}

        {filtersOpen ? (
          <div className="shrink-0 border-b bg-muted/40 px-3 py-1.5">
            <FilterBar
              hideViews
              saveProjectId={scope.saveProjectId}
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
        ) : null}

        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* Live-refresh pill: inside the list (not `fixed`), so it never covers a
              ticket opened beside the queue. */}
          {pending ? (
            <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2">
              <Hint label={QUEUE_REFRESH_HELP}>
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
              </Hint>
            </div>
          ) : null}
          {/* 36px rows: cell padding 0 (the row height sets it), 32px sticky header;
              scroll-padding keeps a J/K-highlighted row clear of the header. */}
          <div
            ref={paneRef}
            id={panelId}
            role="tabpanel"
            aria-labelledby={customActive ? "view-tab-custom" : `view-tab-${selectedViewKey}`}
            data-queue-pane=""
            className="min-h-0 flex-1 overflow-auto [--cell-py:0px] [--th-h:2rem] [scroll-padding-top:var(--th-h)]"
            onMouseEnter={() => (tableHoverRef.current = true)}
            onMouseLeave={() => (tableHoverRef.current = false)}
            onScroll={(e) => setShowTop(e.currentTarget.scrollTop > e.currentTarget.clientHeight)}
          >
            <Table containerClassName="overflow-visible" className={docked ? "table-fixed" : undefined}>
              <TableHeader sticky className={cn("[&_th]:text-xs", docked && "[&_th]:bg-[var(--wb-stage)]")}>
                <TableRow>
                  {viewColumns.map((key) => {
                    if (key === "status_dot")
                      return (
                        <TableHead key={key} className={DOCKED_WIDTH.status_dot}>
                          <span className="sr-only">Status</span>
                        </TableHead>
                      );
                    const def = key === "sla_compact" ? { key, ...SLA_COMPACT_DEF, sortKey: undefined, width: undefined } : colDef(key);
                    const width = docked ? DOCKED_WIDTH[key] : def.width;
                    return def.sortKey ? (
                      <SortHead
                        key={key}
                        label={(docked && DOCKED_LABEL[key]) || def.label}
                        description={def.description}
                        col={def.sortKey}
                        ordering={ordering}
                        relevance={relevanceRanked}
                        onSort={cycleSort}
                        className={width}
                      />
                    ) : (
                      <TableHead key={key} className={width}>
                        <span className="inline-flex items-center gap-1">
                          {(docked && DOCKED_LABEL[key]) || def.label}
                          <InfoTip label={`About the ${def.label} column`}>
                            {[def.description, NOT_SORTABLE_HELP].filter(Boolean).join("\n")}
                          </InfoTip>
                        </span>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`} className="h-9">
                      {viewColumns.map((key) => (
                        <TableCell key={key} className={docked ? DOCKED_WIDTH[key] : colDef(key).width}>
                          <Skeleton className="h-4 w-full max-w-[180px]" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : tickets.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={viewColumns.length} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center gap-2 py-6">
                        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Inbox className="size-6" aria-hidden="true" />
                        </div>
                        <p className="text-sm font-medium text-foreground">No tickets match your filters</p>
                        <p className="text-xs text-muted-foreground">Try another view, or clear the search or filters.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  tickets.map((t) => {
                    const href = scope.rowHref(t);
                    const cellCtx = { href, now, project: scope.projectFor(t), groupVisible, modern: true };
                    const isOpen = !!wb?.currentNumber && wb.currentNumber === t.ticket_number;
                    return (
                      <TableRow
                        key={t.id}
                        data-ticket-id={t.id}
                        data-cursor={t.id === cursorId || undefined}
                        aria-current={isOpen ? "true" : undefined}
                        className={cn(
                          "h-9 cursor-pointer [&[data-cursor=true]:not([aria-current=true])]:bg-accent/60",
                          // Docked: rows sit on the grey stage, white on hover; the open
                          // ticket's row is white with the brand bar.
                          docked && "hover:bg-card aria-[current=true]:bg-card",
                          "[&[aria-current=true]>td:first-child]:shadow-[inset_2px_0_0_hsl(var(--primary))]",
                          // J/K highlight: a 2px brand bar on the first cell, and the focused
                          // summary link underlines instead of drawing a box.
                          "[&[data-cursor=true]>td:first-child]:shadow-[inset_2px_0_0_hsl(var(--primary))]",
                          "[&[data-cursor=true]_a[data-row-link]:focus-visible]:underline [&[data-cursor=true]_a[data-row-link]:focus-visible]:ring-0",
                        )}
                        onClick={(e) =>
                          openTicketFromRow(e, () => {
                            setCursorId(t.id);
                            router.push(href);
                          })
                        }
                      >
                        {viewColumns.map((key) => (
                          <TableCell key={key} className={docked ? DOCKED_WIDTH[key] : colDef(key).width}>
                            {renderQueueCell(key, t, cellCtx)}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })
                )}
                {hasMoreRows ? (
                  <TableRow ref={sentinelRef} className="hover:bg-transparent">
                    <TableCell colSpan={viewColumns.length} className="h-9 text-center text-xs text-muted-foreground">
                      {exhausted ? (
                        <>
                          Couldn&apos;t load more tickets.{" "}
                          <button
                            type="button"
                            onClick={() => setExhausted(false)}
                            className="rounded-sm font-medium text-primary-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Try again
                          </button>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          Loading more…
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="flex h-8 shrink-0 items-center gap-3 border-t px-3 text-xs text-muted-foreground">
          <Hint label={MODERN_QUEUE_HELP.live}>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
              Live
            </span>
          </Hint>
          <p className="tabular-nums" aria-live="polite">
            {loading && tickets.length === 0 ? (
              "Loading…"
            ) : count === 0 ? (
              "No tickets"
            ) : (
              <>
                <span className="font-medium text-foreground">{tickets.length.toLocaleString()}</span>
                {` of ${count.toLocaleString()} ${count === 1 ? "ticket" : "tickets"}`}
                {relevanceRanked ? ` · ${RELEVANCE_SORT_NOTE}` : ""}
              </>
            )}
          </p>
          {loadState ? (
            <Hint label={MODERN_QUEUE_HELP.loadState}>
              <span>{loadState}</span>
            </Hint>
          ) : null}
          {showTop ? (
            <Hint label={MODERN_QUEUE_HELP.top} side="top">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-6 gap-1 px-2 text-xs"
                onClick={() => paneRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
              >
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                Top
              </Button>
            </Hint>
          ) : null}
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const rangeStart = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, count);

  return (
    // Viewport-height column: toolbar band → table pane → pager band. The table card is
    // the ONLY scroller (both axes), so its column header can be `sticky top-0` — a
    // window-level sticky header is impossible because the fixed-width columns overflow
    // horizontally and that `overflow-x` wrapper would capture the sticky. Height = the
    // viewport minus the WorkspaceHeader (`--header-h`, 56px comfortable / 48px compact,
    // border included); `-my-main-y` cancels WorkspaceChrome's `<main>` padding
    // (`--main-py`) so the toolbar sits FLUSH under the header and the footer band (count
    // + pager) flush on the viewport bottom. All three
    // come from the density tokens in globals.css — never hard-code `h-14`/`py-6` here.
    // `min-h` guards very short screens: the page then scrolls a little and the band/
    // pager `sticky` classes take over. The refresh pill is `fixed`, so not a flex item.
    <div
      className={cn(
        "-my-main-y flex h-[calc(100dvh-var(--header-h))] min-h-[28rem] flex-col gap-4 compact:gap-2",
      )}
    >
      {/* Live-refresh pill — a background update arrived while the agent was mid-action;
          clicking it swaps in the fresh rows and scrolls to the top. Bottom-centre so it
          never fights the sticky toolbar; above the sticky pager (z-40 > z-30). */}
      {pending ? (
        <div className="fixed bottom-16 left-1/2 z-40 -translate-x-1/2">
          <Hint label={QUEUE_REFRESH_HELP}>
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
          </Hint>
        </div>
      ) : null}

      {/* Toolbar: the title/search row + the filter bar sit above the scrolling
          table pane, so they're always visible (`shrink-0` — the pane gives up the
          height when chips wrap). `sticky top-header` only matters on short screens where
          the page itself scrolls: it parks the band flush under the header. Full-bleed
          negative gutters (`-mx-main-x`) cancel <main>'s px so the bottom border spans
          edge-to-edge like the header. z-30 sits below the header (z-40) but above
          table rows; the filter/Columns popovers portal above both. */}
      <div className="sticky top-header z-30 -mx-main-x shrink-0 space-y-2 border-b bg-card/95 px-main-x py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/80 compact:space-y-1.5 compact:py-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-base font-semibold tracking-tight">{scope.title}</h2>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative w-48 sm:w-64 md:w-72">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Hint label={QUEUE_SEARCH_HELP} side="bottom">
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder={scope.searchPlaceholder}
                  aria-label={scope.searchPlaceholder}
                  className="pl-9"
                />
              </Hint>
            </div>
            <ColumnPicker
              columns={columns}
              layout={columnLayout}
              allColumns={columnUniverse}
              defaultColumns={scope.defaultColumns}
              onChange={changeColumns}
              onReset={resetColumns}
              saveNote={
                scope.kind === "project"
                  ? "Saved to your account for this project — only you see it"
                  : "Saved in this browser only — only you see it"
              }
            />
            {scope.newTicketHref && canCreateTicket ? (
              <Hint label={`Raise a new ticket in ${scope.title}`} side="bottom">
                <Button asChild size="sm">
                  <Link href={scope.newTicketHref}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    New ticket
                  </Link>
                </Button>
              </Hint>
            ) : scope.newTicketHref ? (
              <Hint label={NO_CREATE_TICKET_PERMISSION} side="bottom">
                <Button size="sm" disabled>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New ticket
                </Button>
              </Hint>
            ) : null}
          </div>
        </div>

        <FilterBar
          saveProjectId={scope.saveProjectId}
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

      {/* Table pane: the queue's scroll container (both axes). `min-h-0` lets the
          flex item shrink below its content and scroll; short lists keep their
          natural height. The inner Table wrapper is made `overflow-visible` so THIS
          div is the sticky header's scroll container. */}
      <div
        ref={paneRef}
        className="min-h-0 overflow-auto rounded-xl border bg-card shadow-soft"
        onMouseEnter={() => (tableHoverRef.current = true)}
        onMouseLeave={() => (tableHoverRef.current = false)}
      >
        <Table containerClassName="overflow-visible">
          <TableHeader sticky>
            <TableRow>
              {columns.map((key) => {
                const def = colDef(key);
                return def.sortKey ? (
                  <SortHead
                    key={key}
                    label={def.label}
                    description={def.description}
                    col={def.sortKey}
                    ordering={ordering}
                    relevance={relevanceRanked}
                    onSort={cycleSort}
                    className={def.width}
                  />
                ) : (
                  <TableHead key={key} className={def.width}>
                    <span className="inline-flex items-center gap-1">
                      {def.label}
                      <InfoTip label={`About the ${def.label} column`}>
                        {[def.description, NOT_SORTABLE_HELP].filter(Boolean).join("\n")}
                      </InfoTip>
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {columns.map((key) => (
                    <TableCell key={key} className={colDef(key).width}>
                      <Skeleton className="h-4 w-full max-w-[180px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : tickets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-48 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 py-6">
                    <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Inbox className="size-6" aria-hidden="true" />
                    </div>
                    <p className="text-sm font-medium text-foreground">No tickets match your filters</p>
                    <p className="text-xs text-muted-foreground">
                      Try clearing filters or adjusting your search.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              tickets.map((t) => {
                const href = scope.rowHref(t);
                const cellCtx = { href, now, project: scope.projectFor(t), groupVisible };
                return (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={(e) => openTicketFromRow(e, () => router.push(href))}
                  >
                    {columns.map((key) => (
                      <TableCell key={key} className={colDef(key).width}>
                        {renderQueueCell(key, t, cellCtx)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer band: "Showing X–Y of N" on the left, pager on the right. The last
          item of the viewport-height column, so it sits flush on the viewport bottom
          below the scrolling table pane (`shrink-0`). `sticky bottom-0` only matters
          on short screens where the page itself scrolls. Full-bleed: negative gutters
          (`-mx-main-x`) cancel <main>'s px so the top border spans edge-to-edge like
          the header; z-30 sits above table rows. Always rendered (the count lives
          here); the pager itself only when there's more than one page. `mt-auto`
          pins it to the viewport bottom when the list is short or empty (the table
          card keeps its natural height instead of the footer floating under it). */}
      <div className="sticky bottom-0 z-30 -mx-main-x mt-auto flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-card/95 px-main-x py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/80 compact:min-h-10 compact:py-1.5">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {loading && tickets.length === 0
            ? null
            : count === 0
              ? "No tickets"
              : `Showing ${rangeStart}–${rangeEnd} of ${count}${relevanceRanked ? ` · ${RELEVANCE_SORT_NOTE}` : ""}`}
        </p>
        {totalPages > 1 && (
          <nav className="flex items-center gap-1" aria-label="Pagination">
            <Hint label={page <= 1 ? "Already on the first page" : loading ? "Loading…" : ""}>
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
            </Hint>
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
            <Hint
              label={page >= totalPages ? "Already on the last page" : loading ? "Loading…" : ""}
            >
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
            </Hint>
          </nav>
        )}
      </div>
    </div>
  );
}

/** Single-project queue (a project tab). Prefs persist server-side per project. */
export function TicketQueue({ project }: { project: Project }) {
  const { org, helpdeskKey } = useWorkspace();
  const opts = useFilterOptions(project);
  const base = `/t/${org}/agent/w/${helpdeskKey}/p/${project.key}`;
  const scope = useMemo<QueueScope>(
    () => ({
      kind: "project",
      title: project.name,
      queuePath: base,
      searchPlaceholder: `Search ${project.name}…`,
      storageId: project.id,
      listParams: { project: project.id },
      saveProjectId: project.id,
      savedFiltersParams: { project: project.id },
      disabledViewKeys: project.disabled_view_keys ?? [],
      scopeDefaultViewKey: project.default_view_key ?? null,
      showProjectColumn: false,
      newTicketHref: `${base}/new`,
      rowHref: (t) => `${base}/${t.ticket_number}`,
      projectFor: () => null,
      resolveColumns: (pref) => resolveQueueColumns(pref, project.queue_columns),
      resolveLayout: (pref) => resolveQueueLayout(pref, project.queue_columns),
      // What Reset returns to: the admin's project default when set, else built-in —
      // so the picker's "Already using the default layout" state is accurate.
      defaultColumns: resolveQueueColumns(null, project.queue_columns),
      loadColumns: () => queueColumnsApi.get(project.id),
      persistColumns: (cols) => {
        queueColumnsApi.set(project.id, cols).catch(() => undefined);
      },
      loadDefaultView: () => queueViewApi.get(project.id),
      persistDefaultView: (key) => queueViewApi.set(project.id, key).then(() => undefined),
    }),
    [project, base],
  );
  return <QueueView scope={scope} opts={opts} />;
}

/** Combined "All tickets" queue — every project the agent can access in this
 *  helpdesk, in one place. Prefs (columns / default view) persist in localStorage
 *  (no single project to key server-side prefs to); saved views are cross-project
 *  (`project=null`) SavedFilters. */
export function CombinedTicketQueue() {
  const { org, helpdeskKey, helpdesk, projects } = useWorkspace();
  // Modern opens All Tickets rows at /all/NUMBER (docked beside this queue on lg+);
  // Classic keeps the project detail URL with ?from=all.
  const modern = useUi().ui === "modern";
  const helpdeskId = helpdesk?.id ?? "";
  const opts = useCombinedFilterOptions({ helpdeskKey, helpdeskId, projects });
  const wbase = `/t/${org}/agent/w/${helpdeskKey}`;
  const projByKey = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.key, p])) as Record<string, Project>,
    [projects],
  );
  const colsKey = `itsm:allqueue:${helpdeskId}:cols`;
  const viewLsKey = `itsm:allqueue:${helpdeskId}:view`;
  const scope = useMemo<QueueScope>(
    () => ({
      kind: "combined",
      title: "All Tickets",
      queuePath: `${wbase}/all`,
      searchPlaceholder: "Search all tickets…",
      storageId: `all:${helpdeskId}`,
      listParams: { helpdesk: helpdeskKey },
      saveProjectId: null,
      savedFiltersParams: { helpdesk: helpdeskId },
      // Admin view-menu settings (Configuration → All-Tickets Filters).
      disabledViewKeys: helpdesk?.combined_disabled_view_keys ?? [],
      scopeDefaultViewKey: helpdesk?.combined_default_view_key || null,
      showProjectColumn: true,
      newTicketHref: null,
      // Route each row to its own project's detail; `from=all` lets the detail's
      // "Back to queue" return here instead of the single-project queue.
      rowHref: (t) =>
        modern ? `${wbase}/all/${t.ticket_number}` : `${wbase}/p/${t.project_key}/${t.ticket_number}?from=all`,
      projectFor: (t) => {
        const p = projByKey[t.project_key];
        return p ? { name: p.name, color: p.color } : null;
      },
      // Precedence: this agent's localStorage override → helpdesk admin default
      // (`combined_queue_columns`) → built-in combined default.
      resolveColumns: (pref) => resolveCombinedColumns(pref, helpdesk?.combined_queue_columns),
      resolveLayout: (pref) => resolveCombinedLayout(pref, helpdesk?.combined_queue_columns),
      defaultColumns: resolveCombinedColumns(null, helpdesk?.combined_queue_columns),
      loadColumns: () => Promise.resolve(readLocalCols(colsKey)),
      persistColumns: (cols) => writeLocalCols(colsKey, cols),
      loadDefaultView: () => Promise.resolve(readLocalStr(viewLsKey)),
      persistDefaultView: (key) => {
        writeLocalStr(viewLsKey, key);
        return Promise.resolve();
      },
    }),
    [org, helpdeskKey, helpdeskId, helpdesk, wbase, projByKey, colsKey, viewLsKey, modern],
  );
  return <QueueView scope={scope} opts={opts} />;
}

function SortHead({
  label,
  description,
  col,
  ordering,
  relevance = false,
  onSort,
  className,
}: {
  label: string;
  /** Column help (QUEUE_COLUMN_HELP) — shown above the "click to sort" line. */
  description?: string;
  col: string;
  ordering: string;
  /** A search is relevance-ranked: the default-order column shows no arrow. */
  relevance?: boolean;
  onSort: (col: string) => void;
  className?: string;
}) {
  const isDefaultCol = `-${col}` === DEFAULT_ORDERING;
  const ranked = relevance && isDefaultCol;
  const dir = ranked ? null : ordering === col ? "asc" : ordering === `-${col}` ? "desc" : null;
  return (
    <TableHead
      className={className}
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
    >
      <Hint label={[description, ranked ? RELEVANCE_SORT_HELP : sortActionHelp(dir, isDefaultCol)].filter(Boolean).join("\n")}>
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
      </Hint>
    </TableHead>
  );
}
