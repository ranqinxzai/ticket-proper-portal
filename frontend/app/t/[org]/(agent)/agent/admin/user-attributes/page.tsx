"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { UserAttributesEditor } from "@/components/settings/user-attributes-editor";

/** Org-wide custom user attributes, inside the Tenant Settings hub. Gated by the
 * same module as Users (`itsm.admin.roles`). */
export default function AdminUserAttributesPage() {
  const { hasPerm } = useItsmAuth();
  const canRead = hasPerm("itsm.admin.roles", "read");
  const canManage =
    hasPerm("itsm.admin.roles", "create") || hasPerm("itsm.admin.roles", "update");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">User Attributes</h1>
        <p className="text-sm text-muted-foreground">
          Custom fields captured on every user. They appear on the create / edit-user form, and as
          filters and columns on the Users list.
        </p>
      </div>
      {canRead ? (
        <>
          {!canManage ? <ReadOnlyBanner /> : null}
          <UserAttributesEditor canManage={canManage} />
        </>
      ) : (
        <ReadOnlyBanner message="You don't have access to user management." />
      )}
    </div>
  );
}
