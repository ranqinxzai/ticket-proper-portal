"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Bare `assets/` → the Asset Dashboard. */
export default function AssetsIndex() {
  const router = useRouter();
  const { org, helpdeskKey } = useParams<{ org: string; helpdeskKey: string }>();
  useEffect(() => {
    router.replace(`/t/${org}/agent/w/${helpdeskKey}/assets/dashboard`);
  }, [router, org, helpdeskKey]);
  return <p className="text-sm text-muted-foreground">Loading…</p>;
}
