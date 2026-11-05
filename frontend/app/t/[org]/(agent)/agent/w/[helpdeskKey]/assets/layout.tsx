"use client";

import { Boxes, Loader2 } from "lucide-react";

import { EmptyState } from "@/components/shell/empty-state";
import { useItsmAuth } from "@/lib/itsm/auth";
import { ASSETS_MODULE } from "@/lib/itsm/asset-perms";

/** Asset Management is gated on `itsm.assets` read (the sidebar hides the section too;
 *  the API enforces it independently). */
export default function AssetsLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, hasPerm } = useItsmAuth();
  if (loading || !user) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </p>
    );
  }
  if (!hasPerm(ASSETS_MODULE, "read")) {
    return (
      <EmptyState
        icon={Boxes}
        title="You don't have access to Assets"
        description="Your role doesn't include Assets → Read. Ask an administrator to add it in Tenant Settings → Roles & Permissions."
      />
    );
  }
  return <>{children}</>;
}
