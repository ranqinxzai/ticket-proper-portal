"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { Hint } from "@/components/ui/hint";
import { useItsmAuth } from "@/lib/itsm/auth";
import { agentApprovals } from "@/lib/itsm/nav";
import { usePendingApprovals } from "@/lib/itsm/use-pending-approvals";

/** Header icon: live count of approvals awaiting the current user → approvals inbox. */
export function ApprovalsBell() {
  const { count } = usePendingApprovals();
  const { org = "" } = useParams<{ org: string }>();
  const { user, hasPerm } = useItsmAuth();
  // itsm.portal.approvals gates the inbox server-side (2026-10-18); hide the icon
  // for roles without it rather than linking to a 403. No-role users keep it.
  if (user?.role && !hasPerm("itsm.portal.approvals", "read")) return null;

  return (
    <Hint
      side="bottom"
      label={
        count > 0
          ? `Pending approvals (${count}) — open your approvals inbox`
          : "Approvals — nothing waiting for you. Opens your approvals inbox"
      }
    >
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
    </Hint>
  );
}
