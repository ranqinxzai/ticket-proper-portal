"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ArticleEditor } from "@/components/kb/article-editor";
import { useItsmAuth } from "@/lib/itsm/auth";
import { useCanDeleteKb } from "@/lib/itsm/kb-perms";
import { KB_ORG_KEY } from "@/lib/itsm/nav";

export default function EditArticlePage() {
  const { org = "", helpdeskKey = "", articleId = "" } = useParams<{
    org: string;
    helpdeskKey: string;
    articleId: string;
  }>();
  const { user } = useItsmAuth();
  const canDelete = useCanDeleteKb();

  const helpdeskId =
    helpdeskKey === KB_ORG_KEY ? null : ((user?.helpdesks ?? []).find((h) => h.key === helpdeskKey)?.id ?? null);
  const backHref = `/t/${org}/agent/kb/${helpdeskKey}`;

  return (
    <div className="space-y-6">
      <div>
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to articles
        </Link>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Edit article</h1>
      <ArticleEditor articleId={articleId} helpdeskId={helpdeskId} backHref={backHref} canDelete={canDelete} />
    </div>
  );
}
