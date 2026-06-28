"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { useItsmAuth } from "@/lib/itsm/auth";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ApprovalEditor } from "@/components/settings/approval-editor";
import { ColumnLayoutEditor } from "@/components/settings/column-layout-editor";
import { FieldsEditor } from "@/components/settings/fields-editor";
import { FiltersEditor } from "@/components/settings/filters-editor";
import { LayoutEditor } from "@/components/settings/layout-editor";
import { NotificationsEditor } from "@/components/settings/notifications-editor";
import { ProjectOverviewTab } from "@/components/settings/project-overview-tab";
import { RoutingEditor } from "@/components/settings/routing-editor";
import { SlaEditor } from "@/components/settings/sla-editor";
import { WorkflowEditor } from "@/components/settings/workflow-editor";

const TABS = ["overview", "fields", "workflow", "layout", "columns", "filters", "routing", "sla", "notifications", "approval"] as const;
type TabKey = (typeof TABS)[number];

export default function ProjectConfigPage() {
  const { org, helpdeskKey, projectKey } = useParams<{ org: string; helpdeskKey: string; projectKey: string }>();
  const { projectByKey, loading } = useWorkspace();
  const { hasPerm } = useItsmAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const project = projectByKey(projectKey);
  const tabParam = (searchParams.get("tab") ?? "overview") as TabKey;
  const tab: TabKey = TABS.includes(tabParam) ? tabParam : "overview";

  const base = `/t/${org}/agent/w/${helpdeskKey}/settings`;

  function setTab(next: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", next);
    router.replace(`${base}/projects/${projectKey}?${sp.toString()}`);
  }

  if (loading && !project) {
    return <p className="text-sm text-muted-foreground">Loading project…</p>;
  }
  if (!project) {
    return (
      <div className="space-y-4">
        <Link href={`${base}/projects`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to projects
        </Link>
        <p className="text-sm text-muted-foreground">Project not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href={`${base}/projects`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to projects
      </Link>

      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg"
          style={{ backgroundColor: project.color || "#6366f1", color: readableOn(project.color) }}
        >
          <ItsmIcon name={project.icon} className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{project.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">{project.key}</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="fields">Fields</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
          <TabsTrigger value="layout">Layout</TabsTrigger>
          <TabsTrigger value="columns">Columns</TabsTrigger>
          <TabsTrigger value="filters">Filters</TabsTrigger>
          <TabsTrigger value="routing">Routing</TabsTrigger>
          <TabsTrigger value="sla">SLA</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="approval">Approval</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <ProjectOverviewTab project={project} canEdit={hasPerm("itsm.projects", "update")} />
        </TabsContent>
        <TabsContent value="fields" className="pt-4">
          <FieldsEditor project={project} canEdit={hasPerm("itsm.fields", "update")} />
        </TabsContent>
        <TabsContent value="workflow" className="pt-4">
          <WorkflowEditor project={project} canEdit={hasPerm("itsm.workflows", "update")} />
        </TabsContent>
        <TabsContent value="layout" className="pt-4">
          <LayoutEditor project={project} canEdit={hasPerm("itsm.fields", "update")} />
        </TabsContent>
        <TabsContent value="columns" className="pt-4">
          <ColumnLayoutEditor project={project} canEdit={hasPerm("itsm.projects", "update")} />
        </TabsContent>
        <TabsContent value="filters" className="pt-4">
          <FiltersEditor project={project} canEdit={hasPerm("itsm.projects", "update")} />
        </TabsContent>
        <TabsContent value="routing" className="pt-4">
          <RoutingEditor
            project={project}
            canEditWhitelist={hasPerm("itsm.projects", "update")}
            canEditRules={hasPerm("itsm.groups", "update")}
          />
        </TabsContent>
        <TabsContent value="sla" className="pt-4">
          <SlaEditor project={project} canEdit={hasPerm("itsm.sla.policies", "update")} />
        </TabsContent>
        <TabsContent value="notifications" className="pt-4">
          <NotificationsEditor
            project={project}
            canView={hasPerm("itsm.notifications.schemes", "read")}
            canEditRules={hasPerm("itsm.notifications.schemes", "update")}
            canEditTemplates={hasPerm("itsm.notifications.templates", "update")}
          />
        </TabsContent>
        <TabsContent value="approval" className="pt-4">
          <ApprovalEditor project={project} canEdit={hasPerm("itsm.approvals.admin", "update")} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
