"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useItsmAuth } from "@/lib/itsm/auth";
import { useCanAuthorKb } from "@/lib/itsm/kb-perms";
import { agentHome } from "@/lib/itsm/nav";

/** Gate the whole `/agent/kb` subtree on authoring permission once (pages don't
 *  re-check). Pure requestors are already bounced to the portal by AgentGuard. */
export default function KbLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { loading, org } = useItsmAuth();
  const canAuthor = useCanAuthorKb();

  useEffect(() => {
    if (!loading && !canAuthor) router.replace(agentHome(org));
  }, [loading, canAuthor, org, router]);

  if (loading || !canAuthor) return null;
  return <>{children}</>;
}
