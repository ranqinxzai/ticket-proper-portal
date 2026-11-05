"use client";

/**
 * The ticket "Asset" field (Asset Management phase 2): an ordered list of linked
 * assets, the first being the primary. Used by the agent create form, the ticket
 * detail inline editor and (variant "portal") the Service Portal request form.
 *
 * Every sub-component is module-level (React component-stability rule).
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Loader2, Plus, Search, Star, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { selectCls } from "@/components/tickets/field-styles";
import { useAssetPerms } from "@/lib/itsm/asset-perms";
import { assetCategoriesApi, assetsApi, assetUsersApi, departmentsApi, locationsApi } from "@/lib/itsm/assets-api";
import {
  ACTIVE_STATE_TYPES,
  ASSET_STATE_TYPES,
  type AssetCategory,
  type AssetListItem,
  type AssetUserRef,
  type Department,
  type Location,
} from "@/lib/itsm/assets-types";
import { ASSET_LINK_HELP } from "@/lib/itsm/help/assets";
import type { PortalAsset, TicketAssetLink } from "@/lib/itsm/types";
import { cn } from "@/lib/utils";

// ── Shape + converters ───────────────────────────────────────────────────────

/** One selected asset as the field shows it. Order matters: index 0 = primary. */
export type LinkedAssetChip = {
  id: string;
  asset_tag: string;
  name: string;
  category?: string | null;
  sub_category?: string | null;
  status?: { name: string; color: string; state_type: string } | null;
  assigned_user?: { id: string | number; username: string; full_name: string } | null;
  is_deleted?: boolean;
};

export function chipFromListItem(a: AssetListItem): LinkedAssetChip {
  return {
    id: a.id,
    asset_tag: a.asset_tag,
    name: a.name,
    category: a.category?.name ?? null,
    sub_category: a.sub_category?.name ?? null,
    status: a.status ? { name: a.status.name, color: a.status.color, state_type: a.status.state_type } : null,
    assigned_user: a.assigned_user
      ? { id: a.assigned_user.id, username: a.assigned_user.username, full_name: a.assigned_user.full_name }
      : null,
  };
}

export function chipFromTicketLink(a: TicketAssetLink): LinkedAssetChip {
  return {
    id: a.id,
    asset_tag: a.asset_tag,
    name: a.name,
    category: a.category,
    sub_category: a.sub_category,
    status: a.status,
    assigned_user: a.assigned_user,
    is_deleted: a.is_deleted,
  };
}

export function chipFromPortal(a: PortalAsset): LinkedAssetChip {
  return { id: a.id, asset_tag: a.asset_tag, name: a.name, category: a.category, sub_category: a.sub_category };
}

/** The field's value as the API wants it: asset ids, primary first. */
export function assetIds(v: unknown): string[] {
  return Array.isArray(v)
    ? v.map((x) => (x && typeof x === "object" && "id" in x ? String((x as LinkedAssetChip).id) : String(x)))
    : [];
}

const STATE_LABEL: Record<string, string> = Object.fromEntries(ASSET_STATE_TYPES.map((s) => [s.value, s.label]));
const isActiveState = (s?: string | null) => !s || (ACTIVE_STATE_TYPES as string[]).includes(s);
const personName = (u?: { full_name?: string; username?: string } | null) =>
  u ? (u.full_name || "").trim() || u.username || "" : "";
const categoryPath = (a: { category?: string | null; sub_category?: string | null }) =>
  [a.category, a.sub_category].filter(Boolean).join(" › ");

// ── Small pieces ─────────────────────────────────────────────────────────────

function StatusDot({ color }: { color?: string | null }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color || "#64748b" }}
      aria-hidden="true"
    />
  );
}

function PrimaryBadge() {
  return (
    <Hint label={ASSET_LINK_HELP.primary} wrap>
      <span className="inline-flex shrink-0 items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide text-primary-ink">
        Primary
      </span>
    </Hint>
  );
}

function StateBadge({ state }: { state?: string | null }) {
  if (isActiveState(state)) return null;
  const label = STATE_LABEL[state ?? ""] ?? state ?? "";
  return (
    <Hint label={ASSET_LINK_HELP.inactiveState(label)} wrap>
      <span className="inline-flex shrink-0 items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
        {label}
      </span>
    </Hint>
  );
}

/** One selected asset: tag · name, status dot, Primary badge, Make primary + Unlink. */
function SelectedAssetChip({
  asset,
  primary,
  href,
  readOnly,
  disabled,
  disabledReason,
  onPrimary,
  onRemove,
}: {
  asset: LinkedAssetChip;
  primary: boolean;
  href?: string | null;
  readOnly?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onPrimary: () => void;
  onRemove: () => void;
}) {
  const text = `${asset.asset_tag} · ${asset.name}`;
  const sub = [categoryPath(asset), asset.status?.name].filter(Boolean).join(" · ");
  const title = sub ? `${text}\n${sub}` : text;
  const label = (
    <span className={cn("truncate", asset.is_deleted && "text-muted-foreground line-through")}>
      <span className="font-mono text-xs">{asset.asset_tag}</span>
      <span className="text-muted-foreground"> · </span>
      {asset.name}
    </span>
  );
  return (
    <li
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm",
        primary && "border-primary/40",
      )}
    >
      <StatusDot color={asset.is_deleted ? null : asset.status?.color} />
      {href && !asset.is_deleted ? (
        <Link href={href} title={title} className="min-w-0 truncate hover:underline">
          {label}
        </Link>
      ) : (
        <span title={title} className="min-w-0 truncate">
          {label}
        </span>
      )}
      {primary ? <PrimaryBadge /> : null}
      {asset.is_deleted ? (
        <Hint label={ASSET_LINK_HELP.deleted} wrap>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
            Deleted
          </span>
        </Hint>
      ) : (
        <StateBadge state={asset.status?.state_type} />
      )}
      {!readOnly ? (
        <span className="ml-auto flex shrink-0 items-center">
          {!primary ? (
            <IconButton
              label={ASSET_LINK_HELP.makePrimary(asset.asset_tag)}
              disabled={disabled}
              disabledReason={disabledReason}
              className="h-6 w-6 text-muted-foreground hover:text-primary"
              onClick={onPrimary}
            >
              <Star className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
          ) : null}
          <IconButton
            label={ASSET_LINK_HELP.remove(asset.asset_tag)}
            disabled={disabled}
            disabledReason={disabledReason}
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </IconButton>
        </span>
      ) : null}
    </li>
  );
}

/** How many of the requestor's assets show before "Show N more" (GridCrest
 *  2026-10-29: a requestor with 16 assets filled the side rail). */
const SUGGESTION_PREVIEW = 3;

/** Requestor's active assets as one-click "add" chips (those not linked yet): the
 *  first SUGGESTION_PREVIEW (by asset tag), the rest behind "Show N more". */
function RequestorSuggestions({
  loading,
  assets,
  selectedIds,
  hasRequestor,
  disabled,
  onAdd,
}: {
  loading: boolean;
  assets: LinkedAssetChip[];
  selectedIds: Set<string>;
  hasRequestor: boolean;
  disabled?: boolean;
  onAdd: (a: LinkedAssetChip) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const rest = assets.filter((a) => !selectedIds.has(a.id));
  const hiddenCount = Math.max(0, rest.length - SUGGESTION_PREVIEW);
  const shown = showAll ? rest : rest.slice(0, SUGGESTION_PREVIEW);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        Requestor&rsquo;s assets
        <InfoTip label="About the requestor's assets">{ASSET_LINK_HELP.requestorAssets}</InfoTip>
      </div>
      {!hasRequestor ? (
        <p className="text-xs text-muted-foreground">{ASSET_LINK_HELP.noRequestor}</p>
      ) : loading ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading…
        </p>
      ) : assets.length === 0 ? (
        <p className="text-xs text-muted-foreground">No active assets are allotted to the requestor.</p>
      ) : rest.length === 0 ? (
        <p className="text-xs text-muted-foreground">All of them are linked.</p>
      ) : (
        <>
        <ul id={listId} className="flex flex-wrap gap-1.5">
          {shown.map((a) => (
            <li key={a.id} className="min-w-0 max-w-full">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAdd(a)}
                title={[`${a.asset_tag} · ${a.name}`, categoryPath(a)].filter(Boolean).join("\n")}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-xs transition-colors hover:border-primary/50 hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
                <StatusDot color={a.status?.color} />
                <span className="truncate">
                  <span className="font-mono">{a.asset_tag}</span> · {a.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {hiddenCount > 0 ? (
          <button
            type="button"
            aria-expanded={showAll}
            aria-controls={listId}
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {showAll ? "Show less" : `Show ${hiddenCount} more`}
            {showAll ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        ) : null}
        </>
      )}
    </div>
  );
}

// ── Finder dialog ────────────────────────────────────────────────────────────

type FinderFilters = {
  category: string;
  state_type: string;
  location: string;
  department: string;
  /** user id, "none" = not allotted, "" = anyone */
  assigned_user: string;
};
const NO_FILTERS: FinderFilters = { category: "", state_type: "", location: "", department: "", assigned_user: "" };

function FinderSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(selectCls, value && "border-primary/50")}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** "Assigned to" filter: Anyone / Not allotted / the requestor / a searched person. */
function AssignedToFilter({
  value,
  onChange,
  requestor,
}: {
  value: string;
  onChange: (v: string) => void;
  requestor?: { id: string; name: string } | null;
}) {
  const [picked, setPicked] = useState<AssetUserRef | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AssetUserRef[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (value !== "__pick") return;
    const h = setTimeout(() => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setSearching(true);
      assetUsersApi
        .search(q.trim())
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(h);
  }, [q, value]);

  const options = [
    { value: "none", label: "Not allotted" },
    ...(requestor ? [{ value: requestor.id, label: `Requestor (${requestor.name})` }] : []),
    ...(picked && String(picked.id) !== requestor?.id ? [{ value: String(picked.id), label: personName(picked) }] : []),
    { value: "__pick", label: "Someone else…" },
  ];

  return (
    <div className="space-y-1.5">
      <FinderSelect
        label="Assigned to"
        allLabel="Assigned to anyone"
        value={value}
        options={options}
        onChange={(v) => {
          if (v === "__pick") {
            setQ("");
            setResults([]);
          }
          onChange(v);
        }}
      />
      {value === "__pick" ? (
        <div className="relative">
          <Input
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people…"
            aria-label="Assigned to: search people"
            className="h-[var(--ctl-h)]"
          />
          {searching ? (
            <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
          {results.length > 0 ? (
            <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
              {results.map((u) => (
                <li key={String(u.id)}>
                  <button
                    type="button"
                    className="flex w-full flex-col rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                    onClick={() => {
                      setPicked(u);
                      setResults([]);
                      onChange(String(u.id));
                    }}
                  >
                    <span className="truncate">{personName(u)}</span>
                    {u.email ? <span className="truncate text-xs text-muted-foreground">{u.email}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FinderResult({
  asset,
  linked,
  locked,
  onAdd,
}: {
  asset: AssetListItem;
  linked: boolean;
  /** A save is in flight: wait before adding another. */
  locked?: boolean;
  onAdd: () => void;
}) {
  const path = categoryPath({ category: asset.category?.name, sub_category: asset.sub_category?.name });
  const user = personName(asset.assigned_user);
  const btn = (
    <button
      type="button"
      disabled={linked || locked}
      onClick={onAdd}
      className="flex w-full min-w-0 items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="mt-1.5">
        <StatusDot color={asset.status?.color} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="font-mono text-xs">{asset.asset_tag}</span>
          <span className="min-w-0 truncate font-medium" title={asset.name}>
            {asset.name}
          </span>
          <StateBadge state={asset.status?.state_type} />
          {!asset.assigned_user ? (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
              Not allotted
            </span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground" title={[path, asset.status?.name, user].filter(Boolean).join(" · ")}>
          {[path, asset.status?.name, user].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="mt-0.5 shrink-0 text-xs font-medium text-primary-ink">{linked ? "Linked" : "Add"}</span>
    </button>
  );
  const why = linked ? ASSET_LINK_HELP.alreadyLinked : locked ? "Saving…" : "";
  return (
    <li>
      <Hint label={why} className="flex w-full">
        {btn}
      </Hint>
    </li>
  );
}

/** "Find another asset": search + Category / State / Location / Department / Assigned-to
 *  filters over every asset of the helpdesk. Clicking a result links it; the dialog stays
 *  open so several can be added. */
function AssetFinderDialog({
  open,
  onOpenChange,
  helpdeskId,
  requestor,
  selectedIds,
  locked,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  helpdeskId: string;
  requestor?: { id: string; name: string } | null;
  selectedIds: Set<string>;
  locked?: boolean;
  onAdd: (a: LinkedAssetChip) => void;
}) {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<FinderFilters>(NO_FILTERS);
  const [results, setResults] = useState<AssetListItem[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const seq = useRef(0);

  // Lookups once per open.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    assetCategoriesApi.list({ helpdesk: helpdeskId, active: true }).then((v) => alive && setCategories(v)).catch(() => undefined);
    locationsApi.list({ active: true }).then((v) => alive && setLocations(v)).catch(() => undefined);
    departmentsApi.list({ active: true }).then((v) => alive && setDepartments(v)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, helpdeskId]);

  // Search (debounced); a newer search drops a slower older one.
  useEffect(() => {
    if (!open) return;
    const my = ++seq.current;
    setLoading(true);
    const h = setTimeout(() => {
      const assigned = filters.assigned_user === "__pick" ? "" : filters.assigned_user;
      assetsApi
        .list({
          helpdesk: helpdeskId,
          search: q.trim() || undefined,
          category: filters.category || undefined,
          state_type: filters.state_type || undefined,
          location: filters.location || undefined,
          department: filters.department || undefined,
          assigned_user: assigned || undefined,
          ordering: "asset_tag",
          page_size: 25,
        })
        .then((page) => {
          if (my !== seq.current) return;
          setResults(page.results);
          setCount(page.count);
          setFailed(false);
        })
        .catch(() => {
          if (my !== seq.current) return;
          setResults([]);
          setCount(0);
          setFailed(true);
        })
        .finally(() => my === seq.current && setLoading(false));
    }, 250);
    return () => clearTimeout(h);
  }, [open, helpdeskId, q, filters]);

  const set = (k: keyof FinderFilters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const anyFilter = !!q.trim() || Object.values(filters).some(Boolean);
  const topCategories = categories.filter((c) => !c.parent);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            Find an asset
            <InfoTip label="About finding assets">{ASSET_LINK_HELP.finder}</InfoTip>
          </DialogTitle>
          <DialogDescription>Click an asset to link it. You can add several.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                // Never submit the ticket form behind the dialog.
                if (e.key === "Enter") e.preventDefault();
              }}
              placeholder="Search tag, name, user, details…"
              aria-label="Search assets"
              className="h-[var(--ctl-h)] pl-8 pr-8"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <InfoTip label="About asset search">{ASSET_LINK_HELP.finderSearch}</InfoTip>
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <FinderSelect
              label="Category"
              allLabel="All categories"
              value={filters.category}
              options={topCategories.map((c) => ({ value: c.id, label: c.name }))}
              onChange={set("category")}
            />
            <FinderSelect
              label="State"
              allLabel="All states"
              value={filters.state_type}
              options={[{ value: "active", label: "Active (any)" }, ...ASSET_STATE_TYPES]}
              onChange={set("state_type")}
            />
            <FinderSelect
              label="Location"
              allLabel="All locations"
              value={filters.location}
              options={[...locations.map((l) => ({ value: l.id, label: l.name })), { value: "none", label: "No location" }]}
              onChange={set("location")}
            />
            <FinderSelect
              label="Department"
              allLabel="All departments"
              value={filters.department}
              options={[...departments.map((d) => ({ value: d.id, label: d.name })), { value: "none", label: "No department" }]}
              onChange={set("department")}
            />
            <div className="sm:col-span-2">
              <AssignedToFilter value={filters.assigned_user} onChange={set("assigned_user")} requestor={requestor} />
            </div>
          </div>
          {anyFilter ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ("");
                setFilters(NO_FILTERS);
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>

        <div className="min-h-[8rem]" aria-live="polite">
          {loading && results.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Searching…
            </p>
          ) : failed ? (
            <p className="text-sm text-muted-foreground">Could not load assets. Try again.</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assets match.</p>
          ) : (
            <>
              <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                {count > results.length
                  ? `Showing ${results.length} of ${count.toLocaleString()} — refine the search to narrow it down.`
                  : `${count.toLocaleString()} ${count === 1 ? "asset" : "assets"}`}
              </p>
              <ul className="divide-y rounded-md border">
                {results.map((a) => (
                  <FinderResult
                    key={a.id}
                    asset={a}
                    linked={selectedIds.has(a.id)}
                    locked={locked}
                    onAdd={() => onAdd(chipFromListItem(a))}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Portal variant ───────────────────────────────────────────────────────────

function PortalAssetChoices({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: LinkedAssetChip[];
  value: LinkedAssetChip[];
  disabled?: boolean;
  onChange: (next: LinkedAssetChip[]) => void;
}) {
  const ids = value.map((v) => v.id);
  return (
    <div className="space-y-1.5">
      <ul role="group" aria-label={label} className="space-y-1.5">
        {options.map((a) => {
          const on = ids.includes(a.id);
          const path = categoryPath(a);
          return (
            <li key={a.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent/60",
                  on && "border-primary/40 bg-primary/5",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  checked={on}
                  disabled={disabled}
                  onChange={() => onChange(on ? value.filter((v) => v.id !== a.id) : [...value, a])}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate" title={`${a.asset_tag} · ${a.name}`}>
                    <span className="font-mono text-xs">{a.asset_tag}</span> · {a.name}
                  </span>
                  {path ? <span className="block truncate text-xs text-muted-foreground">{path}</span> : null}
                </span>
                {on && ids[0] === a.id && value.length > 1 ? <PrimaryBadge /> : null}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── The field ────────────────────────────────────────────────────────────────

export type AssetLinkFieldProps = {
  /** Field name, for accessible labels. */
  label: string;
  value: LinkedAssetChip[];
  onChange: (next: LinkedAssetChip[]) => void;
  variant?: "agent" | "portal";
  /** Agent: the ticket's helpdesk (asset search + requestor suggestions). */
  helpdeskId?: string | null;
  /** Agent: the requestor whose allotted assets are suggested. */
  requestorId?: string | null;
  requestorName?: string | null;
  /** Agent: called when the requestor's assets have loaded (null id = no requestor). */
  onRequestorAssets?: (requestorId: string | null, assets: LinkedAssetChip[]) => void;
  /** Portal: the requestor's own assets to choose from. */
  options?: LinkedAssetChip[];
  /** Asset page link for a chip (agent). */
  hrefFor?: (assetId: string) => string | null;
  /** No editing at all (chips only). */
  readOnly?: boolean;
  /** Editing temporarily blocked (a save in flight, a layout rule). */
  disabled?: boolean;
  disabledReason?: string;
  /** A save is in flight (spinner beside the chips). */
  busy?: boolean;
};

export function AssetLinkField({
  label,
  value,
  onChange,
  variant = "agent",
  helpdeskId,
  requestorId,
  requestorName,
  onRequestorAssets,
  options,
  hrefFor,
  readOnly,
  disabled,
  disabledReason,
  busy,
}: AssetLinkFieldProps) {
  const perms = useAssetPerms();
  const canSearch = variant === "agent" && perms.read && !!helpdeskId;
  const [finderOpen, setFinderOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<LinkedAssetChip[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const selectedIds = useMemo(() => new Set(value.map((v) => v.id)), [value]);
  const reportRef = useRef(onRequestorAssets);
  reportRef.current = onRequestorAssets;
  const lock = disabled || busy;

  // The requestor's active assets in this helpdesk (agent only, needs Assets read).
  useEffect(() => {
    if (variant !== "agent" || readOnly) return;
    if (!requestorId || !helpdeskId || !perms.read) {
      setSuggestions([]);
      reportRef.current?.(null, []);
      return;
    }
    let alive = true;
    setSuggesting(true);
    assetsApi
      .list({ helpdesk: helpdeskId, assigned_user: requestorId, state_type: "active", ordering: "asset_tag", page_size: 50 })
      .then((page) => {
        if (!alive) return;
        const chips = page.results.map(chipFromListItem);
        setSuggestions(chips);
        reportRef.current?.(requestorId, chips);
      })
      .catch(() => alive && setSuggestions([]))
      .finally(() => alive && setSuggesting(false));
    return () => {
      alive = false;
    };
  }, [variant, readOnly, requestorId, helpdeskId, perms.read]);

  const add = (a: LinkedAssetChip) => {
    if (selectedIds.has(a.id)) return;
    onChange([...value, a]);
  };
  const remove = (id: string) => onChange(value.filter((v) => v.id !== id));
  const makePrimary = (id: string) => {
    const hit = value.find((v) => v.id === id);
    if (hit) onChange([hit, ...value.filter((v) => v.id !== id)]);
  };

  if (variant === "portal") {
    return (
      <PortalAssetChoices label={label} options={options ?? []} value={value} disabled={lock} onChange={onChange} />
    );
  }

  const chips = value.length ? (
    <ul className="space-y-1.5" aria-label={`${label}: linked assets`}>
      {value.map((a, i) => (
        <SelectedAssetChip
          key={a.id}
          asset={a}
          primary={i === 0}
          href={hrefFor?.(a.id)}
          readOnly={readOnly}
          disabled={lock}
          disabledReason={disabledReason}
          onPrimary={() => makePrimary(a.id)}
          onRemove={() => remove(a.id)}
        />
      ))}
    </ul>
  ) : null;

  if (readOnly) return chips ?? <span className="text-sm text-muted-foreground">—</span>;

  const findReason = !perms.read ? ASSET_LINK_HELP.needsAssetRead : lock ? disabledReason : undefined;

  return (
    <div className="space-y-2">
      {chips ?? <p className="text-sm text-muted-foreground">No assets linked.</p>}
      {perms.read ? (
        <RequestorSuggestions
          loading={suggesting}
          assets={suggestions}
          selectedIds={selectedIds}
          hasRequestor={!!requestorId}
          disabled={lock}
          onAdd={add}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Hint label={findReason}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canSearch || lock}
            onClick={() => setFinderOpen(true)}
          >
            <Search className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Find another asset
          </Button>
        </Hint>
        {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Saving" /> : null}
      </div>
      {!perms.read ? <p className="text-xs text-muted-foreground">{ASSET_LINK_HELP.needsAssetRead}</p> : null}
      {canSearch && finderOpen ? (
        <AssetFinderDialog
          open={finderOpen}
          onOpenChange={setFinderOpen}
          helpdeskId={helpdeskId!}
          requestor={requestorId ? { id: requestorId, name: requestorName || "requestor" } : null}
          selectedIds={selectedIds}
          locked={lock}
          onAdd={add}
        />
      ) : null}
    </div>
  );
}

