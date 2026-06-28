"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { CalendarEditor } from "@/components/settings/calendar-editor";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { SettingsSection } from "@/components/settings/settings-section";

export default function CalendarSettingsPage() {
  const { hasPerm } = useItsmAuth();
  const canEdit = hasPerm("itsm.sla.calendars", "update");

  return (
    <SettingsSection
      title="Business Calendars"
      description="Timezone, working hours and holidays. SLA clocks tick only inside these windows."
    >
      {!canEdit ? <ReadOnlyBanner /> : null}
      <CalendarEditor canEdit={canEdit} />
    </SettingsSection>
  );
}
