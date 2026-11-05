"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { notificationsApi } from "@/lib/itsm/api";
import type { Notification } from "@/lib/itsm/types";
import { useLivePoll } from "@/lib/itsm/use-live-poll";
import { cn } from "@/lib/utils";

const LIST_SIZE = 15;

function when(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** Only in-app paths are followed (the server recomputes each link for the viewer). */
function hrefOf(n: Notification): string | null {
  return n.link && n.link.startsWith("/t/") ? n.link : null;
}

/** One notification row. Module-level (focus stability). Clicking marks it read and,
 *  when it has a ticket, opens it. */
function NotificationItem({ n, onOpen }: { n: Notification; onOpen: (n: Notification) => void }) {
  const href = hrefOf(n);
  const body = (
    <>
      <span className="flex items-start gap-2">
        {!n.is_read ? (
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
        ) : null}
        <span className={cn("text-sm", n.is_read ? "text-foreground/80" : "font-semibold")}>
          {n.title || n.event_type}
          {!n.is_read ? <span className="sr-only"> (unread)</span> : null}
        </span>
      </span>
      {n.body_text ? (
        <span className="block truncate text-xs text-muted-foreground" title={n.body_text}>
          {n.body_text}
        </span>
      ) : null}
      <span className="mt-0.5 block text-[11px] text-muted-foreground">
        {n.ticket_number ? `${n.ticket_number} · ` : ""}
        {when(n.created_at)}
      </span>
    </>
  );
  const cls = cn(
    "block w-full px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
    !n.is_read && "bg-primary/5",
  );
  return (
    <li className="border-b last:border-0">
      {href ? (
        <Link href={href} className={cls} onClick={() => onOpen(n)}>
          {body}
        </Link>
      ) : (
        <button type="button" className={cls} onClick={() => onOpen(n)}>
          {body}
        </button>
      )}
    </li>
  );
}

export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const list = await notificationsApi.list();
      setItems(list.slice(0, LIST_SIZE));
    } catch {
      /* keep what we have */
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Cheap change-token: the unread count. A change refetches the list silently;
  // the hook pauses while the tab is hidden.
  useLivePoll({
    key: "notifications",
    intervalMs: 60_000,
    pulse: async () => {
      const uc = await notificationsApi.unreadCount();
      setUnread(uc.unread ?? 0);
      return String(uc.unread ?? 0);
    },
    onChange: loadList,
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void loadList(); // fresh list; opening no longer marks anything read
  }

  function openItem(n: Notification) {
    if (!n.is_read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      notificationsApi.markRead(n.id).catch(() => {});
    }
    if (hrefOf(n)) setOpen(false);
  }

  async function markAll() {
    setMarking(true);
    try {
      await notificationsApi.markAllRead();
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {
      toast.error("Could not mark your notifications as read.");
    } finally {
      setMarking(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Hint
        side="bottom"
        label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications — your 15 most recent"}
      >
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
      </Hint>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
          <span className="text-sm font-semibold">Notifications</span>
          <Hint
            label={
              marking
                ? "Marking…"
                : unread === 0
                  ? "Nothing unread"
                  : "Marks every notification as read, including older ones not listed here"
            }
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={marking || unread === 0}
              onClick={() => void markAll()}
            >
              Mark all as read
            </Button>
          </Hint>
        </div>
        <ul className="max-h-80 overflow-auto">
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">You’re all caught up.</li>
          ) : (
            items.map((n) => <NotificationItem key={n.id} n={n} onOpen={openItem} />)
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
