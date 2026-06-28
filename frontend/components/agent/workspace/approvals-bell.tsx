"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { approvalsApi } from "@/lib/itsm/api";
import { agentApprovals } from "@/lib/itsm/nav";

/** Header icon: live count of approvals awaiting the current user → approvals inbox. */
export function ApprovalsBell() {
  const [count, setCount] = useState(0);
  const { org = "" } = useParams<{ org: string }>();

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await approvalsApi.myPending();
        const list = Array.isArray(res) ? res : ((res as { results?: unknown[] })?.results ?? []);
        if (alive) setCount(list.length);
      } catch {
        /* ignore — count is best-effort */
      }
    }
    load();
    const t = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <Link
      href={agentApprovals(org)}
      aria-label={count > 0 ? `Pending approvals, ${count}` : "Pending approvals"}
      className="relative grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
        >
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </Link>
  );
}
