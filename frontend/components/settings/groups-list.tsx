"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Users } from "lucide-react";

import { groupsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import type { Group } from "@/lib/itsm/types";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

import { GroupFormSheet } from "./group-form-sheet";
import { GroupMembersSheet } from "./group-members-sheet";

const TYPE_LABELS: Record<string, string> = {
  service_desk: "Service Desk",
  network: "Network",
  infra: "Infrastructure",
  security: "Security",
  app_support: "App Support",
  custom: "Custom",
};

export function GroupsList({ canManage }: { canManage: boolean }) {
  const { helpdesk } = useWorkspace();
  const [rows, setRows] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [membersOf, setMembersOf] = useState<Group | null>(null);
  const [deleting, setDeleting] = useState<Group | null>(null);

  const load = useCallback(() => {
    if (!helpdesk) return;
    setLoading(true);
    groupsApi
      .list({ helpdesk: helpdesk.id })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [helpdesk]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(deleting.id);
    try {
      await groupsApi.delete(deleting.id);
      toast.success("Group deleted.");
      setRows((r) => r.filter((x) => x.id !== deleting.id));
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not delete the group.");
    } finally {
      setBusy(null);
      setDeleting(null);
    }
  }

  if (!helpdesk) return null;

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button
            className="gap-1"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> New group
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No groups yet"
          description="Groups are the teams that own and work this helpdesk's tickets. Shared teams are visible to every helpdesk."
          action={
            canManage ? (
              <Button
                className="gap-1"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> New group
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-xl border shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((g) => {
                const global = g.helpdesk == null;
                return (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {TYPE_LABELS[g.type] ?? g.type}
                    </TableCell>
                    <TableCell>
                      {global ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          Shared
                        </span>
                      ) : (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                          {helpdesk.key}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{g.lead_name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.member_count ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {canManage && !global ? (
                          <>
                            {/* Edit owns team management (leads + agents) for this helpdesk's groups. */}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditing(g);
                                setFormOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Delete group"
                              disabled={busy === g.id}
                              onClick={() => setDeleting(g)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                            </Button>
                          </>
                        ) : (
                          // Shared/global teams (not editable here) and read-only viewers keep the
                          // standalone members panel.
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1"
                            onClick={() => setMembersOf(g)}
                          >
                            <Users className="h-4 w-4" aria-hidden="true" /> Members
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <GroupFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        helpdeskId={helpdesk.id}
        group={editing}
        onSaved={load}
      />
      <GroupMembersSheet
        open={Boolean(membersOf)}
        onOpenChange={(o) => !o && setMembersOf(null)}
        group={membersOf}
        canManage={canManage}
        onChanged={load}
      />

      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete group?</DialogTitle>
            <DialogDescription>
              {deleting ? `"${deleting.name}" will be removed.` : ""} Tickets currently assigned to this
              group keep their assignment. This can&apos;t be undone from here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy === deleting?.id}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy === deleting?.id}>
              {busy === deleting?.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
