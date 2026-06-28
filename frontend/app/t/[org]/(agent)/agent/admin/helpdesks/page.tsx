"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { HelpdesksAdmin } from "@/components/admin/helpdesks-admin";

/** Central helpdesk administration, inside the Tenant Settings hub. Managers can
 * create / enable-disable / reorder; everyone else sees a read-only list. */
export default function HelpdesksAdminPage() {
  const { hasPerm, isSupervisor } = useItsmAuth();
  const canManage =
    isSupervisor ||
    hasPerm("itsm.admin.helpdesks", "update") ||
    hasPerm("itsm.admin.helpdesks", "create");

  return <HelpdesksAdmin canManage={canManage} />;
}
