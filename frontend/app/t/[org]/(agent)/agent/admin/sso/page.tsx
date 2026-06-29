"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
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
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Authentication &amp; SSO</h1>
        <p className="text-sm text-muted-foreground">
          Let people in this organisation sign in with their Microsoft (Entra) account. You register
          your own app in Microsoft and paste its details here — just like a mailbox.
        </p>
      </div>
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
