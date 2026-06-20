"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Boxes, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { LayoutDesigner } from "@/components/itsm/LayoutDesigner";
import { fieldAdminApi } from "@/lib/itsm/admin-api";
import { projectsApi } from "@/lib/itsm/api";
import type { FieldDefinition, FieldLayoutFull } from "@/lib/itsm/admin-types";
import type { Project, TicketType } from "@/lib/itsm/types";
import { ItsmApiError } from "@/lib/itsm/client";
import { useItsmAuth } from "@/lib/itsm/auth";

export default function FieldsAdminPage() {
  const router = useRouter();
  const { loading: authLoading, hasPerm, isSupervisor } = useItsmAuth();
  const allowed = isSupervisor || hasPerm("itsm.fields.layouts", "read");

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [ticketType, setTicketType] = useState<string>("");

  const [layout, setLayout] = useState<FieldLayoutFull | null>(null);
  const [definitions, setDefinitions] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [noLayout, setNoLayout] = useState(false);

  useEffect(() => {
    if (!authLoading && !allowed) router.replace("/queues");
  }, [authLoading, allowed, router]);

  useEffect(() => {
    if (!allowed) return;
    projectsApi.list().then(setProjects).catch(() => setProjects([]));
  }, [allowed]);

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);
  const ticketTypes: TicketType[] = project?.ticket_types ?? [];

  // Reset ticket type when project changes.
  useEffect(() => {
    setTicketType(ticketTypes[0]?.id ?? "");
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!projectId || !ticketType) {
      setLayout(null);
      setNoLayout(false);
      return;
    }
    setLoading(true);
    setNoLayout(false);
    try {
      const [layouts, defs] = await Promise.all([
        fieldAdminApi.layouts(projectId, ticketType),
        fieldAdminApi.definitions(projectId),
      ]);
      setDefinitions(defs);
      // Prefer a layout bound to this exact ticket type, else any returned.
      const match =
        layouts.find((l) => l.ticket_type === ticketType) ?? layouts[0] ?? null;
      setLayout(match);
      setNoLayout(!match);
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : e instanceof Error ? e.message : "Failed to load layout");
      setLayout(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, ticketType]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  async function createLayout() {
    if (!projectId || !ticketType) return;
    setCreating(true);
    try {
      const ttName = ticketTypes.find((t) => t.id === ticketType)?.name ?? "Layout";
      await fieldAdminApi.createLayout({
        project: projectId,
        ticket_type: ticketType,
        name: `${project?.name ?? ""} · ${ttName}`.trim(),
      });
      toast.success("Layout created");
      await load();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : e instanceof Error ? e.message : "Could not create layout");
    } finally {
      setCreating(false);
    }
  }

  if (authLoading || !allowed) {
    return <div className="grid place-items-center py-20 text-sm text-muted-foreground">Checking access…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/admin" className="text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Boxes className="h-5 w-5 text-indigo-500" />
        <h1 className="text-xl font-semibold">Fields &amp; Layouts</h1>
      </div>

      {/* Selectors */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-3">
        <div className="grid gap-1.5">
          <Label>Project</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Choose a project" /></SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label>Ticket type</Label>
          <Select value={ticketType} onValueChange={setTicketType} disabled={!project}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Choose a type" /></SelectTrigger>
            <SelectContent>
              {ticketTypes.map((tt) => (
                <SelectItem key={tt.id} value={tt.id}>{tt.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Body */}
      {!projectId || !ticketType ? (
        <div className="rounded-lg border bg-white p-10 text-center text-sm text-muted-foreground">
          Select a project and ticket type to design its field layout.
        </div>
      ) : loading ? (
        <div className="grid place-items-center py-20 text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading layout…
        </div>
      ) : noLayout || !layout ? (
        <div className="rounded-lg border bg-white p-10 text-center">
          <p className="text-sm text-muted-foreground">No layout exists for this ticket type yet.</p>
          <Button className="mt-4 gap-1.5" onClick={createLayout} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create layout
          </Button>
        </div>
      ) : (
        <LayoutDesigner layout={layout} definitions={definitions} onRefresh={load} />
      )}
    </div>
  );
}
