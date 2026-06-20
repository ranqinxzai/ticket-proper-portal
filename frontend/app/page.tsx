"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { homePathFor } from "@/lib/itsm/auth";
import { tokenStore } from "@/lib/itsm/client";
import type { ItsmUser } from "@/lib/itsm/types";

/** Role-aware entry point: send agents to /agent, requestors to /portal, anon to /login. */
export default function RootRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!tokenStore.access) {
      router.replace("/login");
      return;
    }
    const cached = tokenStore.getUser<ItsmUser>();
    // Default to /agent when the role is unknown; AgentGuard re-routes pure requestors.
    router.replace(cached ? homePathFor(cached) : "/agent");
  }, [router]);

  return (
    <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}
