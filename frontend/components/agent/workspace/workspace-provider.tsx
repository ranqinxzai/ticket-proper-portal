"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { projectsApi } from "@/lib/itsm/api";
import { useItsmAuth } from "@/lib/itsm/auth";
import type { Helpdesk, Project } from "@/lib/itsm/types";

const TYPE_ORDER: Record<string, number> = { incident: 0, service_request: 1, custom: 2 };

type WorkspaceState = {
  helpdeskKey: string;
  helpdesk: Helpdesk | null;
  projects: Project[];
  loading: boolean;
  projectByKey: (key: string) => Project | undefined;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({
  helpdeskKey,
  children,
}: {
  helpdeskKey: string;
  children: React.ReactNode;
}) {
  const { user } = useItsmAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const helpdesk = useMemo(
    () => (user?.helpdesks ?? []).find((h) => h.key === helpdeskKey) ?? null,
    [user, helpdeskKey],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    projectsApi
      .list()
      .then((all) => {
        if (cancelled) return;
        const mine = all
          .filter((p) => p.helpdesk_key === helpdeskKey && p.status === "active")
          .sort(
            (a, b) =>
              (TYPE_ORDER[a.project_type] ?? 9) - (TYPE_ORDER[b.project_type] ?? 9) ||
              a.name.localeCompare(b.name),
          );
        setProjects(mine);
      })
      .catch(() => setProjects([]))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [helpdeskKey]);

  const value = useMemo<WorkspaceState>(
    () => ({
      helpdeskKey,
      helpdesk,
      projects,
      loading,
      projectByKey: (key) => projects.find((p) => p.key === key),
    }),
    [helpdeskKey, helpdesk, projects, loading],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}
