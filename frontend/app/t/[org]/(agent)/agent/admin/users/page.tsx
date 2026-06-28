"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { UsersList } from "@/components/settings/users-list";

/** Org-wide user management, inside the Tenant Settings hub. Users are shared
 * across the whole org, so this lives at the tenant level (not a workspace). */
export default function AdminUsersPage() {
  const { hasPerm } = useItsmAuth();
  const canRead = hasPerm("itsm.admin.roles", "read");
  const canManage =
    hasPerm("itsm.admin.roles", "create") || hasPerm("itsm.admin.roles", "update");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Everyone in this organisation, their ITSM role, and the helpdesks they belong to.
        </p>
      </div>
      {canRead ? (
        <>
          {!canManage ? <ReadOnlyBanner /> : null}
          <UsersList canManage={canManage} />
        </>
      ) : (
        <ReadOnlyBanner message="You don't have access to user management." />
      )}
    </div>
  );
}
