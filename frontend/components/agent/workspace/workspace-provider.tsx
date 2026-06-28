"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { projectsApi } from "@/lib/itsm/api";
import { useItsmAuth } from "@/lib/itsm/auth";
import type { Helpdesk, Project } from "@/lib/itsm/types";

const TYPE_ORDER: Record<string, number> = { incident: 0, service_request: 1, custom: 2 };

type WorkspaceState = {
  /** Current org (tenant) slug — for building org-scoped links. */
  org: string;
  helpdeskKey: string;
  helpdesk: Helpdesk | null;
  /** Active projects only (drives the workspace tabs). */
  projects: Project[];
  /** Every project in this helpdesk, including inactive (drives the settings list). */
  allProjects: Project[];
  loading: boolean;
  projectByKey: (key: string) => Project | undefined;
  /** Re-fetch projects + the user (so header/tabs/cards reflect settings edits). */
  refresh: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({
  org,
  helpdeskKey,
  children,
}: {
  org: string;
  helpdeskKey: string;
  children: React.ReactNode;
}) {
  const { user, refreshUser } = useItsmAuth();
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const helpdesk = useMemo(
    () => (user?.helpdesks ?? []).find((h) => h.key === helpdeskKey) ?? null,
    [user, helpdeskKey],
  );

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const all = await projectsApi.list();
      const mine = all
        .filter((p) => p.helpdesk_key === helpdeskKey)
        .sort(
          (a, b) =>
            (TYPE_ORDER[a.project_type] ?? 9) - (TYPE_ORDER[b.project_type] ?? 9) ||
            a.name.localeCompare(b.name),
        );
      setAllProjects(mine);
    } catch {
      setAllProjects([]);
    } finally {
      setLoading(false);
    }
  }, [helpdeskKey]);

  useEffect(() => {
    let cancelled = false;
    void loadProjects();
    return () => {
      cancelled = true;
      void cancelled;
    };
  }, [loadProjects]);

  const refresh = useCallback(async () => {
    await Promise.all([loadProjects(), refreshUser()]);
  }, [loadProjects, refreshUser]);

  const projects = useMemo(
    () => allProjects.filter((p) => p.status === "active"),
    [allProjects],
  );

  const value = useMemo<WorkspaceState>(
    () => ({
      org,
      helpdeskKey,
      helpdesk,
      projects,
      allProjects,
      loading,
      projectByKey: (key) => allProjects.find((p) => p.key === key),
      refresh,
    }),
    [org, helpdeskKey, helpdesk, projects, allProjects, loading, refresh],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}
