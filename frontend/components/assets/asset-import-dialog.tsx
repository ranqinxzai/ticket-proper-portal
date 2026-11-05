"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { assetImportsApi } from "@/lib/itsm/assets-api";
import type { AssetImportResult } from "@/lib/itsm/assets-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { ASSET_HELP } from "@/lib/itsm/help/assets";
import { cn } from "@/lib/utils";

import { apiMessage, fieldErr, importCell } from "./asset-utils";

const PREVIEW_ROWS = 25;
const MASTER_LABEL: Record<string, string> = { vendors: "Vendors", locations: "Locations", departments: "Departments" };

type Busy = "template" | "check" | "import" | null;

function ResultView({
  result,
  base,
  canViewHistory,
  onNavigate,
}: {
  result: AssetImportResult;
  base: string;
  canViewHistory: boolean;
  onNavigate: () => void;
}) {
  const dry = result.dry_run;
  const masters = Object.entries(result.will_create ?? {}).filter(([, names]) => names?.length);
  const ok = result.failed_count === 0;
  return (
    <div className="space-y-4">
      <div
        className={cn(
          "flex items-start gap-3 rounded-lg border p-3 text-sm",
          ok ? "border-success/40 bg-success/10" : "border-amber-500/40 bg-amber-500/10",
        )}
      >
        {ok ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        )}
        <div className="space-y-0.5">
          <p className="font-medium">
            {dry
              ? `${result.valid_rows.toLocaleString()} of ${result.total_rows.toLocaleString()} rows can be imported · ${result.failed_count.toLocaleString()} would fail`
              : `${result.valid_rows.toLocaleString()} created · ${result.failed_count.toLocaleString()} failed`}
          </p>
          {dry ? <p className="text-muted-foreground">Check only — nothing was saved.</p> : null}
          {result.expired_count ? (
            <p className="flex items-center gap-1 text-muted-foreground">
              {result.expired_count.toLocaleString()} {dry ? "would be" : "were"} imported as Expired.
              <InfoTip label="About Expired rows">{ASSET_HELP.expiredCount}</InfoTip>
            </p>
          ) : null}
        </div>
      </div>

      {result.warnings?.length ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">Warnings</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {masters.length ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">{dry ? "Will be created" : "Created"}</p>
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {masters.map(([kind, names]) => (
              <li key={kind}>
                <span className="font-medium text-foreground">{MASTER_LABEL[kind] ?? kind}:</span> {names.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.failed_rows?.length ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">
            Failed rows
            {result.failed_rows.length > PREVIEW_ROWS
              ? ` (first ${PREVIEW_ROWS} of ${result.failed_count.toLocaleString()})`
              : ""}
          </p>
          <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border text-sm">
            {result.failed_rows.slice(0, PREVIEW_ROWS).map((r) => {
              const name = importCell(r.data, "name");
              return (
                <li key={r.row_number} className="px-3 py-2">
                  <p className="font-medium">
                    Row {r.row_number}
                    {name ? <span className="font-normal text-muted-foreground"> — {name}</span> : null}
                  </p>
                  <ul className="mt-0.5 space-y-0.5 text-xs">
                    {r.errors.map((e, i) => (
                      <li key={i}>
                        <span className="font-medium">{e.column}:</span>{" "}
                        <span className="text-destructive">{e.message}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {!dry && result.import_id ? (
        <div className="flex flex-wrap gap-2">
          {result.failed_count > 0 && canViewHistory ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/assets/list/imports/${result.import_id}`} onClick={onNavigate}>
                View failed records
              </Link>
            </Button>
          ) : null}
          {result.valid_rows > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/assets/list?import=${result.import_id}`} onClick={onNavigate}>
                View imported assets
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Excel import: download the template → pick a file → Check only (dry run) or Import.
 *  Good rows are saved, bad rows skipped (kept on the import record for download). */
export function AssetImportDialog({
  open,
  onOpenChange,
  helpdeskId,
  base,
  canCreateMissing,
  canViewHistory,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  helpdeskId: string;
  base: string;
  canCreateMissing: boolean;
  canViewHistory: boolean;
  onImported?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<AssetImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setCreateMissing(false);
    setBusy(null);
    setFileError(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close(next: boolean) {
    if (!next && busy && busy !== "template") return; // don't drop a running import
    if (!next) reset();
    onOpenChange(next);
  }

  async function downloadTemplate() {
    setBusy("template");
    try {
      await assetImportsApi.template(helpdeskId);
    } catch (e) {
      toast.error(apiMessage(e, "Could not download the template."));
    } finally {
      setBusy(null);
    }
  }

  async function run(dry: boolean) {
    if (!file) {
      setFileError("Choose an Excel (.xlsx) file first.");
      return;
    }
    setBusy(dry ? "check" : "import");
    setFileError(null);
    try {
      const fn = dry ? assetImportsApi.validate : assetImportsApi.run;
      const res = await fn(helpdeskId, file, createMissing && canCreateMissing);
      setResult(res);
      if (!dry) {
        toast.success(`${res.valid_rows.toLocaleString()} created · ${res.failed_count.toLocaleString()} failed`);
        onImported?.();
      }
    } catch (e) {
      const msg = e instanceof ItsmApiError ? fieldErr(e.fieldErrors, "file") : undefined;
      if (msg) setFileError(msg);
      else toast.error(apiMessage(e, dry ? "Could not check the file." : "Could not import the file."));
    } finally {
      setBusy(null);
    }
  }

  const noFile = !file;
  const running = busy === "check" || busy === "import";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            Import assets from Excel
          </DialogTitle>
          <DialogDescription>{ASSET_HELP.importOverview}</DialogDescription>
        </DialogHeader>

        {result ? (
          <ResultView result={result} base={base} canViewHistory={canViewHistory} onNavigate={() => close(false)} />
        ) : null}
        {/* Kept mounted (hidden) while a result shows, so "Back" still has the chosen file. */}
        <div className={cn("space-y-5", result && "hidden")}>
          <section className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              1. Download the template
              <InfoTip label="About the template">{ASSET_HELP.template}</InfoTip>
            </p>
            <Button variant="outline" size="sm" onClick={() => void downloadTemplate()} disabled={busy === "template"}>
              {busy === "template" ? <Loader2 className="animate-spin" /> : <Download />}
              Download template
            </Button>
          </section>

          <section className="space-y-2">
            <label htmlFor="asset-import-file" className="block text-sm font-medium">
              2. Choose the filled-in file (.xlsx)
            </label>
            <input
              ref={inputRef}
              id="asset-import-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={running}
              aria-invalid={!!fileError}
              aria-describedby={fileError ? "asset-import-file-error" : undefined}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setFileError(null);
              }}
              className="block w-full rounded-md border border-input bg-background text-sm file:mr-3 file:border-0 file:border-r file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-accent disabled:opacity-50"
            />
            {fileError ? (
              <p id="asset-import-file-error" className="text-xs font-medium text-destructive">
                {fileError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Up to 5,000 rows and 10 MB. {ASSET_HELP.blankStatus}</p>
            )}
          </section>

          <section>
            <Hint label={canCreateMissing ? undefined : ASSET_HELP.createMissingNoPerm} side="bottom" align="start">
              <label
                className={cn("flex items-start gap-2 text-sm", !canCreateMissing && "cursor-not-allowed text-muted-foreground")}
                tabIndex={canCreateMissing ? undefined : 0}
              >
                <Checkbox
                  checked={createMissing && canCreateMissing}
                  disabled={!canCreateMissing || running}
                  onCheckedChange={(v) => setCreateMissing(Boolean(v))}
                  className="mt-0.5"
                />
                <span>
                  Create missing vendors, locations and departments
                  <span className="ml-1 inline-flex align-middle">
                    <InfoTip label="About creating missing items">{ASSET_HELP.createMissing}</InfoTip>
                  </span>
                </span>
              </label>
            </Hint>
          </section>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {result ? (
            <>
              <Button variant="ghost" onClick={() => setResult(null)}>
                {result.dry_run ? "Back" : "Import another file"}
              </Button>
              {result.dry_run && result.valid_rows > 0 ? (
                <Hint label={ASSET_HELP.importRun}>
                  <Button onClick={() => void run(false)} disabled={running}>
                    {busy === "import" ? <Loader2 className="animate-spin" /> : <Upload />}
                    Import {result.valid_rows.toLocaleString()} {result.valid_rows === 1 ? "row" : "rows"}
                  </Button>
                </Hint>
              ) : (
                <Button onClick={() => close(false)}>Done</Button>
              )}
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => close(false)} disabled={running}>
                Cancel
              </Button>
              <Hint label={noFile ? "Choose a file first" : ASSET_HELP.checkOnly}>
                <Button variant="outline" onClick={() => void run(true)} disabled={noFile || running}>
                  {busy === "check" ? <Loader2 className="animate-spin" /> : null}
                  Check only
                </Button>
              </Hint>
              <Hint label={noFile ? "Choose a file first" : ASSET_HELP.importRun}>
                <Button onClick={() => void run(false)} disabled={noFile || running}>
                  {busy === "import" ? <Loader2 className="animate-spin" /> : <Upload />}
                  Import
                </Button>
              </Hint>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
