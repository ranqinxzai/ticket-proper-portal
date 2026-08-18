"use client";

import { useEffect, useState } from "react";

import { approvalsApi } from "./api";
import type { ApprovalRequest } from "./types";

/** Normalise the my-pending payload — the endpoint returns a bare list, but tolerate a
 *  paginated `{ results }` shape too. */
function toList(res: unknown): ApprovalRequest[] {
  if (Array.isArray(res)) return res as ApprovalRequest[];
  const results = (res as { results?: unknown })?.results;
  return Array.isArray(results) ? (results as ApprovalRequest[]) : [];
}

/**
 * Live count + list of approvals awaiting the current user (the `my-pending` inbox),
 * polled on an interval and paused while the tab is hidden. Shared by the agent header
 * bell, the agent Home "needs your attention" card, and the Service Portal nav/home so
 * every surface shows the same pending-approval badge instead of each re-implementing
 * (or, as Home did, omitting) the fetch.
 */
export function usePendingApprovals(intervalMs = 60_000): {
  count: number;
  items: ApprovalRequest[];
  loading: boolean;
} {
  const [items, setItems] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      // Skip the poll while backgrounded; the visibility handler catches up on refocus.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const list = toList(await approvalsApi.myPending());
        if (alive) setItems(list);
      } catch {
        /* best-effort — keep the last-known count on a transient failure */
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    const id = setInterval(load, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);

  return { count: items.length, items, loading };
}
