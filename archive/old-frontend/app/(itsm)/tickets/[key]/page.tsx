"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { ticketsApi, usersApi, groupsApi } from "@/lib/itsm/api";
import { itsmClient } from "@/lib/itsm/client";
import { useItsmAuth } from "@/lib/itsm/auth";
import type {
  AccountUser, Group, Priority, TicketDetail, Transition, UserRef, Watcher,
} from "@/lib/itsm/types";
import {
  PriorityIcon, StatusBadge, UserPill, initials, priorityLabel, PRIORITIES, relTime,
} from "@/components/itsm/ticket-bits";
import { CommentSection } from "@/components/itsm/CommentSection";
import { ItsmActivityFeed } from "@/components/itsm/ItsmActivityFeed";
import { SlaPanel } from "@/components/itsm/SlaPanel";
import { TransitionDialog } from "@/components/itsm/TransitionDialog";

export default function TicketDetailPage() {
  const params = useParams<{ key: string }>();
  const router = useRouter();
  const { user } = useItsmAuth();
  const ticketKey = decodeURIComponent(params.key);

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);

  const [activeTransition, setActiveTransition] = useState<Transition | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadTicket = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const t = await ticketsApi.getByNumber(ticketKey);
      if (!t) {
        setError(`Ticket ${ticketKey} not found.`);
        setTicket(null);
        return;
      }
      setTicket(t);
      // Fan-out the dependent loads.
      ticketsApi.availableTransitions(t.id).then(setTransitions).catch(() => setTransitions([]));
      ticketsApi.watchers(t.id).then(setWatchers).catch(() => setWatchers([]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ticket");
    } finally {
      setLoading(false);
    }
  }, [ticketKey]);

  useEffect(() => {
    loadTicket();
  }, [loadTicket]);

  useEffect(() => {
    usersApi.list().then(setUsers).catch(() => setUsers([]));
    groupsApi.list().then(setGroups).catch(() => setGroups([]));
  }, []);

  function applyUpdate(updated: TicketDetail) {
    setTicket(updated);
    ticketsApi.availableTransitions(updated.id).then(setTransitions).catch(() => {});
  }

  async function changeAssignee(assigneeId: string | null) {
    if (!ticket) return;
    try {
      const updated = await ticketsApi.assign(ticket.id, assigneeId, ticket.assigned_group);
      applyUpdate(updated);
      toast.success("Assignee updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign");
    }
  }

  async function changeGroup(groupId: string | null) {
    if (!ticket) return;
    try {
      const updated = await ticketsApi.assign(ticket.id, ticket.assignee?.id ? String(ticket.assignee.id) : null, groupId);
      applyUpdate(updated);
      toast.success("Group updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to set group");
    }
  }

  async function changePriority(priority: Priority) {
    if (!ticket) return;
    try {
      const patched = await itsmClient.patch<TicketDetail>(`/tickets/${ticket.id}/`, { priority });
      setTicket(patched);
      toast.success(`Priority set to ${priorityLabel(priority)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to set priority");
    }
  }

  const isWatching = Boolean(user && watchers.some((w) => String(w.user.id) === String(user.id)));

  async function toggleWatch() {
    if (!ticket) return;
    try {
      if (isWatching) {
        await ticketsApi.unwatch(ticket.id);
      } else {
        await ticketsApi.watch(ticket.id);
      }
      const fresh = await ticketsApi.watchers(ticket.id);
      setWatchers(fresh);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update watch");
    }
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-sm text-muted-foreground">
        <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading ticket…</span>
      </div>
    );
  }
  if (error || !ticket) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.push("/queues")}>
          <ArrowLeft className="h-4 w-4" /> Back to queue
        </Button>
        <div className="rounded-lg border bg-white p-8 text-center text-destructive">{error || "Ticket not found"}</div>
      </div>
    );
  }

  const customFields = ticket.custom_fields && Object.keys(ticket.custom_fields).length > 0 ? ticket.custom_fields : null;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/queues")} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="font-mono text-sm font-semibold text-indigo-600">{ticket.ticket_number}</span>
          <span className="truncate text-lg font-semibold">{ticket.summary}</span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-1.5" disabled={transitions.length === 0}>
              Transition <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {transitions.length === 0 && <DropdownMenuItem disabled>No transitions</DropdownMenuItem>}
            {transitions.map((tr) => (
              <DropdownMenuItem
                key={tr.id}
                onClick={() => {
                  setActiveTransition(tr);
                  setDialogOpen(true);
                }}
              >
                {tr.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* LEFT pane */}
        <div className="space-y-4">
          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Description</h2>
            {ticket.description_html ? (
              <div
                className="prose prose-sm max-w-none [&_a]:text-indigo-600 [&_a]:underline [&_ul]:list-disc [&_ol]:list-decimal"
                dangerouslySetInnerHTML={{ __html: ticket.description_html }}
              />
            ) : (
              <p className="text-sm italic text-muted-foreground">No description.</p>
            )}
          </section>

          <section className="rounded-lg border bg-white p-4">
            <Tabs defaultValue="comments">
              <TabsList>
                <TabsTrigger value="comments">Comments</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
                <TabsTrigger value="sla">SLA</TabsTrigger>
              </TabsList>
              <TabsContent value="comments" className="pt-4">
                <CommentSection ticketId={ticket.id} />
              </TabsContent>
              <TabsContent value="history" className="pt-4">
                <ItsmActivityFeed ticketId={ticket.id} />
              </TabsContent>
              <TabsContent value="sla" className="pt-4">
                <SlaPanel ticketId={ticket.id} />
              </TabsContent>
            </Tabs>
          </section>
        </div>

        {/* RIGHT pane — fields panel */}
        <aside className="space-y-3">
          <div className="rounded-lg border bg-white p-4">
            <FieldRow label="Status">
              <StatusBadge name={ticket.status_name} color={ticket.status_color} />
            </FieldRow>

            <FieldRow label="Assignee">
              <Select
                value={ticket.assignee?.id ? String(ticket.assignee.id) : "none"}
                onValueChange={(v) => changeAssignee(v === "none" ? null : v)}
              >
                <SelectTrigger className="h-8 w-full"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.full_name || u.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>

            <FieldRow label="Group">
              <Select
                value={ticket.assigned_group ?? "none"}
                onValueChange={(v) => changeGroup(v === "none" ? null : v)}
              >
                <SelectTrigger className="h-8 w-full"><SelectValue placeholder="No group" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">No group</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>

            <FieldRow label="Priority">
              <Select value={ticket.priority} onValueChange={(v) => changePriority(v as Priority)}>
                <SelectTrigger className="h-8 w-full">
                  <span className="flex items-center gap-1.5"><PriorityIcon priority={ticket.priority} /> {priorityLabel(ticket.priority)}</span>
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      <span className="flex items-center gap-1.5"><PriorityIcon priority={p} /> {priorityLabel(p)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>

            <FieldRow label="Requestor">
              <span className="text-sm"><UserRefText user={ticket.requestor} /></span>
            </FieldRow>

            <FieldRow label="Type">
              <span className="text-sm text-muted-foreground">{ticket.ticket_type_name || "—"}</span>
            </FieldRow>

            <FieldRow label="Updated">
              <span className="text-sm text-muted-foreground">{relTime(ticket.updated_at)}</span>
            </FieldRow>
          </div>

          {/* SLA widget */}
          <div className="rounded-lg border bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">SLA</h3>
            <SlaPanel ticketId={ticket.id} compact />
          </div>

          {/* Watchers */}
          <div className="rounded-lg border bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">Watchers ({watchers.length})</h3>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={toggleWatch}>
                {isWatching ? <><EyeOff className="h-3.5 w-3.5" /> Unwatch</> : <><Eye className="h-3.5 w-3.5" /> Watch</>}
              </Button>
            </div>
            {watchers.length === 0 ? (
              <p className="text-xs text-muted-foreground">No watchers yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {watchers.map((w) => (
                  <span
                    key={w.id}
                    title={w.user.full_name || w.user.username}
                    className="grid h-7 w-7 place-items-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700"
                  >
                    {initials(w.user.full_name || w.user.username)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Custom fields */}
          {customFields && (
            <div className="rounded-lg border bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Custom fields</h3>
              <dl className="space-y-2">
                {Object.entries(customFields).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 text-sm">
                    <dt className="capitalize text-muted-foreground">{k.replace(/_/g, " ")}</dt>
                    <dd className="text-right font-medium">{formatValue(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </aside>
      </div>

      <TransitionDialog
        ticketId={ticket.id}
        transition={activeTransition}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onDone={applyUpdate}
        onStale={loadTicket}
      />
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="grid grid-cols-[88px_1fr] items-center gap-2 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="min-w-0">{children}</div>
      </div>
      <Separator className="last:hidden" />
    </>
  );
}

function UserRefText({ user }: { user: UserRef | null }) {
  if (!user) return <span className="text-muted-foreground">—</span>;
  return <UserPill user={user} />;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
