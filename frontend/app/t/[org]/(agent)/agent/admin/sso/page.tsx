"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { PageHeader } from "@/components/shell/page-header";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { SsoConfigForm } from "@/components/admin/sso-config-form";

/** Org-wide authentication settings (Tenant Settings hub). Lets a tenant admin
 *  turn on "Sign in with Microsoft" using their own Entra app registration. */
export default function AdminSsoPage() {
  const { hasPerm, isSupervisor } = useItsmAuth();
  const canRead = isSupervisor || hasPerm("itsm.admin.sso", "read");
  const canManage =
    isSupervisor || hasPerm("itsm.admin.sso", "create") || hasPerm("itsm.admin.sso", "update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Authentication & SSO"
        description="Let people in this organisation sign in with their Microsoft (Entra) account. You register your own app in Microsoft and paste its details here — just like a mailbox."
      />
      {canRead ? (
        <>
          {!canManage ? <ReadOnlyBanner /> : null}
          <SsoConfigForm canManage={canManage} />
        </>
      ) : (
        <ReadOnlyBanner message="You don't have access to authentication settings." />
      )}
    </div>
  );
}
