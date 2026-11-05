"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from "lucide-react";

import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AssetListItem } from "@/lib/itsm/assets-types";
import { ASSET_HELP } from "@/lib/itsm/help/assets";
import { sortActionHelp } from "@/lib/itsm/help/queue";
import { cn } from "@/lib/utils";

import { AssetStatusBadge } from "./asset-status-badge";
import { dateTone, daysUntil, fmtDate, userLabel } from "./asset-utils";

/** Next `ordering` value for a header click: asc → desc → default (""). */
export function nextOrdering(current: string, key: string): string {
  if (current === key) return `-${key}`;
  if (current === `-${key}`) return "";
  return key;
}

function SortHead({
  label,
  sortKey,
  ordering,
  onOrdering,
  help,
  className,
}: {
  label: string;
  sortKey: string;
  ordering: string;
  onOrdering: (next: string) => void;
  help?: string;
  className?: string;
}) {
  const dir = ordering === sortKey ? "asc" : ordering === `-${sortKey}` ? "desc" : null;
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <TableHead
      className={cn("whitespace-nowrap", className)}
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
    >
      <span className="inline-flex items-center gap-1">
        <Hint label={sortActionHelp(dir)}>
          <button
            type="button"
            onClick={() => onOrdering(nextOrdering(ordering, sortKey))}
            className={cn(
              "-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              dir && "text-foreground",
            )}
          >
            {label}
            <Icon className={cn("h-3.5 w-3.5", !dir && "opacity-40")} aria-hidden="true" />
          </button>
        </Hint>
        {help ? <InfoTip label={`About ${label}`}>{help}</InfoTip> : null}
      </span>
    </TableHead>
  );
}

function WarrantyCell({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground">—</span>;
  const tone = dateTone(iso);
  const d = daysUntil(iso) ?? 0;
  const sub =
    tone === "expired" ? "Ended" : tone === "soon" ? (d === 0 ? "Ends today" : `${d} day${d === 1 ? "" : "s"} left`) : "";
  return (
    <span
      className={cn(
        "inline-flex flex-col leading-tight",
        tone === "expired" && "text-destructive",
        tone === "soon" && "text-amber-700 dark:text-amber-400",
      )}
    >
      <span className="tabular-nums">{fmtDate(iso)}</span>
      {sub ? <span className="text-[11px] font-medium">{sub}</span> : null}
    </span>
  );
}

/** Whole-row → asset. Clicks on links/buttons/controls and modified clicks are left alone. */
function openFromRow(e: React.MouseEvent<HTMLTableRowElement>, open: () => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label, [role='button']")) return;
  open();
}

const COLS = 9;

/** The asset register table (Asset List + Asset Report). Header sorts via `ordering`
 *  (keys of `services/filters.ORDERING`); the whole row opens the asset. Put it inside a
 *  bounded `overflow-auto` box for the sticky header to work. */
export function AssetTable({
  rows,
  loading,
  ordering,
  onOrdering,
  hrefFor,
  empty,
}: {
  rows: AssetListItem[];
  loading: boolean;
  ordering: string;
  onOrdering: (next: string) => void;
  hrefFor: (id: string) => string;
  empty?: React.ReactNode;
}) {
  const router = useRouter();
  const sort = { ordering, onOrdering };
  return (
    <Table containerClassName="overflow-visible">
      <TableHeader sticky>
        <TableRow>
          <SortHead label="Tag" sortKey="asset_tag" {...sort} className="left-0 z-30 shadow-[inset_-1px_-1px_0_hsl(var(--border))]" />
          <SortHead label="Name" sortKey="name" {...sort} />
          <SortHead label="Category" sortKey="category" {...sort} />
          <SortHead label="Status" sortKey="status" {...sort} help={ASSET_HELP.stateType} />
          <SortHead label="User" sortKey="assigned_user" {...sort} />
          <SortHead label="Department" sortKey="department" {...sort} />
          <SortHead label="Location" sortKey="location" {...sort} />
          <SortHead label="Warranty expiry" sortKey="warranty_expiry_date" {...sort} help={ASSET_HELP.warrantyColumn} />
          <SortHead label="Purchase date" sortKey="purchase_date" {...sort} />
        </TableRow>
      </TableHeader>
      <TableBody className={cn(loading && rows.length > 0 && "opacity-60")} aria-busy={loading}>
        {loading && rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={COLS} className="py-10 text-center text-muted-foreground">
              <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-label="Loading assets" />
            </TableCell>
          </TableRow>
        ) : rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={COLS} className="p-0">
              {empty ?? <p className="py-10 text-center text-sm text-muted-foreground">No assets.</p>}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((a) => {
            const href = hrefFor(a.id);
            const cat = a.sub_category ? `${a.category.name} › ${a.sub_category.name}` : a.category.name;
            const user = userLabel(a.assigned_user);
            return (
              <TableRow key={a.id} className="cursor-pointer" onClick={(e) => openFromRow(e, () => router.push(href))}>
                <TableCell className="sticky left-0 z-10 whitespace-nowrap bg-card font-mono text-xs font-medium shadow-[inset_-1px_0_0_hsl(var(--border))]">
                  <Link href={href} className="text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    {a.asset_tag}
                  </Link>
                </TableCell>
                <TableCell>
                  <span className="block max-w-[18rem] truncate font-medium" title={a.name}>
                    {a.name}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="block max-w-[14rem] truncate text-muted-foreground" title={cat}>
                    {cat}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <AssetStatusBadge name={a.status.name} color={a.status.color} stateType={a.status.state_type} />
                </TableCell>
                <TableCell>
                  <span className="block max-w-[12rem] truncate" title={user ? `${user}${a.assigned_user?.email ? ` · ${a.assigned_user.email}` : ""}` : undefined}>
                    {user || <span className="text-muted-foreground">—</span>}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="block max-w-[10rem] truncate" title={a.department?.name}>
                    {a.department?.name ?? <span className="text-muted-foreground">—</span>}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="block max-w-[10rem] truncate" title={a.location?.name}>
                    {a.location?.name ?? <span className="text-muted-foreground">—</span>}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <WarrantyCell iso={a.warranty_expiry_date} />
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{fmtDate(a.purchase_date)}</TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
