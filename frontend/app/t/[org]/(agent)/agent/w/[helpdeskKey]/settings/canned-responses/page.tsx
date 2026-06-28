"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { CannedNotesAdmin } from "@/components/canned-notes/canned-notes-admin";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";

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
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Loading…
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
