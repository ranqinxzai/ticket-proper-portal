"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { useItsmAuth } from "@/lib/itsm/auth";
import { EmailChannelsList } from "@/components/settings/email-channels-list";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { SettingsSection } from "@/components/settings/settings-section";

export default function EmailChannelsSettingsPage() {
  const { hasPerm } = useItsmAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // The OAuth callback bounces back here with ?email_oauth=success|error.
  useEffect(() => {
    const result = searchParams.get("email_oauth");
    if (!result) return;
    if (result === "success") {
      toast.success("Mailbox authorized. OAuth tokens stored.");
    } else {
      const detail = searchParams.get("detail");
      toast.error(detail ? `Authorization failed: ${detail}` : "Authorization failed. Check the app credentials and redirect URI.");
    }
    // Clear the query so a refresh doesn't re-toast.
    router.replace(window.location.pathname);
  }, [searchParams, router]);

  const canManage =
    hasPerm("itsm.email.channels", "create") ||
    hasPerm("itsm.email.channels", "update") ||
    hasPerm("itsm.email.channels", "delete");

  return (
    <SettingsSection
      title="Mailboxes"
      description="Connect a mailbox per project so inbound email becomes tickets, and acknowledgements & agent replies go out from the support address (threaded so replies come back as comments)."
    >
      {!canManage ? <ReadOnlyBanner /> : null}
      <EmailChannelsList canManage={canManage} />
    </SettingsSection>
  );
}
