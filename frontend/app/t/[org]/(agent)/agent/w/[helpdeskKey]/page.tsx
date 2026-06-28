"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Bare workspace root → its Dashboard tab. */
export default function WorkspaceIndex() {
  const router = useRouter();
  const { org, helpdeskKey } = useParams<{ org: string; helpdeskKey: string }>();
  useEffect(() => {
    router.replace(`/t/${org}/agent/w/${helpdeskKey}/dashboard`);
  }, [router, org, helpdeskKey]);
  return <p className="text-sm text-muted-foreground">Loading…</p>;
}
