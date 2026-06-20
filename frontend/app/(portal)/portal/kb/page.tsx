"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { kbApi } from "@/lib/itsm/api";
import type { ArticleListItem } from "@/lib/itsm/types";

export default function KnowledgeBasePage() {
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Find answers and how-to guides before raising a request.
        </p>
      </div>

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
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : articles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No articles found.</p>
      ) : (
        <ul className="space-y-3">
          {articles.map((a) => (
            <li key={a.id}>
              <Link
                href={`/portal/kb/${a.id}`}
                className="flex gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
