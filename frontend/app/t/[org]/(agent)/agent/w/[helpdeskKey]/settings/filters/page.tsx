"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { HelpdeskFiltersEditor } from "@/components/settings/filters-editor";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { SettingsSection } from "@/components/settings/settings-section";

export default function AllTicketsFiltersSettingsPage() {
  const { hasPerm } = useItsmAuth();
  const canEdit = hasPerm("itsm.admin.helpdesks", "update");

  return (
    <SettingsSection
      title="All-Tickets Filters"
      description="Manage the view menu of this helpdesk's cross-project “All Tickets” queue: filters shared with every agent, which built-in views appear, and which view opens first."
    >
      {!canEdit ? <ReadOnlyBanner /> : null}
      <HelpdeskFiltersEditor canEdit={canEdit} />
    </SettingsSection>
  );
}
