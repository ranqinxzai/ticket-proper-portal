"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { Button } from "@/components/ui/button";
import { ItsmApiError } from "@/lib/itsm/client";
import { ticketsApi } from "@/lib/itsm/api";
import type {
  ActivityEvent,
  TicketComment,
  TicketDetail,
  Transition,
} from "@/lib/itsm/types";
import { PriorityTag } from "./priority-tag";
import { StatusBadge } from "./status-badge";

const ACTION_VERB: Record<string, string> = {
  ticket_created: "created the ticket",
  status_changed: "changed status",
  assigned: "changed assignee",
  group_changed: "changed group",
  priority_changed: "changed priority",
  comment_added: "added a comment",
  reopened: "reopened the ticket",
  closed: "closed the ticket",
};

function when(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function TicketDetailView({ ticketId, projectKey }: { ticketId: string; projectKey: string }) {
  const { helpdeskKey } = useWorkspace();
  const base = `/agent/w/${helpdeskKey}/p/${projectKey}`;

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentBody, setCommentBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [t, trs, cs, act] = await Promise.all([
      ticketsApi.get(ticketId),
      ticketsApi.availableTransitions(ticketId),
      ticketsApi.comments(ticketId),
      ticketsApi.activity(ticketId),
    ]);
    setTicket(t);
    setTransitions(trs);
    setComments(cs);
    setActivity(act);
  }, [ticketId]);

  useEffect(() => {
    load()
      .catch(() => toast.error("Could not load ticket."))
      .finally(() => setLoading(false));
  }, [load]);

  async function doTransition(tr: Transition) {
    setBusy(true);
    try {
      await ticketsApi.transition(ticketId, { transition_id: tr.id });
      toast.success(`Moved to “${tr.name}”.`);
      await load();
    } catch (e) {
      const msg = e instanceof ItsmApiError ? e.message : "Transition failed.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setBusy(true);
    try {
      await ticketsApi.addComment(ticketId, { body_html: commentBody, visibility: "public" });
      setCommentBody("");
      await load();
      toast.success("Comment added.");
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not add comment.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading ticket…</p>;
  if (!ticket) return <p className="text-sm text-muted-foreground">Ticket not found.</p>;

  return (
    <div className="space-y-4">
      <Link
        href={base}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to queue
      </Link>

      <div className="flex flex-wrap items-start gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{ticket.ticket_number}</p>
          <h1 className="text-xl font-semibold tracking-tight">{ticket.summary}</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {transitions.map((tr) => (
            <Button key={tr.id} variant="outline" size="sm" disabled={busy} onClick={() => doTransition(tr)}>
              {tr.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* main column */}
        <div className="space-y-6">
          <section aria-label="Description" className="rounded-lg border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Description</h2>
            {ticket.description_html ? (
              <div
                className="prose prose-sm max-w-none dark:prose-invert"
                // server-sanitized via bleach on save
                dangerouslySetInnerHTML={{ __html: ticket.description_html }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No description provided.</p>
            )}
          </section>

          <section aria-label="Comments" className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Comments</h2>
            <ul className="space-y-3">
              {comments.length === 0 ? (
                <li className="text-sm text-muted-foreground">No comments yet.</li>
              ) : (
                comments.map((c) => (
                  <li key={c.id} className="rounded-md border bg-background p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {c.author?.full_name ?? "Someone"}
                      </span>
                      {c.visibility === "private" ? (
                        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning">Internal</span>
                      ) : null}
                      <span>· {when(c.created_at)}</span>
                    </div>
                    <div
                      className="prose prose-sm max-w-none dark:prose-invert"
                      dangerouslySetInnerHTML={{ __html: c.body_html }}
                    />
                  </li>
                ))
              )}
            </ul>
            <form onSubmit={submitComment} className="mt-4 space-y-2">
              <label htmlFor="comment" className="sr-only">
                Add a comment
              </label>
              <textarea
                id="comment"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                rows={3}
                placeholder="Write a public reply…"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={busy || !commentBody.trim()}>
                  Add comment
                </Button>
              </div>
            </form>
          </section>

          <section aria-label="Activity" className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Activity</h2>
            <ul className="space-y-2 text-sm">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-1 text-muted-foreground">
                  <span className="font-medium text-foreground">{a.actor?.full_name ?? "System"}</span>
                  <span>{ACTION_VERB[a.action] ?? a.action}</span>
                  <span>· {when(a.created_at)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* details rail */}
        <aside aria-label="Ticket details" className="space-y-3">
          <dl className="rounded-lg border bg-card p-4 text-sm">
            <Row label="Status">
              <StatusBadge name={ticket.status_name} category={ticket.status_category} color={ticket.status_color} />
            </Row>
            <Row label="Priority">
              <PriorityTag priority={ticket.priority} />
            </Row>
            <Row label="Type">{ticket.ticket_type_name ?? "—"}</Row>
            <Row label="Assignee">{ticket.assignee?.full_name ?? "Unassigned"}</Row>
            <Row label="Group">{ticket.assigned_group_name ?? "—"}</Row>
            <Row label="Requestor">{ticket.requestor?.full_name ?? "—"}</Row>
            <Row label="Workflow">{ticket.workflow_name}</Row>
            <Row label="Created">{when(ticket.created_at)}</Row>
          </dl>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}
