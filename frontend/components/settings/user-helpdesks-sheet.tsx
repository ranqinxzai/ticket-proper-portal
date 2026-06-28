"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { helpdesksApi, projectsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { Helpdesk, Member, Project, RoleInHelpdesk } from "@/lib/itsm/types";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";

const ROLE_SELECT_CLASS =
  "h-7 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

/**
 * Manage which helpdesks a user belongs to (member / lead) AND, per member
 * helpdesk, which of its projects they may access. Membership is the row-level
 * scope: helpdesk membership controls which tickets the user can see; project
 * assignment (strict whitelist) controls which project tabs/queues they see.
 * Leads see every project in a helpdesk they lead, so no per-project picker shows
 * for a lead.
 */
export function UserHelpdesksSheet({
  open,
  onOpenChange,
  user,
  helpdesks,
  canManage,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: Member | null;
  helpdesks: Helpdesk[];
  canManage: boolean;
  onChanged: () => void;
}) {
  // helpdeskId -> role; seeded from the user's roster row, updated optimistically.
  const [membership, setMembership] = useState<Record<string, RoleInHelpdesk>>({});
  // assigned project ids (across helpdesks), seeded from the roster row.
  const [projectIds, setProjectIds] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, RoleInHelpdesk> = {};
    for (const h of user?.helpdesks ?? []) next[h.id] = h.role_in_helpdesk;
    setMembership(next);
    setProjectIds(new Set((user?.projects ?? []).map((p) => p.id)));
  }, [user]);

  // Active projects (grouped by helpdesk below) — load once the sheet opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    projectsApi
      .list()
      .then((rows) => !cancelled && setProjects(rows.filter((p) => p.status === "active")))
      .catch(() => !cancelled && setProjects([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const projectsByHelpdesk = useMemo(() => {
    const map: Record<string, Project[]> = {};
    for (const p of projects) (map[p.helpdesk] ??= []).push(p);
    return map;
  }, [projects]);

  async function setRole(helpdeskId: string, role: RoleInHelpdesk) {
    if (!user) return;
    setBusy(helpdeskId);
    try {
      await helpdesksApi.addMember(helpdeskId, { user: user.id, role_in_helpdesk: role });
      setMembership((m) => ({ ...m, [helpdeskId]: role }));
      onChanged();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not update membership.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(helpdeskId: string) {
    if (!user) return;
    setBusy(helpdeskId);
    try {
      await helpdesksApi.removeMember(helpdeskId, user.id);
      setMembership((m) => {
        const next = { ...m };
        delete next[helpdeskId];
        return next;
      });
      onChanged();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not remove from helpdesk.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleProject(projectId: string, on: boolean) {
    if (!user) return;
    setBusy(`p:${projectId}`);
    try {
      if (on) await projectsApi.addMember(projectId, user.id);
      else await projectsApi.removeMember(projectId, user.id);
      setProjectIds((s) => {
        const next = new Set(s);
        if (on) next.add(projectId);
        else next.delete(projectId);
        return next;
      });
      onChanged();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not update project access.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            Helpdesks &amp; Projects{user ? ` · ${user.full_name || user.username}` : ""}
          </SheetTitle>
          <SheetDescription>
            Helpdesk membership controls which tickets this person can see. Project access (a strict
            whitelist) controls which project tabs they get — leads see every project in a helpdesk
            they lead.
          </SheetDescription>
        </SheetHeader>
        {user?.role?.code === "requestor" ? (
          <div className="mt-5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Requestors are portal-only end-users and can&apos;t be assigned to a helpdesk. Change their
            ITSM role first to grant access.
          </div>
        ) : (
          <ul className="mt-5 divide-y rounded-lg border">
            {helpdesks.map((h) => {
              const role = membership[h.id];
              const isMember = role !== undefined;
              const hdProjects = projectsByHelpdesk[h.id] ?? [];
              return (
                <li key={h.id} className="flex flex-col gap-2 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{h.name}</p>
                      <p className="text-xs text-muted-foreground">{h.key}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isMember ? (
                        <>
                          <select
                            value={role}
                            disabled={!canManage || busy === h.id}
                            onChange={(e) => void setRole(h.id, e.target.value as RoleInHelpdesk)}
                            className={ROLE_SELECT_CLASS}
                          >
                            <option value="member">Member</option>
                            <option value="lead">Lead</option>
                          </select>
                          {canManage ? (
                            <button
                              type="button"
                              onClick={() => void remove(h.id)}
                              disabled={busy === h.id}
                              className="text-xs text-muted-foreground hover:text-destructive"
                            >
                              {busy === h.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                "Remove"
                              )}
                            </button>
                          ) : null}
                        </>
                      ) : canManage ? (
                        <button
                          type="button"
                          onClick={() => void setRole(h.id, "member")}
                          disabled={busy === h.id}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          {busy === h.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">&mdash;</span>
                      )}
                    </div>
                  </div>

                  {/* Per-project access for member helpdesks (leads see all). */}
                  {isMember && role === "lead" ? (
                    <p className="ml-1 border-l pl-3 text-[11px] text-muted-foreground">
                      Leads see every project in this helpdesk.
                    </p>
                  ) : isMember ? (
                    <div className="ml-1 space-y-1 border-l pl-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Projects
                      </p>
                      {hdProjects.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No active projects.</p>
                      ) : (
                        hdProjects.map((p) => (
                          <label
                            key={p.id}
                            className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent/50"
                          >
                            <Checkbox
                              checked={projectIds.has(p.id)}
                              disabled={!canManage || busy === `p:${p.id}`}
                              onCheckedChange={(v) => void toggleProject(p.id, Boolean(v))}
                            />
                            <span className="min-w-0 truncate">
                              {p.name}
                              <span className="ml-1 text-muted-foreground">{p.key}</span>
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
