"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { kbApi } from "@/lib/itsm/api";
import type { Article } from "@/lib/itsm/types";

function when(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

export default function ArticlePage() {
  const { org, articleId } = useParams<{ org: string; articleId: string }>();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    kbApi
      .get(articleId)
      .then(setArticle)
      .catch(() => setArticle(null))
      .finally(() => setLoading(false));
  }, [articleId]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!article) return <p className="text-sm text-muted-foreground">Article not found.</p>;

  return (
    <article className="mx-auto max-w-3xl space-y-4">
      <Link
        href={`/t/${org}/portal/kb`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Knowledge Base
      </Link>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{article.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {article.category_name ? `${article.category_name} · ` : ""}
          Updated {when(article.published_at || article.updated_at)} · {article.view_count} views
        </p>
      </header>
      <div
        className="prose prose-sm max-w-none rounded-lg border bg-card p-5 dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: article.body_html }}
      />
    </article>
  );
}
