"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { KBCategory, KBCategoryInput } from "@/lib/itsm/types";

const NONE = "__none__";

type Draft = {
  id?: string;
  name: string;
  slug: string;
  slugDirty: boolean;
  description: string;
  parent: string;
  sort_order: number;
};

const emptyDraft = (): Draft => ({
  name: "",
  slug: "",
  slugDirty: false,
  description: "",
  parent: NONE,
  sort_order: 0,
});

/** First server validation message (e.g. the one-level nesting rule on `parent`). */
function apiMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ItsmApiError)) return fallback;
  const first = err.fieldErrors ? Object.values(err.fieldErrors)[0]?.[0] : undefined;
  return first || err.message || fallback;
}

/** Category CRUD for one workspace (or org-wide when `helpdeskId` is null), with a
 *  one-level parent hierarchy (enforced server-side: a sub-category can't have
 *  children and a category with sub-categories can't be moved under another).
 *  Delete is supervisor-only (`canDelete`). */
export function CategoryManager({
  helpdeskId,
  canDelete,
}: {
  helpdeskId: string | null;
  canDelete: boolean;
}) {
  const [cats, setCats] = useState<KBCategory[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<KBCategory | null>(null);

  const load = useCallback(() => {
    setCats(null);
    kbApi
      .listCategories(helpdeskId ? { helpdesk: helpdeskId } : { helpdesk__isnull: "true" })
      .then(setCats)
      .catch(() => {
        setCats([]);
        toast.error("Could not load categories.");
      });
  }, [helpdeskId]);

  useEffect(() => load(), [load]);

  // Depth-first tree for an indented render. Every category is shown exactly once, at
  // any depth (legacy data could nest deeper than one level; it used to be hidden).
  const ordered = useMemo(() => {
    if (!cats) return [];
    const ids = new Set(cats.map((c) => c.id));
    const out: { cat: KBCategory; depth: number }[] = [];
    const seen = new Set<string>();
    const walk = (c: KBCategory, depth: number) => {
      if (seen.has(c.id)) return;
      seen.add(c.id);
      out.push({ cat: c, depth });
      for (const child of cats.filter((x) => x.parent === c.id)) walk(child, depth + 1);
    };
    // Roots = no parent, or a parent outside this scope.
    for (const c of cats) if (!c.parent || !ids.has(c.parent)) walk(c, 0);
    for (const c of cats) walk(c, 0); // parent cycles, if any
    return out;
  }, [cats]);
  const hasChildren = (id?: string) => !!id && (cats ?? []).some((c) => c.parent === id);

  async function save() {
    if (!draft || !draft.name.trim()) return toast.error("A name is required.");
    setBusy(true);
    const body: KBCategoryInput = {
      name: draft.name.trim(),
      slug: (draft.slug || slugify(draft.name)).trim(),
      description: draft.description.trim(),
      parent: draft.parent === NONE ? null : draft.parent,
      helpdesk: helpdeskId,
      sort_order: draft.sort_order || 0,
    };
    const attempt = (b: KBCategoryInput) =>
      draft.id ? kbApi.updateCategory(draft.id, b) : kbApi.createCategory(b);
    try {
      await attempt(body);
    } catch (err) {
      if (err instanceof ItsmApiError && err.fieldErrors?.slug) {
        try {
          await attempt({ ...body, slug: withSlugSuffix(body.slug) });
        } catch (err2) {
          setBusy(false);
          return toast.error(apiMessage(err2, "Could not save the category."));
        }
      } else {
        setBusy(false);
        return toast.error(apiMessage(err, "Could not save the category."));
      }
    }
    setBusy(false);
    setDraft(null);
    toast.success("Saved.");
    load();
  }

  async function remove() {
    if (!toDelete) return;
    setBusy(true);
    try {
      await kbApi.deleteCategory(toDelete.id);
      toast.success("Category deleted.");
      setToDelete(null);
      load();
    } catch {
      toast.error("Could not delete the category.");
    }
    setBusy(false);
  }

  // Parent options: same-scope top-level categories (excluding the one being edited).
  const parentOptions = (cats ?? []).filter((c) => c.id !== draft?.id && !c.parent);
  // A category with sub-categories must stay top-level (the server rejects it too).
  const parentLocked = hasChildren(draft?.id) && draft?.parent === NONE;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Organise articles into categories (one level of nesting).</p>
        <Button onClick={() => setDraft(emptyDraft())}>
          <Plus className="h-4 w-4" /> New category
        </Button>
      </div>

      <div className="rounded-xl border bg-card text-card-foreground shadow-soft">
        {cats === null ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </p>
        ) : ordered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No categories yet.</p>
        ) : (
          <ul className="divide-y">
            {ordered.map(({ cat, depth }) => (
              <li key={cat.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1" style={{ paddingLeft: depth * 20 }}>
                  <span className="font-medium">{cat.name}</span>
                  {cat.description ? (
                    <span className="ml-2 text-sm text-muted-foreground">{cat.description}</span>
                  ) : null}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setDraft({
                      id: cat.id,
                      name: cat.name,
                      slug: cat.slug,
                      slugDirty: true,
                      description: cat.description ?? "",
                      parent: cat.parent ?? NONE,
                      sort_order: cat.sort_order ?? 0,
                    })
                  }
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
                </Button>
                {canDelete ? (
                  <IconButton
                    label={`Delete ${cat.name}`}
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setToDelete(cat)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit category" : "New category"}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="cat-name">Name</Label>
                <Input
                  id="cat-name"
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, name: e.target.value, slug: d.slugDirty ? d.slug : slugify(e.target.value) } : d,
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cat-slug" className="flex items-center gap-1.5">
                  Slug
                  <InfoTip label="What is the slug?">
                    A unique short name (lowercase letters, numbers and hyphens), filled in from the name. If it&apos;s
                    already taken, a short random suffix is added when you save.
                  </InfoTip>
                </Label>
                <Input
                  id="cat-slug"
                  value={draft.slug}
                  onChange={(e) => setDraft((d) => (d ? { ...d, slug: slugify(e.target.value), slugDirty: true } : d))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cat-desc">Description</Label>
                <Input
                  id="cat-desc"
                  value={draft.description}
                  onChange={(e) => setDraft((d) => (d ? { ...d, description: e.target.value } : d))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  Parent
                  <InfoTip label="About parent categories">
                    One level of nesting: pick a top-level category to make this a sub-category of it. Sub-categories
                    can&apos;t have their own sub-categories, so only top-level ones are listed, and a category that
                    already has sub-categories must stay top-level.
                  </InfoTip>
                </Label>
                <Select
                  value={draft.parent}
                  onValueChange={(v) => setDraft((d) => (d ? { ...d, parent: v } : d))}
                  disabled={parentLocked}
                >
                  <Hint
                    label={
                      parentLocked
                        ? `“${draft.name || "This category"}” has sub-categories, so it must stay top-level. Move or delete its sub-categories first.`
                        : undefined
                    }
                  >
                    <SelectTrigger aria-label="Parent category" disabled={parentLocked}>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                  </Hint>
                  <SelectContent>
                    <SelectItem value={NONE}>— None (top level) —</SelectItem>
                    {parentOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{toDelete?.name}&rdquo;?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Articles in this category are kept but become uncategorised, and its sub-categories move to the top
            level. This can&apos;t be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setToDelete(null)} disabled={busy}>Cancel</Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={remove}
              disabled={busy}
            >
              {busy ? <Loader2 className="animate-spin" /> : null} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
