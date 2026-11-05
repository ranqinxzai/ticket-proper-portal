"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { inputCls, selectCls, textareaCls } from "@/components/tickets/field-styles";
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
import { Label } from "@/components/ui/label";
import { assetsApi } from "@/lib/itsm/assets-api";
import type { AssetDocType, AssetDocument } from "@/lib/itsm/assets-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { ASSET_DOC_HELP } from "@/lib/itsm/help/assets";
import { cn } from "@/lib/utils";

import { apiMessage, fieldErr, fmtDate, userLabel } from "./asset-utils";
import { ConfirmDialog } from "./confirm-dialog";

const DOC_TYPES: { value: AssetDocType; label: string }[] = [
  { value: "invoice", label: "Invoice" },
  { value: "warranty", label: "Warranty card" },
  { value: "manual", label: "Manual" },
  { value: "other", label: "Other" },
];
// Mirrors backend services/documents.py (ALLOWED_TYPES, MAX_BYTES, NOTE_MAX); the
// server checks again and decides the content type itself.
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt";
const ALLOWED_EXT = new Set(ACCEPT.split(","));
const MAX_BYTES = 20 * 1024 * 1024;
const NOTE_MAX = 255;
/** What a browser tab may show (no script can run in these). Everything else downloads. */
const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileProblem(file: File | null): string | null {
  if (!file) return "Choose a file to upload.";
  const dot = file.name.lastIndexOf(".");
  if (dot < 0 || !ALLOWED_EXT.has(file.name.slice(dot).toLowerCase())) return ASSET_DOC_HELP.file;
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_BYTES) return "The file is larger than 20 MB.";
  return null;
}

function AddDocumentDialog({
  assetId,
  defaultType,
  onClose,
  onAdded,
}: {
  assetId: string;
  defaultType: AssetDocType;
  onClose: () => void;
  onAdded: (doc: AssetDocument) => void;
}) {
  const [docType, setDocType] = useState<AssetDocType>(defaultType);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const fileError = fieldErr(errors, "file");

  const submit = async () => {
    const problem = fileProblem(file);
    if (problem || !file) {
      setErrors({ file: [problem ?? "Choose a file to upload."] });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      onAdded(await assetsApi.uploadDocument(assetId, file, docType, note.trim()));
    } catch (e) {
      if (e instanceof ItsmApiError && e.fieldErrors) setErrors(e.fieldErrors);
      toast.error(apiMessage(e, "Could not upload the file."));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a document</DialogTitle>
          <DialogDescription>{ASSET_DOC_HELP.private}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <Label htmlFor="asset-doc-type">Type</Label>
              <InfoTip label="About document types">{ASSET_DOC_HELP.types}</InfoTip>
            </div>
            <select id="asset-doc-type" className={selectCls} value={docType} disabled={busy}
              onChange={(e) => setDocType(e.target.value as AssetDocType)}>
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            {fieldErr(errors, "doc_type") ? (
              <p className="text-xs text-destructive">{fieldErr(errors, "doc_type")}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <Label htmlFor="asset-doc-file">File</Label>
              <InfoTip label="Which files can I upload?">{ASSET_DOC_HELP.file}</InfoTip>
            </div>
            <input id="asset-doc-file" type="file" accept={ACCEPT} disabled={busy}
              aria-invalid={fileError ? true : undefined}
              aria-describedby={fileError ? "asset-doc-file-error" : undefined}
              className={cn(inputCls, "h-auto py-1.5 file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium",
                fileError && "border-destructive")}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                const problem = f ? fileProblem(f) : null;
                setErrors(problem ? { file: [problem] } : {});
              }} />
            {fileError ? (
              <p id="asset-doc-file-error" className="text-xs text-destructive">{fileError}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <Label htmlFor="asset-doc-note">Note</Label>
              <InfoTip label="About the note">{ASSET_DOC_HELP.note}</InfoTip>
            </div>
            <textarea id="asset-doc-note" rows={2} maxLength={NOTE_MAX} className={textareaCls} value={note}
              disabled={busy} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
            {fieldErr(errors, "note") ? <p className="text-xs text-destructive">{fieldErr(errors, "note")}</p> : null}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !file || Boolean(fileError)}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentRow({
  doc,
  busy,
  canEdit,
  onOpen,
  onRemove,
}: {
  doc: AssetDocument;
  busy: boolean;
  canEdit: boolean;
  onOpen: (doc: AssetDocument) => void;
  onRemove: (doc: AssetDocument) => void;
}) {
  const inline = INLINE_TYPES.has(doc.content_type);
  const meta = [fmtSize(doc.size_bytes), doc.uploaded_by ? userLabel(doc.uploaded_by) : null, fmtDate(doc.created_at)]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex items-start gap-2 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide text-primary-ink">
            {doc.doc_type_label}
          </span>
          <Hint label={`${inline ? "Open" : "Download"} ${doc.original_name}\n${ASSET_DOC_HELP.open}`}>
            <button type="button" disabled={busy} onClick={() => onOpen(doc)}
              className="min-w-0 truncate rounded-sm text-left text-sm font-medium text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60">
              {doc.original_name || "document"}
            </button>
          </Hint>
          {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
        </div>
        <p className="truncate text-xs text-muted-foreground" title={meta}>{meta}</p>
        {doc.note ? <p className="break-words text-xs">{doc.note}</p> : null}
      </div>
      {canEdit ? (
        <IconButton label={ASSET_DOC_HELP.remove(doc.original_name || "document")} className="h-7 w-7 shrink-0"
          disabled={busy} onClick={() => onRemove(doc)}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      ) : null}
    </li>
  );
}

/** Invoice, warranty card, manual and other files kept with an asset (right rail). */
export function AssetDocuments({
  assetId,
  canEdit,
  onChanged,
}: {
  assetId: string;
  canEdit: boolean;
  /** Called after an upload or removal (the page refreshes History). */
  onChanged?: () => void;
}) {
  const [docs, setDocs] = useState<AssetDocument[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AssetDocument | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setDocs(null);
    setFailed(false);
    assetsApi
      .documents(assetId)
      .then((d) => alive && setDocs(d))
      .catch(() => {
        if (!alive) return;
        setDocs([]);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [assetId]);

  const reload = () =>
    assetsApi
      .documents(assetId)
      .then(setDocs)
      .catch(() => undefined);

  const open = async (doc: AssetDocument) => {
    const inline = INLINE_TYPES.has(doc.content_type);
    // Open the tab inside the click (popup blockers allow only that), then point it at
    // the file once it has downloaded with the user's token.
    const tab = inline ? window.open("", "_blank") : null;
    if (tab) tab.opener = null;
    setBusyId(doc.id);
    try {
      if (tab) {
        const url = URL.createObjectURL(await assetsApi.documentBlob(assetId, doc.id));
        tab.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
      } else {
        await assetsApi.downloadDocument(assetId, doc);
      }
    } catch (e) {
      tab?.close();
      toast.error(apiMessage(e, "Could not open the file."));
    } finally {
      setBusyId(null);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await assetsApi.removeDocument(assetId, removing.id);
      setDocs((list) => (list ?? []).filter((d) => d.id !== removing.id));
      toast.success(`Removed ${removing.original_name}`);
      setRemoving(null);
      onChanged?.();
    } catch (e) {
      toast.error(apiMessage(e, "Could not remove the file."));
    } finally {
      setRemoveBusy(false);
    }
  };

  const hasInvoice = (docs ?? []).some((d) => d.doc_type === "invoice");

  return (
    <section className="rounded-xl border bg-card shadow-soft">
      <header className="flex items-center gap-2 border-b px-5 py-3.5 compact:px-3.5 compact:py-2">
        <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Documents</h2>
        <InfoTip label="About asset documents">{ASSET_DOC_HELP.card}</InfoTip>
        {docs && !failed ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {docs.length} {docs.length === 1 ? "file" : "files"}
          </span>
        ) : null}
        {canEdit ? (
          <Button type="button" variant="outline" size="sm" className={cn("h-7 px-2", !(docs && !failed) && "ml-auto")}
            onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" /> Add
          </Button>
        ) : null}
      </header>
      <div className="p-5 compact:p-3.5">
        {docs === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading documents…
          </p>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">Could not load the documents.</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents yet.{canEdit ? " Add the invoice, warranty card or manual." : ""}
          </p>
        ) : (
          <ul className="divide-y">
            {docs.map((d) => (
              <DocumentRow key={d.id} doc={d} busy={busyId === d.id} canEdit={canEdit} onOpen={open}
                onRemove={setRemoving} />
            ))}
          </ul>
        )}
      </div>

      {adding ? (
        <AddDocumentDialog
          assetId={assetId}
          defaultType={hasInvoice ? "other" : "invoice"}
          onClose={() => setAdding(false)}
          onAdded={(doc) => {
            setAdding(false);
            toast.success(`Added ${doc.original_name}`);
            void reload();
            onChanged?.();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.original_name ?? "this file"}?`}
        description={ASSET_DOC_HELP.removeConfirm}
        confirmLabel="Remove"
        busy={removeBusy}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
