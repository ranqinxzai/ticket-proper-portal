"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

import { useItsmAuth } from "@/lib/itsm/auth";

/** Bare workspace root → Dashboard for those who can see it, else All Tickets.
 * Agents lack the itsm.dashboard grant, so they'd land on a page not in their
 * nav (and denied server-side) — send them to their ticket queue instead. */
export default function WorkspaceIndex() {
  const router = useRouter();
  const { org, helpdeskKey } = useParams<{ org: string; helpdeskKey: string }>();
  const { loading, hasPerm } = useItsmAuth();
  useEffect(() => {
    if (loading) return;
    const base = `/t/${org}/agent/w/${helpdeskKey}`;
    router.replace(hasPerm("itsm.dashboard", "read") ? `${base}/dashboard` : `${base}/all`);
  }, [router, org, helpdeskKey, loading, hasPerm]);
  return <p className="text-sm text-muted-foreground">Loading…</p>;
}
