"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { INTERFACE_HELP } from "@/lib/itsm/help/admin";
import { PageHeader } from "@/components/shell/page-header";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { InterfaceConfigForm } from "@/components/admin/interface-config-form";

/** Org-wide Classic / Modern policy (Tenant Settings hub, 2026-11-05). */
export default function AdminInterfacePage() {
  const { hasPerm, isSupervisor } = useItsmAuth();
  const canRead = isSupervisor || hasPerm("itsm.admin.interface", "read");
  const canManage =
    isSupervisor ||
    hasPerm("itsm.admin.interface", "create") ||
    hasPerm("itsm.admin.interface", "update");

  return (
    <div className="space-y-6">
      <PageHeader title="Interface: Classic or Modern" description={INTERFACE_HELP.page} />
      {canRead ? (
        <>
          {!canManage ? <ReadOnlyBanner /> : null}
          <InterfaceConfigForm canManage={canManage} />
        </>
      ) : (
        <ReadOnlyBanner message="You don't have access to the interface settings." />
      )}
    </div>
  );
}
