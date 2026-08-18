"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { CombinedColumnLayoutEditor } from "@/components/settings/column-layout-editor";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { SettingsSection } from "@/components/settings/settings-section";

export default function AllTicketsColumnsSettingsPage() {
  const { hasPerm } = useItsmAuth();
  const canEdit = hasPerm("itsm.admin.helpdesks", "update");

  return (
    <SettingsSection
      title="All-Tickets Columns"
      description="Set the default column layout for this helpdesk's cross-project “All Tickets” queue. Agents can still personalize their own view on top of this default."
    >
      {!canEdit ? <ReadOnlyBanner /> : null}
      <CombinedColumnLayoutEditor canEdit={canEdit} />
    </SettingsSection>
  );
}
