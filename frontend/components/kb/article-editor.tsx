"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { kbApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { slugify, withSlugSuffix } from "@/lib/itsm/slug";
import type { Article, ArticleInput, KBCategory } from "@/lib/itsm/types";

const NONE = "__none__";
const inputCls =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Create / edit a KB article. `helpdeskId` is the route's workspace (null = org-wide).
 *  Reuses the shared `RichTextEditor` (no inline images — there is no KB media endpoint
 *  yet). Slug is auto-derived from the title (until edited) and retried with a suffix on
 *  a uniqueness collision. Delete is supervisor-only (`canDelete`). */
export function ArticleEditor({
  articleId,
  helpdeskId,
  backHref,
  canDelete,
}: {
  articleId?: string;
  helpdeskId: string | null;
  backHref: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const editing = Boolean(articleId);

  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState<"draft" | "publish" | "unpublish" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState<string>(NONE);
  const [visibility, setVisibility] = useState<"portal" | "internal">("portal");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState("draft");
  const [categories, setCategories] = useState<KBCategory[]>([]);

  // Categories selectable here: this workspace's + org-wide (helpdesk null).
  useEffect(() => {
    kbApi
      .listCategories()
      .then((all) =>
        setCategories(all.filter((c) => c.helpdesk == null || c.helpdesk === helpdeskId)),
      )
      .catch(() => setCategories([]));
  }, [helpdeskId]);

  // Load the article when editing.
  useEffect(() => {
    if (!articleId) return;
    let cancelled = false;
    setLoading(true);
    kbApi
      .getArticle(articleId)
      .then((a: Article) => {
        if (cancelled) return;
        setTitle(a.title);
        setSlug(a.slug);
        setSlugDirty(true);
        setSummary(a.summary ?? "");
        setBody(a.body_html ?? "");
        setCategoryId(a.category ?? NONE);
        setVisibility(a.visibility === "internal" ? "internal" : "portal");
        setTags((a.tags ?? []).join(", "));
        setStatus(a.status);
      })
      .catch(() => !cancelled && toast.error("Could not load this article."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  const onTitle = useCallback(
    (v: string) => {
      setTitle(v);
      if (!slugDirty) setSlug(slugify(v));
    },
    [slugDirty],
  );

  const payload = useMemo<ArticleInput>(
    () => ({
      title: title.trim(),
      slug: (slug || slugify(title)).trim(),
      summary: summary.trim(),
      body_html: body,
      category: categoryId === NONE ? null : categoryId,
      helpdesk: helpdeskId,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      visibility,
    }),
    [title, slug, summary, body, categoryId, helpdeskId, tags, visibility],
  );

  /** Persist (create or update), retrying once with a suffixed slug on collision. */
  async function persist(): Promise<Article | null> {
    const attempt = async (p: ArticleInput) =>
      articleId ? kbApi.updateArticle(articleId, p) : kbApi.createArticle(p);
    try {
      return await attempt(payload);
    } catch (err) {
      if (err instanceof ItsmApiError && err.fieldErrors?.slug) {
        try {
          return await attempt({ ...payload, slug: withSlugSuffix(payload.slug) });
        } catch (err2) {
          toast.error(err2 instanceof ItsmApiError ? err2.message : "Could not save the article.");
          return null;
        }
      }
      toast.error(err instanceof ItsmApiError ? err.message : "Could not save the article.");
      return null;
    }
  }

  async function onSaveDraft() {
    if (!title.trim()) return toast.error("A title is required.");
    setBusy("draft");
    const saved = await persist();
    setBusy(null);
    if (saved) {
      toast.success("Saved.");
      router.push(backHref);
    }
  }

  async function onPublish() {
    if (!title.trim()) return toast.error("A title is required.");
    setBusy("publish");
    const saved = await persist();
    if (saved) {
      try {
        await kbApi.publish(saved.id);
        toast.success("Published.");
        router.push(backHref);
      } catch {
        toast.error("Saved, but publishing failed.");
      }
    }
    setBusy(null);
  }

  async function onUnpublish() {
    if (!articleId) return;
    setBusy("unpublish");
    try {
      await kbApi.unpublish(articleId);
      setStatus("draft");
      toast.success("Moved to draft.");
    } catch {
      toast.error("Could not unpublish.");
    }
    setBusy(null);
  }

  async function onDelete() {
    if (!articleId) return;
    setBusy("delete");
    try {
      await kbApi.deleteArticle(articleId);
      toast.success("Article deleted.");
      router.push(backHref);
    } catch {
      toast.error("Could not delete the article.");
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="kb-title">Title</Label>
          <Input id="kb-title" value={title} onChange={(e) => onTitle(e.target.value)} placeholder="How to reset your password" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kb-slug">Slug</Label>
          <Input
            id="kb-slug"
            value={slug}
            onChange={(e) => {
              setSlug(slugify(e.target.value));
              setSlugDirty(true);
            }}
            placeholder="how-to-reset-your-password"
          />
          <p className="text-xs text-muted-foreground">Used in the article URL — must be unique.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kb-summary">Summary</Label>
          <textarea
            id="kb-summary"
            value={summary}
            maxLength={500}
            rows={2}
            onChange={(e) => setSummary(e.target.value)}
            className={inputCls}
            placeholder="One-line summary shown in search results."
          />
        </div>
        <div className="space-y-1.5">
          <Label>Body</Label>
          <RichTextEditor value={body} onChange={setBody} ariaLabel="Article body" minHeight={320} />
        </div>
      </div>

      <aside className="space-y-4">
        <fieldset className="space-y-4 rounded-lg border p-4">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.helpdesk == null ? " (org-wide)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as "portal" | "internal")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="portal">Portal (end users + agents)</SelectItem>
                <SelectItem value="internal">Internal (agents only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-tags">Tags</Label>
            <Input id="kb-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vpn, access, comma-separated" />
          </div>
          <p className="text-xs text-muted-foreground">
            Status: <span className="font-medium capitalize text-foreground">{status}</span>
          </p>
        </fieldset>

        <div className="flex flex-col gap-2">
          <Button onClick={onPublish} disabled={!!busy}>
            {busy === "publish" ? <Loader2 className="animate-spin" /> : null}
            {status === "published" ? "Save & keep published" : "Publish"}
          </Button>
          <Button variant="outline" onClick={onSaveDraft} disabled={!!busy}>
            {busy === "draft" ? <Loader2 className="animate-spin" /> : null}
            Save draft
          </Button>
          {editing && status === "published" ? (
            <Button variant="ghost" onClick={onUnpublish} disabled={!!busy}>
              {busy === "unpublish" ? <Loader2 className="animate-spin" /> : null}
              Unpublish
            </Button>
          ) : null}
          {editing && canDelete ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={!!busy}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : null}
        </div>
      </aside>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this article?</DialogTitle>
            <DialogDescription>
              This removes it from the Knowledge Base and the portal. This cannot be undone here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy === "delete"}>
              Cancel
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onDelete}
              disabled={busy === "delete"}
            >
              {busy === "delete" ? <Loader2 className="animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
