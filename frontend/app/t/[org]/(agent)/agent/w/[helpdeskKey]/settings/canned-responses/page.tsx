"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { CannedNotesAdmin } from "@/components/canned-notes/canned-notes-admin";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { Skeleton } from "@/components/ui/skeleton";

/** Per-helpdesk canned responses. Each helpdesk keeps its own library; responses
 *  are shared with everyone who staffs it (server-isolated by helpdesk membership).
 *  Read gates the list; create/update gate the editor; delete is supervisor-only. */
export default function CannedResponsesSettingsPage() {
  const { hasPerm, isSupervisor } = useItsmAuth();
  const { helpdesk } = useWorkspace();
  const canRead = isSupervisor || hasPerm("itsm.canned_notes", "read");
  const canCreate = isSupervisor || hasPerm("itsm.canned_notes", "create");
  const canUpdate = isSupervisor || hasPerm("itsm.canned_notes", "update");
  const canDelete = isSupervisor || hasPerm("itsm.canned_notes", "delete");

  if (!canRead) {
    return <ReadOnlyBanner message="You don't have access to canned responses." />;
  }
  if (!helpdesk) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <CannedNotesAdmin
      helpdesk={{ id: helpdesk.id, name: helpdesk.name }}
      canCreate={canCreate}
      canUpdate={canUpdate}
      canDelete={canDelete}
    />
  );
}
