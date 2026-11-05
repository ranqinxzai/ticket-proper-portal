"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
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

type Busy = "draft" | "publish" | "unpublish" | "archive" | "restore" | "delete";

/** Create / edit a KB article. `helpdeskId` is the route's workspace (null = org-wide).
 *  Reuses the shared `RichTextEditor` (no inline images — there is no KB media endpoint
 *  yet). Slug is auto-derived from the title (until edited) and retried with a suffix on
 *  a uniqueness collision. Delete is supervisor-only (`canDelete`).
 *
 *  Every button saves the form first; the status only changes through the server's
 *  lifecycle actions (`status` is read-only on PATCH):
 *  - draft / new: Publish · Save draft · Archive
 *  - published:   Save & keep published · Unpublish & save as draft · Archive
 *  - archived:    Restore to draft · Save (stays archived) */
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
  const [busy, setBusy] = useState<Busy | null>(null);
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

  /** Save the form, then (optionally) run a lifecycle action, then go back to the list. */
  async function saveThen(
    kind: Busy,
    action: ((id: string) => Promise<Article>) | null,
    done: string,
    failedAfterSave: string,
  ) {
    if (!title.trim()) return toast.error("A title is required.");
    setBusy(kind);
    const saved = await persist();
    if (!saved) return setBusy(null);
    if (action) {
      try {
        await action(saved.id);
      } catch (err) {
        setBusy(null);
        return toast.error(err instanceof ItsmApiError ? `${failedAfterSave} ${err.message}` : failedAfterSave);
      }
    }
    toast.success(done);
    router.push(backHref);
  }

  const onSave = () =>
    saveThen(
      "draft",
      null,
      status === "published" ? "Saved — the article stays published." : "Saved.",
      "",
    );
  const onPublish = () =>
    saveThen(
      "publish",
      status === "published" ? null : kbApi.publish,
      status === "published" ? "Saved — the article stays published." : "Published.",
      "Saved, but publishing failed.",
    );
  const onUnpublish = () =>
    saveThen(
      "unpublish",
      kbApi.unpublish,
      "Saved as draft — hidden from the Service Portal.",
      "Saved, but unpublishing failed — the article is still live.",
    );
  const onArchive = () =>
    saveThen(
      "archive",
      kbApi.archive,
      "Archived. Filter the list by Archived to find it again.",
      "Saved, but archiving failed.",
    );
  const onRestore = () =>
    saveThen("restore", kbApi.restore, "Restored to draft.", "Saved, but restoring failed.");

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
        {status === "archived" ? (
          <p className="rounded-md border border-dashed bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            This article is archived: it&apos;s hidden from the Service Portal and from the default article list.
            Use <span className="font-medium text-foreground">Restore to draft</span> to bring it back.
          </p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="kb-title">Title</Label>
          <Input id="kb-title" spellCheck value={title} onChange={(e) => onTitle(e.target.value)} placeholder="How to reset your password" />
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
          <p className="text-xs text-muted-foreground">
            A unique short name, filled in from the title. If it&apos;s taken, a short random suffix is added on save.
          </p>
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
            <Label className="flex items-center gap-1.5">
              Category
              <InfoTip label="About categories">
                Lists this workspace&apos;s categories plus the org-wide ones (marked &ldquo;(org-wide)&rdquo;), which are
                shared across every workspace.
              </InfoTip>
            </Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger aria-label="Category"><SelectValue placeholder="None" /></SelectTrigger>
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
            <Label className="flex items-center gap-1.5">
              Visibility
              <InfoTip label="About visibility">
                Portal = requestors (in the Service Portal) and agents; Internal = agents only. The portal only shows
                published articles.
              </InfoTip>
            </Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as "portal" | "internal")}>
              <SelectTrigger aria-label="Visibility"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="portal">Portal (end users + agents)</SelectItem>
                <SelectItem value="internal">Internal (agents only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-tags" className="flex items-center gap-1.5">
              Tags
              <InfoTip label="What are tags for?">
                Comma-separated keywords. The Service Portal&apos;s knowledge-base search also matches them.
              </InfoTip>
            </Label>
            <Input id="kb-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vpn, access, comma-separated" />
          </div>
          <p className="text-xs text-muted-foreground">
            Status: <span className="font-medium capitalize text-foreground">{status}</span>
          </p>
        </fieldset>

        <div className="flex flex-col gap-2">
          {status === "archived" ? (
            <>
              <Hint
                side="left"
                className="w-full [&>button]:flex-1"
                label={
                  busy
                    ? "Saving…"
                    : "Saves your changes and moves the article back to draft. Publish it again to show it in the Service Portal."
                }
              >
                <Button onClick={onRestore} disabled={!!busy}>
                  {busy === "restore" ? <Loader2 className="animate-spin" /> : <ArchiveRestore className="h-4 w-4" aria-hidden="true" />}
                  Restore to draft
                </Button>
              </Hint>
              <Hint
                side="left"
                className="w-full [&>button]:flex-1"
                label={busy ? "Saving…" : "Saves your changes. The article stays archived and hidden."}
              >
                <Button variant="outline" onClick={onSave} disabled={!!busy}>
                  {busy === "draft" ? <Loader2 className="animate-spin" /> : null}
                  Save (stays archived)
                </Button>
              </Hint>
            </>
          ) : (
            <>
              <Hint
                side="left"
                className="w-full [&>button]:flex-1"
                label={
                  busy
                    ? "Saving…"
                    : status === "published"
                      ? "Saves your changes. The article stays published, so they're live right away."
                      : "Saves and publishes. Portal articles then appear in the Service Portal."
                }
              >
                <Button onClick={onPublish} disabled={!!busy}>
                  {busy === "publish" ? <Loader2 className="animate-spin" /> : null}
                  {status === "published" ? "Save & keep published" : "Publish"}
                </Button>
              </Hint>
              <Hint
                side="left"
                className="w-full [&>button]:flex-1"
                label={
                  busy
                    ? "Saving…"
                    : status === "published"
                      ? "Saves your changes and moves the article back to draft: hidden from the Service Portal until you publish again."
                      : "Saves without publishing. Drafts are never shown in the Service Portal."
                }
              >
                <Button variant="outline" onClick={status === "published" ? onUnpublish : onSave} disabled={!!busy}>
                  {busy === "draft" || busy === "unpublish" ? <Loader2 className="animate-spin" /> : null}
                  {status === "published" ? "Unpublish & save as draft" : "Save draft"}
                </Button>
              </Hint>
              {editing ? (
                <Hint
                  side="left"
                  className="w-full [&>button]:flex-1"
                  label={
                    busy
                      ? "Saving…"
                      : "Saves your changes and archives the article: hidden from the Service Portal and from the default article list (filter by Archived to find it). You can restore it any time."
                  }
                >
                  <Button variant="ghost" onClick={onArchive} disabled={!!busy}>
                    {busy === "archive" ? <Loader2 className="animate-spin" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
                    Archive
                  </Button>
                </Hint>
              ) : null}
            </>
          )}
          {editing && canDelete ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={!!busy}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
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
