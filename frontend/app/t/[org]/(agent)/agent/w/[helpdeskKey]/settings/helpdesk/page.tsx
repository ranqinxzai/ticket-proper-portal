"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { HelpdeskConfigForm } from "@/components/settings/helpdesk-config-form";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { SettingsSection } from "@/components/settings/settings-section";

export default function HelpdeskConfigPage() {
  const { helpdesk } = useWorkspace();
  const { hasPerm } = useItsmAuth();
  const canEdit = hasPerm("itsm.admin.helpdesks", "update");

  return (
    <SettingsSection
      title="Helpdesk Config"
      description="The name, ticket prefix and branding for this helpdesk workspace."
    >
      {!canEdit ? <ReadOnlyBanner /> : null}
      {helpdesk ? (
        <HelpdeskConfigForm helpdesk={helpdesk} canEdit={canEdit} />
      ) : (
        <p className="text-sm text-muted-foreground">Helpdesk not found.</p>
      )}
    </SettingsSection>
  );
}
