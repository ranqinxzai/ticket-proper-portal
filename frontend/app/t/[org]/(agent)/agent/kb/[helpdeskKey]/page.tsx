"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";

import { ArticleList } from "@/components/kb/article-list";
import { CategoryManager } from "@/components/kb/category-manager";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useItsmAuth } from "@/lib/itsm/auth";
import { useCanDeleteKb } from "@/lib/itsm/kb-perms";
import { agentKb, KB_ORG_KEY } from "@/lib/itsm/nav";

/** Article list + category manager for one workspace (or org-wide via the `_org`
 *  sentinel). `helpdeskKey` resolves to a helpdesk id from the user's memberships. */
export default function KbWorkspacePage() {
  const { org = "", helpdeskKey = "" } = useParams<{ org: string; helpdeskKey: string }>();
  const { user } = useItsmAuth();
  const canDelete = useCanDeleteKb();

  const isOrg = helpdeskKey === KB_ORG_KEY;
  const helpdesk = (user?.helpdesks ?? []).find((h) => h.key === helpdeskKey);
  const helpdeskId = isOrg ? null : (helpdesk?.id ?? null);
  const title = isOrg ? "Organisation-wide" : (helpdesk?.name ?? helpdeskKey);

  const base = `/t/${org}/agent/kb/${helpdeskKey}`;
  const newHref = `${base}/articles/new`;
  const editHref = (id: string) => `${base}/articles/${id}/edit`;

  if (!isOrg && !helpdesk) {
    return (
      <div className="space-y-4">
        <Link href={agentKb(org)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All workspaces
        </Link>
        <EmptyState
          icon={Lock}
          title="No access to this workspace"
          description="You don't have access to this workspace's knowledge base."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={agentKb(org)} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All workspaces
        </Link>
      </div>

      <PageHeader title={`${title} — Knowledge Base`} description="Manage articles and categories." />

      <Tabs defaultValue="articles">
        <TabsList>
          <TabsTrigger value="articles">Articles</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="articles" className="mt-4">
          <ArticleList helpdeskId={helpdeskId} articlesNewHref={newHref} articleEditHref={editHref} />
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <CategoryManager helpdeskId={helpdeskId} canDelete={canDelete} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
