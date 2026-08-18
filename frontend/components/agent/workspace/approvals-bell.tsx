"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { agentApprovals } from "@/lib/itsm/nav";
import { usePendingApprovals } from "@/lib/itsm/use-pending-approvals";

/** Header icon: live count of approvals awaiting the current user → approvals inbox. */
export function ApprovalsBell() {
  const { count } = usePendingApprovals();
  const { org = "" } = useParams<{ org: string }>();

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
