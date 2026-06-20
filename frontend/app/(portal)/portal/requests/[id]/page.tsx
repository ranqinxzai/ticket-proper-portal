"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/tickets/status-badge";
import { Button } from "@/components/ui/button";
import { portalApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { PortalComment, PortalTicket } from "@/lib/itsm/types";

function when(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function PortalRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<PortalTicket | null>(null);
  const [comments, setComments] = useState<PortalComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [t, cs] = await Promise.all([portalApi.request(id), portalApi.comments(id)]);
    setTicket(t);
    setComments(cs);
  }, [id]);

  useEffect(() => {
    load()
      .catch(() => toast.error("Could not load this request."))
      .finally(() => setLoading(false));
  }, [load]);

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await portalApi.addComment(id, reply);
      setReply("");
      await load();
      toast.success("Reply sent.");
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not send your reply.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!ticket) return <p className="text-sm text-muted-foreground">Request not found.</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link
        href="/portal/requests"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to my requests
      </Link>

      <div className="flex flex-wrap items-start gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">
            {ticket.ticket_number} · {ticket.helpdesk_name}
          </p>
          <h1 className="text-xl font-semibold tracking-tight">{ticket.summary}</h1>
        </div>
        <span className="ml-auto">
          <StatusBadge name={ticket.status_name} category={ticket.status_category} color={ticket.status_color} />
        </span>
      </div>

      {ticket.description_html ? (
        <div
          className="prose prose-sm max-w-none rounded-lg border bg-card p-4 dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: ticket.description_html }}
        />
      ) : null}

      <section aria-label="Conversation" className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Conversation</h2>
        <ul className="space-y-3">
          {comments.length === 0 ? (
            <li className="text-sm text-muted-foreground">No replies yet.</li>
          ) : (
            comments.map((c) => (
              <li key={c.id} className="rounded-md border bg-background p-3">
                <p className="mb-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{c.author_name ?? "Support"}</span> ·{" "}
                  {when(c.created_at)}
                </p>
                <div
                  className="prose prose-sm max-w-none dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: c.body_html }}
                />
              </li>
            ))
          )}
        </ul>
        <form onSubmit={submitReply} className="mt-4 space-y-2">
          <label htmlFor="reply" className="sr-only">
            Add a reply
          </label>
          <textarea
            id="reply"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder="Add a reply…"
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !reply.trim()}>
              Send reply
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
