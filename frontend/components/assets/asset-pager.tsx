"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { pageList } from "@/lib/pagination";
import { selectCls } from "@/components/tickets/field-styles";
import { cn } from "@/lib/utils";

import { PAGE_SIZES } from "./asset-utils";

/** "Showing 1–25 of 120" (or "No assets"). */
export function rangeLabel(page: number, pageSize: number, count: number, noun = "asset"): string {
  if (count === 0) return `No ${noun}s`;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, count);
  return `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${count.toLocaleString()} ${count === 1 ? noun : `${noun}s`}`;
}

/** Bottom pager: range text, rows-per-page and page buttons (the Users-list pattern). */
export function AssetPager({
  page,
  pageSize,
  count,
  loading,
  noun = "asset",
  onPage,
  onPageSize,
  className,
}: {
  page: number;
  pageSize: number;
  count: number;
  loading?: boolean;
  noun?: string;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  className?: string;
}) {
  if (count === 0) return null;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground", className)}>
      <p aria-live="polite">{rangeLabel(page, pageSize, count, noun)}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            className={cn(selectCls, "h-8 w-auto")}
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {totalPages > 1 ? (
          <nav className="flex flex-wrap items-center gap-1" aria-label="Pagination">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPage(Math.max(1, page - 1))}
              disabled={page <= 1 || loading}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Prev
            </Button>
            {pageList(page, totalPages).map((item, i) =>
              item === "ellipsis" ? (
                <span key={`e${i}`} className="px-2" aria-hidden="true">
                  …
                </span>
              ) : (
                <Button
                  key={item}
                  variant={item === page ? "default" : "outline"}
                  size="sm"
                  className="min-w-9"
                  onClick={() => onPage(item)}
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
              onClick={() => onPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages || loading}
              aria-label="Next page"
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
