"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Bare workspace root → its Dashboard tab. */
export default function WorkspaceIndex() {
  const router = useRouter();
  const { helpdeskKey } = useParams<{ helpdeskKey: string }>();
  useEffect(() => {
    router.replace(`/agent/w/${helpdeskKey}/dashboard`);
  }, [router, helpdeskKey]);
  return <p className="text-sm text-muted-foreground">Loading…</p>;
}
