"use client";

/**
 * Configuration → Asset Configuration → Categories & Fields.
 * Left: the 2-level category tree. Right: the selected node — its own field links
 * (Required switch, reorder, unlink) and, for a sub-category, the fields it inherits.
 * A second tab lists the helpdesk's field library. All sub-components are module-level.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  ChevronRight,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";

import { FieldRow } from "@/components/settings/field-row";
import { EmptyState } from "@/components/shell/empty-state";
import { inputCls, textareaCls } from "@/components/tickets/field-styles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { IconButton } from "@/components/ui/icon-button";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { assetCategoriesApi, assetCategoryFieldsApi, assetFieldsApi } from "@/lib/itsm/assets-api";
import {
  ASSET_FIELD_TYPES,
  type AssetCategory,
  type AssetCategoryFieldLink,
  type AssetField,
} from "@/lib/itsm/assets-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { ASSET_HELP, ASSET_LINK_HELP } from "@/lib/itsm/help/assets";
import { cn } from "@/lib/utils";

import { AssetFieldDialog, type FieldDialogMode } from "./asset-field-dialog";
import { apiMessage, fieldErr } from "./asset-utils";
import { ConfirmDialog } from "./confirm-dialog";

export type ConfigPerms = { create: boolean; update: boolean; delete: boolean };

const TYPE_LABEL: Record<string, string> = Object.fromEntries(ASSET_FIELD_TYPES.map((t) => [t.value, t.label]));
const NO_PERM = "You don't have permission to change Asset Configuration.";

const byOrder = (a: { sort_order: number; name: string }, b: { sort_order: number; name: string }) =>
  a.sort_order - b.sort_order || a.name.localeCompare(b.name);
const linkOrder = (a: AssetCategoryFieldLink, b: AssetCategoryFieldLink) =>
  a.sort_order - b.sort_order || a.field_name.localeCompare(b.field_name);

// ── Category create / edit dialog ────────────────────────────────────────────

type CategoryDraft = { id?: string; parent: string | null; parentName?: string; name: string; description: string };

function CategoryDialog({
  draft,
  helpdeskId,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  draft: CategoryDraft | null;
  helpdeskId: string;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: (cat: AssetCategory) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!draft) return;
    setName(draft.name);
    setDescription(draft.description);
    setErrors({});
    setBusy(false);
  }, [draft]);

  async function save() {
    if (!draft) return;
    if (!name.trim()) {
      setErrors({ name: ["Enter a name."] });
      return;
    }
    setBusy(true);
    try {
      const saved = draft.id
        ? await assetCategoriesApi.update(draft.id, { name: name.trim(), description: description.trim() })
        : await assetCategoriesApi.create({
            helpdesk: helpdeskId,
            parent: draft.parent,
            name: name.trim(),
            description: description.trim(),
            sort_order: nextSortOrder,
          });
      toast.success(draft.id ? "Saved." : draft.parent ? "Sub-category added." : "Category added.");
      onSaved(saved);
    } catch (e) {
      if (e instanceof ItsmApiError && e.fieldErrors) setErrors(e.fieldErrors);
      toast.error(apiMessage(e, "Could not save the category."));
      setBusy(false);
    }
  }

  const title = draft?.id
    ? `Edit ${draft.parent ? "sub-category" : "category"}`
    : draft?.parent
      ? `New sub-category of ${draft.parentName ?? "category"}`
      : "New category";

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{draft?.id ? ASSET_HELP.categoryLevel : ASSET_HELP.perHelpdesk}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <FieldRow label="Name" htmlFor="cat-name" required error={fieldErr(errors, "name") ?? fieldErr(errors, "parent")}>
            <input
              id="cat-name"
              className={inputCls}
              value={name}
              maxLength={100}
              disabled={busy}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder={draft?.parent ? "e.g. Laptop" : "e.g. Computer"}
            />
          </FieldRow>
          <FieldRow label="Description" htmlFor="cat-desc" error={fieldErr(errors, "description")}>
            <textarea
              id="cat-desc"
              rows={2}
              className={textareaCls}
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FieldRow>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {draft?.id ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Tree ─────────────────────────────────────────────────────────────────────

function TreeItem({
  cat,
  depth,
  selected,
  onSelect,
}: {
  cat: AssetCategory;
  depth: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(cat.id)}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          selected ? "bg-primary/10 font-medium text-primary-ink" : "hover:bg-accent",
          depth ? "pl-8" : "pl-2",
        )}
      >
        {depth ? null : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className={cn("min-w-0 flex-1 truncate", !cat.is_active && "text-muted-foreground line-through")} title={cat.name}>
          {cat.name}
        </span>
        {!cat.is_active ? (
          <Badge variant="outline" className="shrink-0 px-1.5 font-normal text-muted-foreground">
            Inactive
          </Badge>
        ) : null}
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" title={`${cat.asset_count} assets`}>
          {cat.asset_count}
        </span>
      </button>
    </li>
  );
}

// ── Field links of one node ──────────────────────────────────────────────────

function LinkRow({
  link,
  index,
  total,
  perms,
  busy,
  overridesParent,
  onRequired,
  onMove,
  onUnlink,
}: {
  link: AssetCategoryFieldLink;
  index: number;
  total: number;
  perms: ConfigPerms;
  busy: boolean;
  overridesParent: boolean;
  onRequired: (link: AssetCategoryFieldLink, v: boolean) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onUnlink: (link: AssetCategoryFieldLink) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          <span className="truncate" title={link.field_name}>
            {link.field_name}
          </span>
          <Badge variant="secondary" className="font-normal">
            {TYPE_LABEL[link.field_type] ?? link.field_type}
          </Badge>
          {!link.field_is_active ? (
            <Hint label={ASSET_HELP.fieldActive} wrap>
              <Badge variant="outline" className="font-normal text-muted-foreground">
                Field inactive
              </Badge>
            </Hint>
          ) : null}
          {overridesParent ? (
            <Hint label={ASSET_HELP.overridden} wrap>
              <Badge variant="outline" className="font-normal">
                Overrides category
              </Badge>
            </Hint>
          ) : null}
        </p>
      </div>
      <Hint label={perms.update ? ASSET_HELP.required : NO_PERM}>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            checked={link.is_required}
            disabled={!perms.update || busy}
            onCheckedChange={(v) => onRequired(link, v)}
            aria-label={`Required: ${link.field_name}`}
          />
          Required
        </label>
      </Hint>
      <div className="flex items-center">
        <IconButton
          label={`Move ${link.field_name} up`}
          className="h-7 w-7"
          disabled={!perms.update || busy || index === 0}
          disabledReason={!perms.update ? NO_PERM : "Already first"}
          onClick={() => onMove(index, -1)}
        >
          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
        <IconButton
          label={`Move ${link.field_name} down`}
          className="h-7 w-7"
          disabled={!perms.update || busy || index === total - 1}
          disabledReason={!perms.update ? NO_PERM : "Already last"}
          onClick={() => onMove(index, 1)}
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
        {perms.delete ? (
          <IconButton
            label={`Remove ${link.field_name} from this category`}
            detail={ASSET_HELP.unlink}
            className="h-7 w-7 text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => onUnlink(link)}
          >
            <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
    </li>
  );
}

function NodePanel({
  node,
  parent,
  subs,
  perms,
  busy,
  onEdit,
  onAddSub,
  onToggleActive,
  onDelete,
  onAddField,
  onRequired,
  onMove,
  onUnlink,
}: {
  node: AssetCategory;
  parent: AssetCategory | null;
  subs: AssetCategory[];
  perms: ConfigPerms;
  busy: boolean;
  onEdit: () => void;
  onAddSub: () => void;
  onToggleActive: (v: boolean) => void;
  onDelete: () => void;
  onAddField: () => void;
  onRequired: (link: AssetCategoryFieldLink, v: boolean) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onUnlink: (link: AssetCategoryFieldLink) => void;
}) {
  const own = [...node.field_links].sort(linkOrder);
  const ownIds = new Set(own.map((l) => l.field));
  const inherited = parent ? [...parent.field_links].sort(linkOrder) : [];
  const parentIds = new Set(inherited.map((l) => l.field));
  return (
    <section className="rounded-xl border bg-card shadow-soft">
      <header className="flex flex-wrap items-start gap-3 border-b px-5 py-4 compact:px-3.5 compact:py-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{parent ? `Sub-category of ${parent.name}` : "Category"}</p>
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            <span className="break-words">{node.name}</span>
            {!node.is_active ? (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                Inactive
              </Badge>
            ) : null}
            <span className="text-xs font-normal text-muted-foreground">
              {node.asset_count.toLocaleString()} {node.asset_count === 1 ? "asset" : "assets"}
            </span>
          </h2>
          {node.description ? <p className="mt-0.5 text-sm text-muted-foreground">{node.description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Hint label={perms.update ? (node.is_active ? ASSET_HELP.categoryTree : "Inactive: new assets can't pick it. Turn on to allow it again.") : NO_PERM}>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch
                checked={node.is_active}
                disabled={!perms.update || busy}
                onCheckedChange={onToggleActive}
                aria-label={`Active: ${node.name}`}
              />
              Active
            </label>
          </Hint>
          {perms.update ? (
            <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
              <Pencil aria-hidden="true" /> Rename
            </Button>
          ) : null}
          {!parent && perms.create ? (
            <Button size="sm" variant="outline" onClick={onAddSub} disabled={busy}>
              <FolderPlus aria-hidden="true" /> Add sub-category
            </Button>
          ) : null}
          {perms.delete ? (
            <IconButton
              label={`Delete ${node.name}`}
              className="h-8 w-8 text-destructive hover:text-destructive"
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      </header>

      <div className="space-y-5 p-5 compact:space-y-4 compact:p-3.5">
        {parent ? (
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              From {parent.name}
              <InfoTip label="About inherited fields">{ASSET_HELP.inheritedFields(parent.name)}</InfoTip>
            </h3>
            {inherited.length === 0 ? (
              <p className="text-sm text-muted-foreground">“{parent.name}” has no fields of its own.</p>
            ) : (
              <ul className="divide-y rounded-lg border bg-muted/20">
                {inherited.map((l) => (
                  <li key={l.id} className={cn("flex flex-wrap items-center gap-2 px-3 py-2 text-sm", ownIds.has(l.field) && "opacity-60")}>
                    <span className="min-w-0 flex-1 truncate" title={l.field_name}>
                      {l.field_name}
                    </span>
                    <Badge variant="secondary" className="font-normal">
                      {TYPE_LABEL[l.field_type] ?? l.field_type}
                    </Badge>
                    {l.is_required ? <Badge variant="outline" className="font-normal">Required</Badge> : null}
                    {ownIds.has(l.field) ? (
                      <Hint label={ASSET_HELP.overridden} wrap>
                        <span className="text-xs text-muted-foreground">Overridden below</span>
                      </Hint>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              {parent ? `Fields of ${node.name}` : "Fields"}
              <InfoTip label="About detail fields">
                {parent
                  ? `Fields only assets in “${parent.name} › ${node.name}” have, on top of “${parent.name}”'s.`
                  : `Fields every asset in “${node.name}” has, including its sub-categories. ${ASSET_HELP.reorder}`}
              </InfoTip>
            </h3>
            {perms.create ? (
              <Button size="sm" onClick={onAddField} disabled={busy}>
                <Plus aria-hidden="true" /> Add field
              </Button>
            ) : null}
          </div>
          {own.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              No fields here yet.{perms.create ? " Click Add field to pick one from the library or create one." : ""}
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {own.map((l, i) => (
                <LinkRow
                  key={l.id}
                  link={l}
                  index={i}
                  total={own.length}
                  perms={perms}
                  busy={busy}
                  overridesParent={parentIds.has(l.field)}
                  onRequired={onRequired}
                  onMove={onMove}
                  onUnlink={onUnlink}
                />
              ))}
            </ul>
          )}
        </div>

        {!parent && subs.length ? (
          <p className="text-xs text-muted-foreground">
            Sub-categories: {subs.map((s) => s.name).join(", ")}. They get these fields too.
          </p>
        ) : null}
      </div>
    </section>
  );
}

// ── Fields library ───────────────────────────────────────────────────────────

function FieldsLibrary({
  fields,
  perms,
  busyId,
  onNew,
  onEdit,
  onToggle,
  onDelete,
}: {
  fields: AssetField[];
  perms: ConfigPerms;
  busyId: string | null;
  onNew: () => void;
  onEdit: (f: AssetField) => void;
  onToggle: (f: AssetField, v: boolean) => void;
  onDelete: (f: AssetField) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {fields.length} {fields.length === 1 ? "field" : "fields"} in this helpdesk
          <InfoTip label="About the fields library">{ASSET_HELP.fieldsLibrary}</InfoTip>
        </p>
        {perms.create ? (
          <Button size="sm" onClick={onNew}>
            <Plus aria-hidden="true" /> New field
          </Button>
        ) : null}
      </div>
      {fields.length === 0 ? (
        <EmptyState icon={Boxes} title="No fields yet" description="Create fields here, then link them to categories." />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Used by</TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex flex-row-reverse items-center gap-1">
                    Values <InfoTip label="About Values">{ASSET_HELP.valueCount}</InfoTip>
                  </span>
                </TableHead>
                <TableHead className="text-center">
                  <span className="inline-flex items-center gap-1">
                    Active <InfoTip label="About Active">{ASSET_HELP.fieldActive}</InfoTip>
                  </span>
                </TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((f) => {
                const used = f.used_by.map((u) => `${u.name}${u.is_required ? " *" : ""}`).join(", ");
                return (
                  <TableRow key={f.id}>
                    <TableCell>
                      <p className="font-medium">{f.name}</p>
                      {f.help_text ? (
                        <p className="max-w-[22rem] truncate text-xs text-muted-foreground" title={f.help_text}>
                          {f.help_text}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {TYPE_LABEL[f.field_type] ?? f.field_type}
                      {f.options.length ? ` · ${f.options.length} options` : ""}
                    </TableCell>
                    <TableCell>
                      {used ? (
                        <span className="block max-w-[20rem] truncate text-sm" title={used}>
                          {used}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not linked</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{f.value_count.toLocaleString()}</TableCell>
                    <TableCell className="text-center">
                      <Hint label={perms.update ? undefined : NO_PERM}>
                        <Switch
                          checked={f.is_active}
                          disabled={!perms.update || busyId === f.id}
                          onCheckedChange={(v) => onToggle(f, v)}
                          aria-label={`Active: ${f.name}`}
                        />
                      </Hint>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {perms.update ? (
                          <Button size="sm" variant="outline" onClick={() => onEdit(f)} disabled={busyId === f.id}>
                            Edit
                          </Button>
                        ) : null}
                        {perms.delete ? (
                          <IconButton
                            label={`Delete ${f.name}`}
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            disabled={busyId === f.id}
                            onClick={() => onDelete(f)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </IconButton>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────

type Pending =
  | { kind: "category"; cat: AssetCategory; subs: number }
  | { kind: "field"; field: AssetField }
  | null;

export function CategoryTreeEditor({ helpdeskId, perms }: { helpdeskId: string; perms: ConfigPerms }) {
  const [cats, setCats] = useState<AssetCategory[] | null>(null);
  const [fields, setFields] = useState<AssetField[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyField, setBusyField] = useState<string | null>(null);
  const [catDraft, setCatDraft] = useState<CategoryDraft | null>(null);
  const [fieldMode, setFieldMode] = useState<FieldDialogMode | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [starterBusy, setStarterBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, f] = await Promise.all([
        assetCategoriesApi.list({ helpdesk: helpdeskId }),
        assetFieldsApi.list({ helpdesk: helpdeskId }),
      ]);
      setCats(c);
      setFields(f);
    } catch (e) {
      setCats((cur) => cur ?? []);
      toast.error(apiMessage(e, "Could not load the categories."));
    }
  }, [helpdeskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tops = useMemo(() => (cats ?? []).filter((c) => !c.parent).sort(byOrder), [cats]);
  const childrenOf = useCallback((id: string) => (cats ?? []).filter((c) => c.parent === id).sort(byOrder), [cats]);
  const selected = (cats ?? []).find((c) => c.id === selectedId) ?? tops[0] ?? null;
  const parent = selected?.parent ? (cats ?? []).find((c) => c.id === selected.parent) ?? null : null;

  async function run(fn: () => Promise<unknown>, ok?: string, fallback = "Could not save the change."): Promise<boolean> {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
      return true;
    } catch (e) {
      toast.error(apiMessage(e, fallback));
      // A partial change (e.g. a reorder) may have applied: show the server's state.
      void load();
      return false;
    } finally {
      setBusy(false);
    }
  }

  function moveLink(index: number, dir: -1 | 1) {
    if (!selected) return;
    const own = [...selected.field_links].sort(linkOrder);
    const j = index + dir;
    if (j < 0 || j >= own.length) return;
    [own[index], own[j]] = [own[j], own[index]];
    // Renumber 10, 20, 30… and patch only the links whose order changed.
    const updates = own
      .map((l, i) => ({ l, order: (i + 1) * 10 }))
      .filter(({ l, order }) => l.sort_order !== order);
    void run(() => Promise.all(updates.map(({ l, order }) => assetCategoryFieldsApi.update(l.id, { sort_order: order }))));
  }

  async function loadStarter() {
    setStarterBusy(true);
    try {
      const r = await assetCategoriesApi.loadStarter(helpdeskId);
      toast.success(`IT starter set loaded: ${r.categories} categories, ${r.fields} fields, ${r.links} links added.`);
      await load();
    } catch (e) {
      toast.error(apiMessage(e, "Could not load the starter set."));
    } finally {
      setStarterBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pending) return;
    if (pending.kind === "category") {
      const cat = pending.cat;
      const ok = await run(
        () => assetCategoriesApi.delete(cat.id),
        `“${cat.name}” deleted.`,
        "Could not delete the category.",
      );
      if (ok && selected?.id === cat.id) setSelectedId(cat.parent);
    } else {
      const f = pending.field;
      setBusyField(f.id);
      await run(() => assetFieldsApi.delete(f.id), `Field “${f.name}” deleted.`, "Could not delete the field.");
      setBusyField(null);
    }
    setPending(null);
  }

  async function toggleField(f: AssetField, v: boolean) {
    setBusyField(f.id);
    await run(() => assetFieldsApi.update(f.id, { is_active: v }));
    setBusyField(null);
  }

  if (cats === null) {
    return (
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  const starterButton = perms.create ? (
    <Hint label={ASSET_HELP.starterSet}>
      <Button variant="outline" onClick={() => void loadStarter()} disabled={starterBusy}>
        {starterBusy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
        Load IT starter set
      </Button>
    </Hint>
  ) : null;

  const nextTopOrder = (tops.length + 1) * 10;
  const nextSubOrder = (id: string | null) => (id ? (childrenOf(id).length + 1) * 10 : nextTopOrder);

  return (
    <>
      <Tabs defaultValue="tree" className="space-y-4">
        <TabsList>
          <TabsTrigger value="tree">Categories</TabsTrigger>
          <TabsTrigger value="library">Fields library ({fields.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="tree" className="mt-0">
          {tops.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No asset categories yet"
              description={`${ASSET_HELP.noCategories} ${ASSET_LINK_HELP.layoutNote}`}
              action={
                perms.create ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    {starterButton}
                    <Button onClick={() => setCatDraft({ parent: null, name: "", description: "" })}>
                      <Plus aria-hidden="true" /> Add category
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-4 compact:gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
              <aside className="space-y-3 rounded-xl border bg-card p-3 shadow-soft lg:self-start">
                <div className="flex items-center justify-between gap-2 px-1">
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                    Categories
                    <InfoTip label="About categories">{`${ASSET_HELP.categoryTree}\n${ASSET_LINK_HELP.layoutNote}`}</InfoTip>
                  </h2>
                  {perms.create ? (
                    <IconButton
                      label="Add category"
                      className="h-8 w-8"
                      onClick={() => setCatDraft({ parent: null, name: "", description: "" })}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                  ) : null}
                </div>
                <ul className="space-y-0.5" aria-label="Asset categories">
                  {tops.map((t) => (
                    <TreeGroup key={t.id} top={t} subs={childrenOf(t.id)} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
                  ))}
                </ul>
                {starterButton ? <div className="border-t pt-3">{starterButton}</div> : null}
              </aside>

              {selected ? (
                <NodePanel
                  node={selected}
                  parent={parent}
                  subs={parent ? [] : childrenOf(selected.id)}
                  perms={perms}
                  busy={busy}
                  onEdit={() =>
                    setCatDraft({
                      id: selected.id,
                      parent: selected.parent,
                      name: selected.name,
                      description: selected.description ?? "",
                    })
                  }
                  onAddSub={() =>
                    setCatDraft({ parent: selected.id, parentName: selected.name, name: "", description: "" })
                  }
                  onToggleActive={(v) =>
                    void run(
                      () => assetCategoriesApi.update(selected.id, { is_active: v }),
                      v ? `“${selected.name}” activated.` : `“${selected.name}” deactivated.`,
                    )
                  }
                  onDelete={() => setPending({ kind: "category", cat: selected, subs: childrenOf(selected.id).length })}
                  onAddField={() =>
                    setFieldMode({
                      kind: "link",
                      categoryId: selected.id,
                      categoryName: parent ? `${parent.name} › ${selected.name}` : selected.name,
                      linkedFieldIds: selected.field_links.map((l) => l.field),
                      nextSortOrder: (selected.field_links.length + 1) * 10,
                    })
                  }
                  onRequired={(l, v) => void run(() => assetCategoryFieldsApi.update(l.id, { is_required: v }))}
                  onMove={moveLink}
                  onUnlink={(l) =>
                    void run(() => assetCategoryFieldsApi.delete(l.id), `“${l.field_name}” removed from “${selected.name}”.`)
                  }
                />
              ) : null}
            </div>
          )}
        </TabsContent>

        <TabsContent value="library" className="mt-0">
          <FieldsLibrary
            fields={fields}
            perms={perms}
            busyId={busyField}
            onNew={() => setFieldMode({ kind: "create" })}
            onEdit={(f) => setFieldMode({ kind: "edit", field: f })}
            onToggle={(f, v) => void toggleField(f, v)}
            onDelete={(f) => setPending({ kind: "field", field: f })}
          />
        </TabsContent>
      </Tabs>

      <CategoryDialog
        draft={catDraft}
        helpdeskId={helpdeskId}
        nextSortOrder={nextSubOrder(catDraft?.parent ?? null)}
        onClose={() => setCatDraft(null)}
        onSaved={(c) => {
          setCatDraft(null);
          setSelectedId(c.id);
          void load();
        }}
      />

      <AssetFieldDialog
        open={!!fieldMode}
        mode={fieldMode}
        helpdeskId={helpdeskId}
        library={fields}
        onOpenChange={(o) => !o && setFieldMode(null)}
        onDone={() => void load()}
      />

      <ConfirmDialog
        open={!!pending}
        busy={busy}
        title={
          pending?.kind === "category"
            ? `Delete “${pending.cat.name}”?`
            : pending?.kind === "field"
              ? `Delete the field “${pending.field.name}”?`
              : ""
        }
        description={
          pending?.kind === "category"
            ? pending.cat.asset_count > 0
              ? ASSET_HELP.masterDeleteInUse(pending.cat.asset_count, pending.cat.parent ? "sub-category" : "category")
              : `${pending.subs ? `Its ${pending.subs} sub-categor${pending.subs === 1 ? "y is" : "ies are"} deleted too, with their field links. ` : ""}The fields themselves stay in the library.`
            : pending?.kind === "field"
              ? `${ASSET_HELP.fieldDelete}${pending.field.used_by.length ? ` It's linked to: ${pending.field.used_by.map((u) => u.name).join(", ")}.` : ""}`
              : undefined
        }
        confirmLabel="Delete"
        hideConfirm={pending?.kind === "category" && pending.cat.asset_count > 0}
        extraAction={
          pending?.kind === "category" && pending.cat.asset_count > 0 && pending.cat.is_active && perms.update ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                const cat = pending.cat;
                setPending(null);
                void run(() => assetCategoriesApi.update(cat.id, { is_active: false }), `“${cat.name}” deactivated.`);
              }}
            >
              Deactivate instead
            </Button>
          ) : null
        }
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function TreeGroup({
  top,
  subs,
  selectedId,
  onSelect,
}: {
  top: AssetCategory;
  subs: AssetCategory[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <TreeItem cat={top} depth={0} selected={selectedId === top.id} onSelect={onSelect} />
      {subs.map((s) => (
        <TreeItem key={s.id} cat={s} depth={1} selected={selectedId === s.id} onSelect={onSelect} />
      ))}
    </>
  );
}
