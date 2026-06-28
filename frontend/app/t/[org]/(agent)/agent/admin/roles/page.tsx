"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { RolesList } from "@/components/settings/roles-list";

/** Org-wide roles & permissions, inside the Tenant Settings hub. Roles are shared
 * across all helpdesks, so this lives at the tenant level (not a workspace). */
export default function AdminRolesPage() {
  const { hasPerm } = useItsmAuth();
  const canRead = hasPerm("itsm.admin.roles", "read");
  const canManage =
    hasPerm("itsm.admin.roles", "create") || hasPerm("itsm.admin.roles", "update");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Roles &amp; Permissions</h1>
        <p className="text-sm text-muted-foreground">
          Each role grants read / create / update / delete across the permission modules. The three
          built-in roles can be re-scoped but not deleted; add custom roles as needed.
        </p>
      </div>
      {canRead ? (
        <>
          {!canManage ? <ReadOnlyBanner /> : null}
          <RolesList canManage={canManage} />
        </>
      ) : (
        <ReadOnlyBanner message="You don't have access to role management." />
      )}
    </div>
  );
}
