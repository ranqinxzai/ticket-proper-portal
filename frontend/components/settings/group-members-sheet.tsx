"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

import { groupsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { Group, GroupMembership, GroupRole, UserRef } from "@/lib/itsm/types";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";

import { UserSearchCombobox } from "./user-search-combobox";

export function GroupMembersSheet({
  open,
  onOpenChange,
  group,
  canManage,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: Group | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<GroupMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [addRole, setAddRole] = useState<GroupRole>("member");

  const load = useCallback(() => {
    if (!group) return;
    setLoading(true);
    groupsApi
      .members(group.id)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [group]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function add(user: UserRef) {
    if (!group || !user.id) return;
    setBusy("add");
    try {
      await groupsApi.addMember(group.id, { user: user.id, role_in_group: addRole });
      load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not add the member.");
    } finally {
      setBusy(null);
    }
  }

  /** Promote a member to lead or demote a lead to member (add_member upserts the role). */
  async function setRole(m: GroupMembership, role: GroupRole) {
    if (!group) return;
    setBusy(m.id);
    try {
      await groupsApi.addMember(group.id, { user: m.user, role_in_group: role });
      setRows((r) => r.map((x) => (x.id === m.id ? { ...x, role_in_group: role } : x)));
      onChanged();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not change the role.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(m: GroupMembership) {
    if (!group) return;
    setBusy(m.id);
    try {
      await groupsApi.removeMember(group.id, m.user);
      setRows((r) => r.filter((x) => x.id !== m.id));
      onChanged();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not remove the member.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Members{group ? ` · ${group.name}` : ""}</SheetTitle>
          <SheetDescription>People in this group can be auto-assigned tickets.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-5">
          {canManage ? (
            <div className="space-y-2">
              <UserSearchCombobox
                placeholder="Add a member…"
                onSelect={(u) => void add(u)}
                disabled={busy === "add"}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Add as
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as GroupRole)}
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="member">Team member</option>
                  <option value="lead">Lead</option>
                </select>
              </label>
            </div>
          ) : null}

          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No members yet.
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {rows.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.full_name || m.username}</p>
                    <p className="truncate text-xs text-muted-foreground">@{m.username}</p>
                  </div>
                  {m.role_in_group === "lead" ? (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">lead</span>
                  ) : null}
                  {canManage ? (
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy === m.id}
                        onClick={() => void setRole(m, m.role_in_group === "lead" ? "member" : "lead")}
                        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        {m.role_in_group === "lead" ? "Make member" : "Make lead"}
                      </button>
                      <button
                        type="button"
                        aria-label="Remove member"
                        disabled={busy === m.id}
                        onClick={() => void remove(m)}
                        className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
