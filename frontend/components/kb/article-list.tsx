"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const [status, setStatus] = useState("all");
  const [visibility, setVisibility] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setRows(null);
    const params: { helpdesk?: string; status?: string; visibility?: string; search?: string } = {};
    if (helpdeskId) params.helpdesk = helpdeskId;
    if (status !== "all") params.status = status;
    if (visibility !== "all") params.visibility = visibility;
    if (search.trim()) params.search = search.trim();
    kbApi
      .listArticles(params)
      .then((all) => setRows(helpdeskId ? all : all.filter((a) => a.helpdesk == null)))
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
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or body…"
          className="w-[240px]"
          aria-label="Search articles"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[150px]" aria-label="Filter status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
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

      <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="w-[160px]">Category</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[120px]">Visibility</TableHead>
              <TableHead className="w-[90px] text-right">Views</TableHead>
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
                  No articles yet. Create the first one.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((a) => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => undefined}>
                  <TableCell className="font-medium">
                    <Link href={articleEditHref(a.id)} className="hover:underline">
                      {a.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.category_name || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(a.status)} className="capitalize">
                      {a.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.visibility === "internal" ? "outline" : "secondary"} className="capitalize">
                      {a.visibility}
                    </Badge>
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
