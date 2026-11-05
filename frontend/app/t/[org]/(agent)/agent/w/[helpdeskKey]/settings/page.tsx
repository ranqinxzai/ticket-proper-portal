"use client";

import { Building2, CalendarClock, Columns3, Filter, FolderKanban, ListTree, MapPin, MessageSquareText, SlidersHorizontal, Store, Tags, Users } from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { PageHeader } from "@/components/shell/page-header";
import { SettingsCategory, type SettingCardDef } from "@/components/settings/settings-card-grid";
import { useItsmAuth } from "@/lib/itsm/auth";

export default function SettingsHome() {
  const { org, helpdeskKey, helpdesk, allProjects } = useWorkspace();
  const { hasPerm } = useItsmAuth();
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
    {
      title: "All-Tickets Columns",
      description: "Default columns for the cross-project “All Tickets” queue.",
      href: `${base}/columns`,
      icon: Columns3,
    },
    {
      title: "All-Tickets Filters",
      description: "Filters shared with every agent, built-in views and the default view for “All Tickets”.",
      href: `${base}/filters`,
      icon: Filter,
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

  // Asset Management v1 — categories/fields are per helpdesk; the rest is org-wide.
  const assetCards: SettingCardDef[] = [
    {
      title: "Categories & Fields",
      description: "Asset categories, sub-categories and the detail fields each one adds to the asset form.",
      href: `${base}/assets/categories`,
      icon: ListTree,
    },
    {
      title: "Statuses",
      description: "Asset statuses and their state types, the default and the Expired target. Shared by all helpdesks.",
      href: `${base}/assets/statuses`,
      icon: Tags,
    },
    {
      title: "Vendors",
      description: "Suppliers and their contact details. Shared by all helpdesks.",
      href: `${base}/assets/vendors`,
      icon: Store,
    },
    {
      title: "Locations",
      description: "Offices, sites and rooms where assets are kept. Shared by all helpdesks.",
      href: `${base}/assets/locations`,
      icon: MapPin,
    },
    {
      title: "Departments",
      description: "Departments assets can be allotted to. Shared by all helpdesks.",
      href: `${base}/assets/departments`,
      icon: Building2,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Settings"
        description={`Configure ${helpdesk?.name ?? "this helpdesk"} and its projects.`}
      />
      <div className="space-y-8">
        <SettingsCategory title="HelpDesk Configuration" cards={helpdeskCards} />
        <SettingsCategory title="Project Configuration" cards={projectCards} />
        {hasPerm("itsm.assets.config", "read") ? (
          <SettingsCategory title="Asset Configuration" cards={assetCards} />
        ) : null}
      </div>
    </div>
  );
}
