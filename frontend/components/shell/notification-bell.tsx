"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { notificationsApi } from "@/lib/itsm/api";
import type { Notification } from "@/lib/itsm/types";

function when(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const [list, uc] = await Promise.all([
        notificationsApi.list(),
        notificationsApi.unreadCount(),
      ]);
      setItems(list.slice(0, 15));
      setUnread(uc.unread ?? 0);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  async function onOpenChange(open: boolean) {
    if (open && unread > 0) {
      try {
        await notificationsApi.markAllRead();
        setUnread(0);
        setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-sm font-semibold">Notifications</div>
        <ul className="max-h-80 overflow-auto">
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">You’re all caught up.</li>
          ) : (
            items.map((n) => (
              <li key={n.id} className="border-b px-3 py-2 last:border-0">
                <p className="text-sm font-medium">{n.title || n.event_type}</p>
                {n.body_text ? <p className="text-xs text-muted-foreground">{n.body_text}</p> : null}
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {n.ticket_number ? `${n.ticket_number} · ` : ""}
                  {when(n.created_at)}
                </p>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
