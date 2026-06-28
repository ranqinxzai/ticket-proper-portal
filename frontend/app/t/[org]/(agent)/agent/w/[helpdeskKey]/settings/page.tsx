"use client";

import { CalendarClock, FolderKanban, MessageSquareText, SlidersHorizontal, Users } from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { SettingsCategory, type SettingCardDef } from "@/components/settings/settings-card-grid";

export default function SettingsHome() {
  const { org, helpdeskKey, helpdesk, allProjects } = useWorkspace();
  const base = `/t/${org}/agent/w/${helpdeskKey}/settings`;

  const helpdeskCards: SettingCardDef[] = [
    {
      title: "Helpdesk Config",
      description: "Edit this helpdesk's name, ticket prefix, icon and colour.",
      href: `${base}/helpdesk`,
      icon: SlidersHorizontal,
    },
    {
      title: "Business Calendars",
      description: "Timezone, working hours and holidays used by SLA clocks.",
      href: `${base}/calendar`,
      icon: CalendarClock,
    },
    {
      title: "Assigned Groups",
      description: "Create and manage the teams that own and work tickets.",
      href: `${base}/groups`,
      icon: Users,
    },
    {
      title: "Canned Responses",
      description: "Reusable reply snippets shared with everyone who staffs this helpdesk.",
      href: `${base}/canned-responses`,
      icon: MessageSquareText,
    },
  ];

  const projectCards: SettingCardDef[] = [
    {
      title: "Projects",
      description: "Incident, Request and custom projects — fields, workflow, layout, approval.",
      href: `${base}/projects`,
      icon: FolderKanban,
      badge: allProjects.length || undefined,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure {helpdesk?.name ?? "this helpdesk"} and its projects.
        </p>
      </div>
      <SettingsCategory title="HelpDesk Configuration" cards={helpdeskCards} />
      <SettingsCategory title="Project Configuration" cards={projectCards} />
    </div>
  );
}
