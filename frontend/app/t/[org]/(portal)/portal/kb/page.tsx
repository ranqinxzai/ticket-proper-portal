"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BookOpen, Search } from "lucide-react";

import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { kbApi } from "@/lib/itsm/api";
import type { ArticleListItem } from "@/lib/itsm/types";

export default function KnowledgeBasePage() {
  const { org = "" } = useParams<{ org: string }>();
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const h = setTimeout(() => {
      kbApi
        .browse({ search: q || undefined })
        .then((r) => !cancelled && setArticles(r))
        .catch(() => !cancelled && setArticles([]))
        .finally(() => !cancelled && setLoading(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [q]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge Base"
        description="Find answers and how-to guides before raising a request."
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search articles…"
          aria-label="Search articles"
          className="pl-9"
        />
      </div>

      {loading ? (
        <ul className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-[84px] w-full rounded-xl" />
            </li>
          ))}
        </ul>
      ) : articles.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={q ? "No matching articles" : "No articles yet"}
          description={
            q ? "Try a different search term." : "There are no published articles to browse yet."
          }
        />
      ) : (
        <ul className="space-y-3">
          {articles.map((a) => (
            <li key={a.id}>
              <Link
                href={`/t/${org}/portal/kb/${a.id}`}
                className="flex gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-soft transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <span className="block font-medium">{a.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{a.summary}</span>
                  {a.category_name ? (
                    <span className="mt-1 block text-xs text-muted-foreground">{a.category_name}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
