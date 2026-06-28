"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { GroupsList } from "@/components/settings/groups-list";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { SettingsSection } from "@/components/settings/settings-section";

export default function GroupsSettingsPage() {
  const { hasPerm } = useItsmAuth();
  const canManage =
    hasPerm("itsm.groups", "create") ||
    hasPerm("itsm.groups", "update") ||
    hasPerm("itsm.groups", "delete");

  return (
    <SettingsSection
      title="Assigned Groups"
      description="Teams that own and work this helpdesk's tickets. Shared teams are visible to every helpdesk."
    >
      {!canManage ? <ReadOnlyBanner /> : null}
      <GroupsList canManage={canManage} />
    </SettingsSection>
  );
}
