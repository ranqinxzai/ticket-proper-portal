"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, FolderKanban } from "lucide-react";

import { useItsmAuth } from "@/lib/itsm/auth";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { readableOn } from "@/lib/itsm/colors";
import { ItsmIcon } from "@/lib/itsm/icon-map";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ApprovalEditor } from "@/components/settings/approval-editor";
import { ColumnLayoutEditor } from "@/components/settings/column-layout-editor";
import { FieldsEditor } from "@/components/settings/fields-editor";
import { FiltersEditor } from "@/components/settings/filters-editor";
import { LayoutEditor } from "@/components/settings/layout-editor";
import { NotificationsEditor } from "@/components/settings/notifications-editor";
import { PriorityMatrixEditor } from "@/components/settings/priority-matrix-editor";
import { ProjectOverviewTab } from "@/components/settings/project-overview-tab";
import { RoutingEditor } from "@/components/settings/routing-editor";
import { SlaEditor } from "@/components/settings/sla-editor";
import { WorkflowEditor } from "@/components/settings/workflow-editor";

const TABS = ["overview", "fields", "workflow", "layout", "columns", "filters", "routing", "sla", "notifications", "approval", "priority"] as const;
type TabKey = (typeof TABS)[number];

export default function ProjectConfigPage() {
  const { org, helpdeskKey, projectKey } = useParams<{ org: string; helpdeskKey: string; projectKey: string }>();
  const { projectByKey, loading } = useWorkspace();
  const { hasPerm } = useItsmAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const project = projectByKey(projectKey);
  const isIncident = project?.project_type === "incident";
  const tabParam = (searchParams.get("tab") ?? "overview") as TabKey;
  const tab: TabKey =
    TABS.includes(tabParam) && !(tabParam === "priority" && !isIncident) ? tabParam : "overview";

  const base = `/t/${org}/agent/w/${helpdeskKey}/settings`;

  function setTab(next: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", next);
    router.replace(`${base}/projects/${projectKey}?${sp.toString()}`);
  }

  if (loading && !project) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-4 w-32" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="space-y-4">
        <Link href={`${base}/projects`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to projects
        </Link>
        <EmptyState
          icon={FolderKanban}
          title="Project not found"
          description="This project may have been removed, or you don't have access to it."
          action={
            <Button asChild variant="outline">
              <Link href={`${base}/projects`}>Back to projects</Link>
            </Button>
          }
        />
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
          {isIncident ? <TabsTrigger value="priority">Priority Matrix</TabsTrigger> : null}
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
        {isIncident ? (
          <TabsContent value="priority" className="pt-4">
            <PriorityMatrixEditor project={project} canEdit={hasPerm("itsm.projects", "update")} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
