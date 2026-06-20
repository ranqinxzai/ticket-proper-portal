"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ListChecks, Loader2, RefreshCw, RotateCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";

import { emailAdminApi } from "@/lib/itsm/admin-api";
import { INBOUND_STATUSES } from "@/lib/itsm/admin-types";
import type { EmailChannel, InboundEmail, InboundEmailDetail, InboundStatus } from "@/lib/itsm/admin-types";
import { ItsmApiError } from "@/lib/itsm/client";
import { useItsmAuth } from "@/lib/itsm/auth";

const STATUS_STYLES: Record<InboundStatus, string> = {
  processed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ignored: "border-amber-200 bg-amber-50 text-amber-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  received: "border-slate-200 bg-slate-50 text-slate-600",
};

const STATUS_LABELS: Record<string, string> = {
  processed: "Processed",
  ignored: "Ignored",
  failed: "Failed",
  received: "Received",
};

const ACTION_LABELS: Record<string, string> = {
  created_ticket: "Created ticket",
  added_comment: "Added comment",
  "": "",
};

const ALL_CHANNELS = "__all__";

function errMessage(e: unknown, fallback: string): string {
  if (e instanceof ItsmApiError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

function StatusBadge({ status }: { status: InboundStatus }) {
  return (
    <span className={"inline-block rounded-full border px-2 py-0.5 text-xs font-medium " + (STATUS_STYLES[status] ?? STATUS_STYLES.received)}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function EmailLogsPage() {
  const router = useRouter();
  const { loading: authLoading, hasPerm, isSupervisor } = useItsmAuth();
  const allowed = isSupervisor || hasPerm("itsm.email.logs", "read");

  const [rows, setRows] = useState<InboundEmail[]>([]);
  const [channels, setChannels] = useState<EmailChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<InboundStatus | "all">("all");
  const [channelFilter, setChannelFilter] = useState<string>(ALL_CHANNELS);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [detail, setDetail] = useState<InboundEmailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!authLoading && !allowed) router.replace("/queues");
  }, [authLoading, allowed, router]);

  const channelName = useCallback(
    (id: string | null) => (id ? channels.find((c) => c.id === id)?.name ?? "—" : "—"),
    [channels],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await emailAdminApi.logs.list({
        status: statusFilter === "all" ? undefined : statusFilter,
        channel: channelFilter === ALL_CHANNELS ? undefined : channelFilter,
        search: search || undefined,
      });
      setRows(list);
    } catch (e) {
      setError(errMessage(e, "Failed to load email logs"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, channelFilter, search]);

  // Channels list for the filter dropdown (load once).
  useEffect(() => {
    if (!allowed) return;
    emailAdminApi.channels
      .list()
      .then(setChannels)
      .catch(() => setChannels([]));
  }, [allowed]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  async function openDetail(id: string) {
    setDetailLoading(true);
    try {
      const d = await emailAdminApi.logs.get(id);
      setDetail(d);
    } catch (e) {
      toast.error(errMessage(e, "Could not load message"));
    } finally {
      setDetailLoading(false);
    }
  }

  async function retry(id: string) {
    setRetrying(true);
    try {
      const updated = await emailAdminApi.logs.retry(id);
      toast.success("Retry queued");
      setDetail(updated);
      await load();
    } catch (e) {
      toast.error(errMessage(e, "Retry failed"));
    } finally {
      setRetrying(false);
    }
  }

  const statusPills = useMemo<(InboundStatus | "all")[]>(
    () => ["all", ...INBOUND_STATUSES],
    [],
  );

  if (authLoading || !allowed) {
    return <div className="grid place-items-center py-20 text-sm text-muted-foreground">Checking access…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/admin/email" className="text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <ListChecks className="h-5 w-5 text-indigo-500" />
        <h1 className="text-xl font-semibold">Email Logs</h1>
        <Button size="sm" variant="outline" className="ml-auto gap-1.5" onClick={() => load()} disabled={loading}>
          <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {statusPills.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={
                "rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize transition-colors " +
                (statusFilter === s
                  ? "border-indigo-500 bg-indigo-500 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600")
              }
            >
              {s === "all" ? "All" : STATUS_LABELS[s] ?? s}
            </button>
          ))}
        </div>

        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="h-8 w-[200px]"><SelectValue placeholder="All channels" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CHANNELS}>All channels</SelectItem>
            {channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            placeholder="Search subject / sender…"
            className="h-8 w-[240px] pl-8"
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setSearch(searchInput.trim()); }}
          />
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={() => setSearch(searchInput.trim())}>
          Search
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="grid place-items-center py-20 text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-destructive">{error}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-white p-12 text-center text-sm text-muted-foreground">
          No inbound emails match the current filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Ticket</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => openDetail(r.id)}
                >
                  <TableCell className="max-w-[200px]">
                    <div className="truncate font-medium">{r.from_name || r.from_addr}</div>
                    {r.from_name && <div className="truncate text-xs text-muted-foreground">{r.from_addr}</div>}
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <span className="line-clamp-1">{r.subject || <span className="text-muted-foreground">(no subject)</span>}</span>
                  </TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.action_taken ? ACTION_LABELS[r.action_taken] : r.ignore_reason || "—"}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {r.ticket_number ? (
                      <Link href={`/tickets/${r.ticket_number}`} className="text-indigo-600 hover:underline">
                        {r.ticket_number}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail drawer */}
      <Sheet open={Boolean(detail) || detailLoading} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
          {detailLoading && !detail ? (
            <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : detail ? (
            <>
              <SheetHeader className="border-b p-4">
                <SheetTitle className="pr-6 text-base">{detail.subject || "(no subject)"}</SheetTitle>
                <SheetDescription asChild>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <StatusBadge status={detail.status} />
                    {detail.action_taken && <Badge variant="outline">{ACTION_LABELS[detail.action_taken]}</Badge>}
                    {detail.ticket_number && (
                      <Link href={`/tickets/${detail.ticket_number}`} className="text-xs text-indigo-600 hover:underline">
                        {detail.ticket_number}
                      </Link>
                    )}
                  </div>
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 space-y-4 p-4 text-sm">
                <DetailGrid detail={detail} channelName={channelName(detail.channel)} />

                {detail.last_error && (
                  <Block title="Last error">
                    <pre className="whitespace-pre-wrap break-words text-xs text-destructive">{detail.last_error}</pre>
                  </Block>
                )}

                {detail.ignore_reason && (
                  <Block title="Ignore reason">
                    <p className="text-xs text-muted-foreground">{detail.ignore_reason}</p>
                  </Block>
                )}

                <Block title="Body">
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-slate-50 p-3 text-xs">
                    {detail.body_text || "(empty)"}
                  </pre>
                </Block>

                {detail.comment && (
                  <Block title="Comment posted">
                    <pre className="whitespace-pre-wrap break-words rounded-md border bg-slate-50 p-3 text-xs">{detail.comment}</pre>
                  </Block>
                )}

                <Block title="Headers">
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-slate-50 p-3 font-mono text-[11px]">
                    {JSON.stringify(detail.headers ?? {}, null, 2)}
                  </pre>
                </Block>
              </div>

              <div className="flex items-center gap-2 border-t p-4">
                {detail.status === "failed" && (
                  <Button size="sm" className="gap-1.5" disabled={retrying} onClick={() => retry(detail.id)}>
                    <RotateCw className={"h-4 w-4 " + (retrying ? "animate-spin" : "")} /> Retry
                  </Button>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {detail.attempts} attempt{detail.attempts === 1 ? "" : "s"}
                </span>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="break-words text-xs">{value}</span>
    </div>
  );
}

function DetailGrid({ detail, channelName }: { detail: InboundEmailDetail; channelName: string }) {
  return (
    <div className="space-y-1.5 rounded-md border p-3">
      <Row label="From" value={detail.from_name ? `${detail.from_name} <${detail.from_addr}>` : detail.from_addr} />
      <Row label="To" value={detail.to_addrs?.join(", ")} />
      <Row label="Cc" value={detail.cc_addrs?.join(", ")} />
      <Row label="Channel" value={channelName} />
      <Row label="Message-ID" value={<span className="font-mono">{detail.message_id}</span>} />
      <Row label="In-Reply-To" value={detail.in_reply_to ? <span className="font-mono">{detail.in_reply_to}</span> : null} />
      <Row label="Date" value={detail.date_header} />
      <Row label="Size" value={detail.size_bytes ? `${detail.size_bytes.toLocaleString()} bytes` : null} />
      <Row label="Received" value={new Date(detail.created_at).toLocaleString()} />
      <Row label="Processed" value={detail.processed_at ? new Date(detail.processed_at).toLocaleString() : null} />
      <Row label="Next attempt" value={detail.next_attempt_at ? new Date(detail.next_attempt_at).toLocaleString() : null} />
    </div>
  );
}
