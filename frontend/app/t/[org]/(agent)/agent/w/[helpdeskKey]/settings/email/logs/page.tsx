"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { EmailLogList } from "@/components/settings/email-log-list";
import { SettingsSection } from "@/components/settings/settings-section";

export default function EmailLogSettingsPage() {
  const { hasPerm } = useItsmAuth();
  const canRetry = hasPerm("itsm.email.logs", "create");

  return (
    <SettingsSection
      title="Email Log"
      description="Every inbound message and its outcome — created a ticket, added a comment, or was ignored. Failed messages can be retried."
    >
      <EmailLogList canRetry={canRetry} />
    </SettingsSection>
  );
}
