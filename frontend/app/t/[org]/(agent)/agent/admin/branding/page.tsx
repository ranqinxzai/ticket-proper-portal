"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { PageHeader } from "@/components/shell/page-header";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { BrandingConfigForm } from "@/components/admin/branding-config-form";

/** Org-wide white-label branding (Tenant Settings hub). Define the client name,
 *  logo and contact details used on the login page and printed tickets. */
export default function AdminBrandingPage() {
  const { hasPerm, isSupervisor } = useItsmAuth();
  const canRead = isSupervisor || hasPerm("itsm.admin.branding", "read");
  const canManage =
    isSupervisor ||
    hasPerm("itsm.admin.branding", "create") ||
    hasPerm("itsm.admin.branding", "update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branding"
        description="White-label this organisation: set the client name and logo shown on the login page and printed tickets, plus contact details."
      />
      {canRead ? (
        <>
          {!canManage ? <ReadOnlyBanner /> : null}
          <BrandingConfigForm canManage={canManage} />
        </>
      ) : (
        <ReadOnlyBanner message="You don't have access to branding settings." />
      )}
    </div>
  );
}
