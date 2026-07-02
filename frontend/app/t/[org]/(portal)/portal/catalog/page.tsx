"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PackageOpen, Search, ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { catalogApi } from "@/lib/itsm/api";
import type { CatalogItem } from "@/lib/itsm/types";

export default function CatalogPage() {
  const { org = "" } = useParams<{ org: string }>();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    catalogApi
      .browse()
      .then((r) => !cancelled && setItems(r))
      .catch(() => !cancelled && setItems([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const filtered = items.filter(
      (i) =>
        !q ||
        i.name.toLowerCase().includes(q.toLowerCase()) ||
        i.short_description.toLowerCase().includes(q.toLowerCase()),
    );
    const by: Record<string, CatalogItem[]> = {};
    for (const i of filtered) (by[i.category_name] ??= []).push(i);
    return by;
  }, [items, q]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Request Catalog"
        description="Browse standard services and submit a request in a few clicks."
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the catalog…"
          aria-label="Search the catalog"
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[112px] w-full rounded-xl" />
          ))}
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title={q ? "No matching services" : "No services yet"}
          description={
            q ? "Try a different search term." : "There are no catalog services available right now."
          }
        />
      ) : (
        Object.entries(grouped).map(([category, list]) => (
          <section key={category} aria-label={category} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {category}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((i) => (
                <li key={i.id}>
                  <Link
                    href={`/t/${org}/portal/catalog/${i.id}`}
                    className="flex h-full flex-col rounded-xl border bg-card p-4 text-card-foreground shadow-soft transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="font-medium">{i.name}</span>
                    <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {i.short_description}
                    </span>
                    {i.requires_approval ? (
                      <span className="mt-3 inline-flex w-fit items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-xs text-warning">
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Needs approval
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
