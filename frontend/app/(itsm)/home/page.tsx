"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Loader2, UserCheck, Timer, ArrowRight } from "lucide-react";

import { ticketsApi, notificationsApi } from "@/lib/itsm/api";
import { useItsmAuth } from "@/lib/itsm/auth";
import { useSelectedHelpdesk } from "@/lib/itsm/helpdesk";
import type { Helpdesk, Notification, TicketListItem } from "@/lib/itsm/types";
import { PriorityIcon, StatusBadge, RagPill, ragFromDue, relTime } from "@/components/itsm/ticket-bits";
import { cn } from "@/lib/utils";

// ── Home: pick a helpdesk (left) + "needs your attention" (right) ───────────
export default function HomePage() {
  const { helpdesks } = useSelectedHelpdesk();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Which helpdesk do you need?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a workspace to work its Incident and Request queues.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <section>
          {helpdesks.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-muted-foreground">
              You&apos;re not a member of any helpdesk yet. Ask an administrator to add you.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {helpdesks.map((h) => (
                <HelpdeskCard key={h.id} helpdesk={h} />
              ))}
            </div>
          )}
        </section>

        <AttentionPanel />
      </div>
    </div>
  );
}

function HelpdeskCard({ helpdesk }: { helpdesk: Helpdesk }) {
  const router = useRouter();
  const { setSelected } = useSelectedHelpdesk();
  const color = helpdesk.color || "#6366f1";

  function open() {
    setSelected(helpdesk.key);
    router.push("/queues");
  }

  return (
    <button
      onClick={open}
      className="group flex flex-col rounded-xl border bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-sm font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {helpdesk.key}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{helpdesk.name}</div>
          {typeof helpdesk.member_count === "number" && (
            <div className="text-xs text-muted-foreground">{helpdesk.member_count} member{helpdesk.member_count === 1 ? "" : "s"}</div>
          )}
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      {helpdesk.description && (
        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{helpdesk.description}</p>
      )}
    </button>
  );
}

// ── Attention panel ─────────────────────────────────────────────────────────
function AttentionPanel() {
  return (
    <aside className="space-y-4 rounded-xl border bg-white p-4">
      <h2 className="text-sm font-semibold">Needs your attention</h2>
      <AssignedToMe />
      <SlaAtRisk />
      <UnreadNotifications />
    </aside>
  );
}

function PanelSection({
  icon: Icon, title, count, children,
}: {
  icon: typeof Bell; title: string; count?: number; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{title}</span>
        {typeof count === "number" && count > 0 && (
          <span className="ml-auto rounded-full bg-indigo-100 px-1.5 text-[11px] font-semibold text-indigo-700">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function TicketRow({ t }: { t: TicketListItem }) {
  const router = useRouter();
  const rag = ragFromDue(t.due_date);
  return (
    <button
      onClick={() => router.push(`/tickets/${t.ticket_number}`)}
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/60"
    >
      <PriorityIcon priority={t.priority} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{t.summary}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-mono text-indigo-600">{t.ticket_number}</span>
          <StatusBadge name={t.status_name} color={t.status_color} />
        </div>
      </div>
      {t.due_date && <RagPill rag={rag.rag} label={rag.label} />}
    </button>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="px-1.5 py-1 text-xs text-muted-foreground">{text}</p>;
}

function AssignedToMe() {
  const { user } = useItsmAuth();
  const [rows, setRows] = useState<TicketListItem[] | null>(null);

  useEffect(() => {
    if (!user) return;
    ticketsApi
      .list({ assignee: String(user.id), ordering: "-updated_at" })
      .then((r) => setRows(r.results.slice(0, 6)))
      .catch(() => setRows([]));
  }, [user]);

  return (
    <PanelSection icon={UserCheck} title="Assigned to me" count={rows?.length}>
      {rows === null ? <Loader /> : rows.length === 0 ? (
        <EmptyHint text="Nothing assigned to you." />
      ) : rows.map((t) => <TicketRow key={t.id} t={t} />)}
    </PanelSection>
  );
}

function SlaAtRisk() {
  const [rows, setRows] = useState<TicketListItem[] | null>(null);

  useEffect(() => {
    // No dedicated at-risk endpoint yet — approximate from due_date (amber/red),
    // excluding done tickets. (A real SLATracker-backed list is a future phase.)
    ticketsApi
      .list({ ordering: "due_date" })
      .then((r) => {
        const atRisk = r.results
          .filter((t) => t.status_category !== "done" && t.due_date)
          .filter((t) => ["amber", "red"].includes(ragFromDue(t.due_date).rag))
          .slice(0, 6);
        setRows(atRisk);
      })
      .catch(() => setRows([]));
  }, []);

  return (
    <PanelSection icon={Timer} title="SLA at risk" count={rows?.length}>
      {rows === null ? <Loader /> : rows.length === 0 ? (
        <EmptyHint text="No tickets breaching soon." />
      ) : rows.map((t) => <TicketRow key={t.id} t={t} />)}
    </PanelSection>
  );
}

function UnreadNotifications() {
  const router = useRouter();
  const [rows, setRows] = useState<Notification[] | null>(null);

  useEffect(() => {
    notificationsApi
      .list(true)
      .then((r) => setRows(r.slice(0, 6)))
      .catch(() => setRows([]));
  }, []);

  return (
    <PanelSection icon={Bell} title="Unread notifications" count={rows?.length}>
      {rows === null ? <Loader /> : rows.length === 0 ? (
        <EmptyHint text="You're all caught up." />
      ) : rows.map((n) => (
        <button
          key={n.id}
          onClick={() => n.ticket_number && router.push(`/tickets/${n.ticket_number}`)}
          className={cn(
            "flex w-full flex-col items-start gap-0.5 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/60",
            !n.is_read && "bg-indigo-50/50",
          )}
        >
          <span className="truncate text-sm font-medium">{n.title || n.event_type || "Notification"}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {n.ticket_number && <span className="font-mono text-indigo-600">{n.ticket_number}</span>}
            <span>{relTime(n.created_at)}</span>
          </span>
        </button>
      ))}
    </PanelSection>
  );
}

function Loader() {
  return (
    <div className="flex items-center gap-2 px-1.5 py-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
    </div>
  );
}
