"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Download, Loader2 } from "lucide-react";

import { projectsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { StandardProjectTemplate } from "@/lib/itsm/types";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

/** One catalog row — module-top-level (React focus-stability rule). */
function TemplateRow({
  tpl,
  busyTemplate,
  onImport,
}: {
  tpl: StandardProjectTemplate;
  busyTemplate: string | null;
  onImport: (tpl: StandardProjectTemplate) => void;
}) {
  const busy = busyTemplate === tpl.template;
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: tpl.color, color: readableOn(tpl.color) }}
      >
        <ItsmIcon name={tpl.icon} className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{tpl.name}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {tpl.installed ? tpl.installed_project_key : tpl.key}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{tpl.description}</p>
      </div>
      {tpl.installed ? (
        <Badge variant="secondary" className="gap-1 self-center">
          <Check className="h-3 w-3" aria-hidden="true" /> Enabled
        </Badge>
      ) : (
        <Button
          size="sm"
          className="gap-1 self-center"
          disabled={busyTemplate !== null}
          onClick={() => onImport(tpl)}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          Import
        </Button>
      )}
    </div>
  );
}

/** Import a standard project (Incident / Request / Problem) into this helpdesk.
 *  Lists the catalog with install state; Import provisions the full project
 *  (workflow, fields, layout, notifications, survey — and no SLA for Problem)
 *  server-side, then routes to the new project's settings page. */
export function StandardProjectImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { org, helpdesk, helpdeskKey, refresh } = useWorkspace();

  const [templates, setTemplates] = useState<StandardProjectTemplate[] | null>(null);
  const [busyTemplate, setBusyTemplate] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !helpdesk) return;
    let cancelled = false;
    setTemplates(null);
    projectsApi
      .standardTemplates(helpdesk.id)
      .then((rows) => {
        if (!cancelled) setTemplates(rows);
      })
      .catch(() => {
        if (!cancelled) {
          setTemplates([]);
          toast.error("Could not load the standard project catalog.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, helpdesk]);

  async function importTemplate(tpl: StandardProjectTemplate) {
    if (!helpdesk) return;
    setBusyTemplate(tpl.template);
    try {
      const created = await projectsApi.importStandard({
        helpdesk: helpdesk.id,
        template: tpl.template,
      });
      toast.success(`${tpl.name} project ${created.key} imported.`);
      await refresh();
      onOpenChange(false);
      router.push(`/t/${org}/agent/w/${helpdeskKey}/settings/projects/${created.key}`);
    } catch (err) {
      toast.error(
        err instanceof ItsmApiError ? err.message : "Could not import the project.",
      );
    } finally {
      setBusyTemplate(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import standard project</DialogTitle>
          <DialogDescription>
            Standard ITIL projects come fully configured — workflow, fields, layout and
            notifications — one per helpdesk. Problem projects are agent-only and start
            with no SLA.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {templates === null ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No templates available.</p>
          ) : (
            templates.map((tpl) => (
              <TemplateRow
                key={tpl.template}
                tpl={tpl}
                busyTemplate={busyTemplate}
                onImport={importTemplate}
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
