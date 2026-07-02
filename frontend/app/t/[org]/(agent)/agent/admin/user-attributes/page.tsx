"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { PageHeader } from "@/components/shell/page-header";
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
      <PageHeader
        title="User Attributes"
        description="Custom fields captured on every user. They appear on the create / edit-user form, and as filters and columns on the Users list."
      />
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
