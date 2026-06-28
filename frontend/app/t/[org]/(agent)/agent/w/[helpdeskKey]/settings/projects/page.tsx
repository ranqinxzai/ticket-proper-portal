"use client";

import { useItsmAuth } from "@/lib/itsm/auth";
import { ProjectsList } from "@/components/settings/projects-list";
import { SettingsSection } from "@/components/settings/settings-section";

export default function ProjectsSettingsPage() {
  const { hasPerm } = useItsmAuth();
  const canCreate = hasPerm("itsm.projects", "create");

  return (
    <SettingsSection
      title="Project Configuration"
      description="Incident, Request and custom projects. Open a project to configure its fields, workflow, layout and approvals."
    >
      <ProjectsList canCreate={canCreate} />
    </SettingsSection>
  );
}
