"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox, Loader2, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";

import { inboundEmailsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { InboundEmail, InboundEmailDetail, InboundStatus } from "@/lib/itsm/types";
import { EmptyState } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_STYLES: Record<InboundStatus, string> = {
  processed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ignored: "border-amber-200 bg-amber-50 text-amber-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  received: "border-slate-200 bg-slate-50 text-slate-600",
};

const FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Processed", value: "processed" },
  { label: "Ignored", value: "ignored" },
  { label: "Failed", value: "failed" },
  { label: "Received", value: "received" },
];

function fmt(ts: string | null): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function EmailLogList({ canRetry }: { canRetry: boolean }) {
  const [rows, setRows] = useState<InboundEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<InboundEmailDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    inboundEmailsApi
      .list({ status: status || undefined, search: search || undefined })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [status, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetail(null);
    try {
      setDetail(await inboundEmailsApi.get(id));
    } catch {
      toast.error("Could not load the message.");
    }
  }

  async function retry(id: string) {
    setBusy(true);
    try {
      const updated = await inboundEmailsApi.retry(id);
      setDetail(updated);
      toast.success(`Retried — now ${updated.status}.`);
      load();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Retry failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <Button key={f.value} size="sm" variant={status === f.value ? "default" : "outline"}
              onClick={() => setStatus(f.value)}>
              {f.label}
            </Button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-56 pl-8" placeholder="Search subject / sender…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No inbound messages"
          description="Inbound email that hits a connected mailbox shows up here — whether it created a ticket, added a comment, or was ignored."
        />
      ) : (
        <div className="rounded-xl border shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Ticket</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => openDetail(r.id)}>
                  <TableCell className="max-w-[180px] truncate">{r.from_addr}</TableCell>
                  <TableCell className="max-w-[260px] truncate">{r.subject || "(no subject)"}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_STYLES[r.status]} variant="outline">{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.action_taken || r.ignore_reason || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.ticket_number || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{fmt(r.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="truncate">{detail?.subject || "Message"}</SheetTitle>
            <SheetDescription>Inbound email log entry</SheetDescription>
          </SheetHeader>
          {!detail ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : (
            <div className="space-y-4 py-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={STATUS_STYLES[detail.status]} variant="outline">{detail.status}</Badge>
                {detail.action_taken ? <Badge variant="outline">{detail.action_taken}</Badge> : null}
                {detail.ignore_reason ? <Badge variant="outline">{detail.ignore_reason}</Badge> : null}
                {detail.ticket_number ? <Badge variant="outline">{detail.ticket_number}</Badge> : null}
              </div>
              <dl className="grid grid-cols-3 gap-x-2 gap-y-1">
                <Row label="From" value={`${detail.from_name} <${detail.from_addr}>`} />
                <Row label="To" value={(detail.to_addrs || []).join(", ")} />
                <Row label="Cc" value={(detail.cc_addrs || []).join(", ")} />
                <Row label="Message-ID" value={detail.message_id} />
                <Row label="In-Reply-To" value={detail.in_reply_to || "—"} />
                <Row label="Date" value={fmt(detail.date_header)} />
                <Row label="Size" value={`${Math.round((detail.size_bytes / 1024) * 10) / 10} KB`} />
                <Row label="Attempts" value={String(detail.attempts)} />
                <Row label="Processed" value={fmt(detail.processed_at)} />
              </dl>
              {detail.last_error ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                  {detail.last_error}
                </div>
              ) : null}
              {detail.body_text ? (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Body</p>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-xs">
                    {detail.body_text}
                  </pre>
                </div>
              ) : null}
              {canRetry && detail.status === "failed" ? (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => retry(detail.id)}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                  Retry processing
                </Button>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="col-span-1 text-muted-foreground">{label}</dt>
      <dd className="col-span-2 break-words">{value}</dd>
    </>
  );
}
