"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { useItsmAuth } from "@/lib/itsm/auth";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { EmailNotificationForm } from "@/components/settings/email-notification-form";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { SettingsSection } from "@/components/settings/settings-section";

export default function EmailNotificationSettingsPage() {
  const { helpdesk } = useWorkspace();
  const { hasPerm } = useItsmAuth();
  const canEdit = hasPerm("itsm.admin.helpdesks", "update");
  const router = useRouter();
  const searchParams = useSearchParams();

  // The Microsoft 365 consent flow bounces back here with ?email_oauth=success|error.
  useEffect(() => {
    const result = searchParams.get("email_oauth");
    if (!result) return;
    if (result === "success") {
      toast.success("Microsoft 365 connected. This helpdesk can now send from your mailbox.");
    } else {
      const detail = searchParams.get("detail");
      toast.error(
        detail
          ? `Connection failed: ${detail}`
          : "Connection failed. Check the app credentials and redirect URL.",
      );
    }
    router.replace(window.location.pathname);
  }, [searchParams, router]);

  return (
    <SettingsSection
      title="Email Notification"
      description="Choose how this helpdesk's ticket notification emails are sent and who they appear to come from."
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
