"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { EmailNotificationForm } from "@/components/settings/email-notification-form";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { SettingsSection } from "@/components/settings/settings-section";

export default function EmailNotificationSettingsPage() {
  const { helpdesk } = useWorkspace();
  const { hasPerm } = useItsmAuth();
  const canEdit = hasPerm("itsm.admin.helpdesks", "update");

  return (
    <SettingsSection
      title="Email Notification"
      description="Set the name and address that outbound notification emails are sent from."
    >
      {!canEdit ? <ReadOnlyBanner /> : null}
      {helpdesk ? (
        <EmailNotificationForm helpdeskId={helpdesk.id} canEdit={canEdit} />
      ) : (
        <p className="text-sm text-muted-foreground">Helpdesk not found.</p>
      )}
    </SettingsSection>
  );
}
