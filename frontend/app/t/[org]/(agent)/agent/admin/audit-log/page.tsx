"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { PageHeader } from "@/components/shell/page-header";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { AuditLog } from "@/components/admin/audit-log";

/** Tenant Settings → Audit log. Org-wide (not per workspace); read-only, gated by
 *  `itsm.admin.audit` (Admin-only by default). */
export default function AdminAuditLogPage() {
  const { hasPerm } = useItsmAuth();
  const canRead = hasPerm("itsm.admin.audit", "read");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Who signed in, and who changed users, roles, permissions and settings — newest first."
      />
      {canRead ? (
        <AuditLog />
      ) : (
        <ReadOnlyBanner message="You don't have access to the audit log." />
      )}
    </div>
  );
}
