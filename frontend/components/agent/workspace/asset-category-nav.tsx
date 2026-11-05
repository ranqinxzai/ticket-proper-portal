"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Boxes, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { assetCategoriesApi } from "@/lib/itsm/assets-api";
import type { AssetCategory } from "@/lib/itsm/assets-types";
import { ASSET_HELP } from "@/lib/itsm/help/assets";
import { IconButton } from "@/components/ui/icon-button";

// Whether the category tree under Asset List is open, per browser.
const OPEN_KEY = "itsm-asset-tree-open";
// The list's "no sub-category" filter value (asset-filters NONE / backend filters "none").
const NONE = "none";

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveOpen(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* storage blocked — the tree just starts closed next time */
  }
}

type Node = { cat: AssetCategory; subs: AssetCategory[]; unsorted: number };

const byOrder = (a: AssetCategory, b: AssetCategory) =>
  a.sort_order - b.sort_order || a.name.localeCompare(b.name);

/** One tree row: a link with the name and its asset count. */
function TreeLink({
  href,
  label,
  count,
  active,
  muted,
  onNavigate,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
  muted?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1 text-[0.8125rem] transition-colors compact:py-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-primary/10 font-medium text-primary-ink"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        muted && !active && "italic",
      )}
    >
      <span className="truncate" title={label}>
        {label}
      </span>
      <span className="shrink-0 text-xs tabular-nums">{count.toLocaleString()}</span>
    </Link>
  );
}

/** "Asset List" in the workspace sidebar plus a ManageEngine-style tree under it:
 *  categories → sub-categories with their asset counts. Asset List itself still opens
 *  every asset; a node opens the list filtered to that category / sub-category (the
 *  list keeps filters in the URL, so this is just `?category=…&sub_category=…`).
 *  Expanded sidebar only — the icon rail keeps the plain link. */
export function AssetListNav({
  base,
  helpdeskId,
  onNavigate,
}: {
  base: string;
  helpdeskId: string | null | undefined;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const listHref = `${base}/assets/list`;
  const onList = pathname === listHref;
  const inList = onList || pathname.startsWith(listHref + "/");
  const selCat = onList ? sp.get("category") ?? "" : "";
  const selSub = onList ? sp.get("sub_category") ?? "" : "";

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<AssetCategory[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Restore the remembered state after mount (no SSR mismatch); a category in the URL
  // always opens the tree to it.
  useEffect(() => {
    if (readOpen()) setOpen(true);
  }, []);
  useEffect(() => {
    if (!selCat) return;
    setOpen(true);
    setExpanded((cur) => (cur.has(selCat) ? cur : new Set(cur).add(selCat)));
  }, [selCat]);

  // Load when opened, and again after each navigation while open (a create, delete or
  // import changes the counts).
  useEffect(() => {
    if (!open || !helpdeskId) return;
    let alive = true;
    assetCategoriesApi
      .list({ helpdesk: helpdeskId })
      .then((rows) => {
        if (!alive) return;
        setCats(rows);
        setFailed(false);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [open, helpdeskId, pathname]);

  const tree: Node[] = useMemo(() => {
    // Inactive categories stay listed while they still hold assets, so the counts add up.
    const shown = (cats ?? []).filter((c) => c.is_active || c.asset_count > 0);
    return shown
      .filter((c) => !c.parent)
      .sort(byOrder)
      .map((cat) => {
        const subs = shown.filter((s) => s.parent === cat.id).sort(byOrder);
        const inSubs = subs.reduce((n, s) => n + s.asset_count, 0);
        return { cat, subs, unsorted: subs.length ? Math.max(0, cat.asset_count - inSubs) : 0 };
      });
  }, [cats]);

  function toggleOpen() {
    setOpen((o) => {
      saveOpen(!o);
      return !o;
    });
  }

  function toggleCat(id: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const listActive = inList && !selCat;
  const catHref = (id: string, sub?: string) =>
    `${listHref}?category=${encodeURIComponent(id)}${sub ? `&sub_category=${encodeURIComponent(sub)}` : ""}`;

  return (
    <>
      <div className="flex items-center gap-0.5">
        <Link
          href={listHref}
          onClick={onNavigate}
          aria-current={listActive ? "page" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors compact:py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            listActive
              ? "bg-primary/10 font-medium text-primary-ink"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Boxes className="h-4 w-4 shrink-0" aria-hidden="true" />
          {/* No total here: at the narrowest sidebar it would truncate the label, and the
              list header already shows it. */}
          <span className="truncate" title="Asset List">
            Asset List
          </span>
        </Link>
        <IconButton
          label={open ? "Hide asset categories" : "Show asset categories"}
          detail={ASSET_HELP.navTree}
          side="right"
          aria-expanded={open}
          aria-controls="asset-category-tree"
          onClick={toggleOpen}
          className="h-7 w-7 shrink-0 text-muted-foreground"
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} aria-hidden="true" />
        </IconButton>
      </div>

      {open ? (
        <ul id="asset-category-tree" aria-label="Asset categories" className="ml-5 mt-0.5 flex flex-col gap-0.5 border-l pl-1.5">
          {failed ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">Couldn&rsquo;t load the categories.</li>
          ) : !cats ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">Loading categories…</li>
          ) : tree.length === 0 ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">No categories yet.</li>
          ) : (
            tree.map(({ cat, subs, unsorted }) => {
              const exp = expanded.has(cat.id);
              return (
                <li key={cat.id}>
                  <div className="flex items-center">
                    {subs.length ? (
                      <IconButton
                        label={exp ? `Hide sub-categories of ${cat.name}` : `Show sub-categories of ${cat.name}`}
                        side="right"
                        aria-expanded={exp}
                        onClick={() => toggleCat(cat.id)}
                        className="h-6 w-6 shrink-0 text-muted-foreground"
                      >
                        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", exp && "rotate-90")} aria-hidden="true" />
                      </IconButton>
                    ) : (
                      <span className="w-6 shrink-0" aria-hidden="true" />
                    )}
                    <TreeLink
                      href={catHref(cat.id)}
                      label={cat.name}
                      count={cat.asset_count}
                      active={selCat === cat.id && !selSub}
                      onNavigate={onNavigate}
                    />
                  </div>
                  {exp && subs.length ? (
                    <ul aria-label={`${cat.name} sub-categories`} className="ml-6 flex flex-col gap-0.5">
                      {subs.map((s) => (
                        <li key={s.id} className="flex">
                          <TreeLink
                            href={catHref(cat.id, s.id)}
                            label={s.name}
                            count={s.asset_count}
                            active={selCat === cat.id && selSub === s.id}
                            onNavigate={onNavigate}
                          />
                        </li>
                      ))}
                      {unsorted ? (
                        <li className="flex">
                          <TreeLink
                            href={catHref(cat.id, NONE)}
                            label="No sub-category"
                            count={unsorted}
                            active={selCat === cat.id && selSub === NONE}
                            muted
                            onNavigate={onNavigate}
                          />
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </>
  );
}
