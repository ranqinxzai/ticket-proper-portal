"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { notificationsApi } from "@/lib/itsm/api";
import type { Notification } from "@/lib/itsm/types";
import { relTime } from "./ticket-bits";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;

export function NotificationBell() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const r = await notificationsApi.unreadCount();
      setCount(r?.unread ?? 0);
    } catch {
      /* endpoint may be unavailable (planned) — fail quiet */
    }
  }, []);

  // Poll the unread count.
  useEffect(() => {
    refreshCount();
    timer.current = setInterval(refreshCount, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refreshCount]);

  // Load the inbox when the popover opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    notificationsApi
      .list(false)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function openItem(n: Notification) {
    if (!n.is_read) {
      try {
        await notificationsApi.markRead(n.id);
        setItems((rows) => rows.map((r) => (r.id === n.id ? { ...r, is_read: true } : r)));
        setCount((c) => Math.max(0, c - 1));
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
    if (n.ticket_number) router.push(`/tickets/${n.ticket_number}`);
  }

  async function markAll() {
    try {
      await notificationsApi.markAllRead();
      setItems((rows) => rows.map((r) => ({ ...r, is_read: true })));
      setCount(0);
    } catch {
      /* ignore */
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {items.some((i) => !i.is_read) && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={markAll}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">You&apos;re all caught up.</div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 border-b px-3 py-2.5 text-left last:border-0 hover:bg-muted/60",
                  !n.is_read && "bg-indigo-50/60",
                )}
              >
                <div className="flex w-full items-center gap-2">
                  {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-500" />}
                  <span className="flex-1 truncate text-sm font-medium">
                    {n.title || n.event_type || n.ticket_number || "Notification"}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{relTime(n.created_at)}</span>
                </div>
                {n.body_text && (
                  <span className="line-clamp-2 text-xs text-muted-foreground">{n.body_text}</span>
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
