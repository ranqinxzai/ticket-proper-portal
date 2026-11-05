"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { kbApi } from "@/lib/itsm/api";
import type { ArticleListItem } from "@/lib/itsm/types";

const statusVariant = (s: string): "default" | "secondary" | "outline" =>
  s === "published" ? "default" : s === "archived" ? "outline" : "secondary";

/** Hover help for the Status / Visibility badges. Grounded in itsm_knowledge/views.py
 *  (`KBBrowseViewSet` serves only published + portal articles to the Service Portal). */
const STATUS_HELP: Record<string, string> = {
  draft: "Draft — not shown in the Service Portal",
  published: "Published — shown in the Service Portal when Visibility is Portal",
  archived:
    "Archived — hidden from the Service Portal and from this list unless you filter by Archived. Open it to restore it to draft.",
};
const VISIBILITY_HELP: Record<string, string> = {
  portal: "Portal = requestors and agents (once published)",
  internal: "Internal = agents only — never shown in the Service Portal",
};
const SEARCH_HELP =
  "Searches title, summary, body and tags. Forgiving of typos and word endings (\"pasword\", \"printers\"); best matches first. Archived articles are only searched when the Archived filter is on.";
const STATUS_FILTER_HELP =
  "\"Active\" = drafts and published articles. Archived articles are hidden unless you pick Archived.";
const VIEWS_HELP =
  "How many times the article was opened in the Service Portal knowledge base (only published Portal articles can be). Every open counts (not unique people); opening it here to edit doesn't count.";

/** Article list for one workspace (or org-wide when `helpdeskId` is null), with
 *  status/visibility filters + search. Rows link to the editor; create → `articlesNewHref`. */
export function ArticleList({
  helpdeskId,
  articlesNewHref,
  articleEditHref,
}: {
  helpdeskId: string | null;
  articlesNewHref: string;
  articleEditHref: (id: string) => string;
}) {
  const [rows, setRows] = useState<ArticleListItem[] | null>(null);
  const [status, setStatus] = useState("active");
  const [visibility, setVisibility] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setRows(null);
    // Org-wide (`helpdeskId == null`) is filtered server-side; "active" sends no
    // status, which the server reads as "everything except archived".
    const params: {
      helpdesk?: string;
      helpdesk__isnull?: "true";
      status?: string;
      visibility?: string;
      search?: string;
    } = helpdeskId ? { helpdesk: helpdeskId } : { helpdesk__isnull: "true" };
    if (status !== "active") params.status = status;
    if (visibility !== "all") params.visibility = visibility;
    if (search.trim()) params.search = search.trim();
    kbApi
      .listArticles(params)
      .then(setRows)
      .catch(() => {
        setRows([]);
        toast.error("Could not load articles.");
      });
  }, [helpdeskId, status, visibility, search]);

  useEffect(() => {
    const h = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(h);
  }, [load, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Hint label={SEARCH_HELP} side="bottom">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search articles…"
            className="w-[240px]"
            aria-label="Search articles"
          />
        </Hint>
        <Select value={status} onValueChange={setStatus}>
          <Hint label={STATUS_FILTER_HELP} side="bottom">
            <SelectTrigger className="w-[150px]" aria-label="Filter status"><SelectValue /></SelectTrigger>
          </Hint>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={visibility} onValueChange={setVisibility}>
          <SelectTrigger className="w-[150px]" aria-label="Filter visibility"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All visibility</SelectItem>
            <SelectItem value="portal">Portal</SelectItem>
            <SelectItem value="internal">Internal</SelectItem>
          </SelectContent>
        </Select>
        <Button asChild className="ml-auto">
          <Link href={articlesNewHref}>
            <Plus className="h-4 w-4" /> New article
          </Link>
        </Button>
      </div>

      <div className="rounded-xl border bg-card text-card-foreground shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="w-[160px]">Category</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[120px]">Visibility</TableHead>
              <TableHead className="w-[90px] text-right">
                <span className="inline-flex flex-row-reverse items-center gap-1">
                  Views
                  <InfoTip label="What counts as a view?">{VIEWS_HELP}</InfoTip>
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows === null ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  {search.trim() || status !== "active" || visibility !== "all"
                    ? "No matching articles."
                    : "No articles yet. Create the first one."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((a) => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => undefined}>
                  <TableCell className="font-medium">
                    <Link
                      href={articleEditHref(a.id)}
                      className="block max-w-[36rem] truncate hover:underline"
                      title={a.title}
                    >
                      {a.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="block max-w-[150px] truncate" title={a.category_name || undefined}>
                      {a.category_name || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Hint label={STATUS_HELP[a.status]} wrap>
                      <Badge variant={statusVariant(a.status)} className="capitalize">
                        {a.status}
                      </Badge>
                    </Hint>
                  </TableCell>
                  <TableCell>
                    <Hint label={VISIBILITY_HELP[a.visibility]} wrap>
                      <Badge variant={a.visibility === "internal" ? "outline" : "secondary"} className="capitalize">
                        {a.visibility}
                      </Badge>
                    </Hint>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{a.view_count}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
