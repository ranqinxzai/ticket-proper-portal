"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ItsmApiError } from "@/lib/itsm/client";
import { ticketsApi } from "@/lib/itsm/api";
import type { Priority, Project } from "@/lib/itsm/types";

const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];
const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function TicketCreateForm({ project }: { project: Project }) {
  const router = useRouter();
  const { helpdeskKey } = useWorkspace();
  const defaultType = project.ticket_types.find((t) => t.is_default) ?? project.ticket_types[0];

  const summaryId = useId();
  const typeId = useId();
  const prioId = useId();
  const descId = useId();

  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [ticketType, setTicketType] = useState(defaultType?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!summary.trim() || !ticketType) return;
    setBusy(true);
    try {
      const t = await ticketsApi.create({
        project: project.id,
        ticket_type: ticketType,
        summary: summary.trim(),
        description_html: description,
        priority,
        source: "agent",
      });
      toast.success(`Created ${t.ticket_number}.`);
      router.push(`/agent/w/${helpdeskKey}/p/${project.key}/${t.id}`);
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not create the ticket.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor={summaryId}>Summary</Label>
        <Input
          id={summaryId}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          required
          maxLength={500}
          autoFocus
          placeholder="Short, specific title"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={typeId}>Type</Label>
          <select
            id={typeId}
            value={ticketType}
            onChange={(e) => setTicketType(e.target.value)}
            className={selectCls}
          >
            {project.ticket_types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={prioId}>Priority</Label>
          <select
            id={prioId}
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            className={selectCls}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={descId}>Description</Label>
        <textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          placeholder="What happened? Steps, impact, anything useful."
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !summary.trim()}>
          {busy ? "Creating…" : "Create ticket"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
