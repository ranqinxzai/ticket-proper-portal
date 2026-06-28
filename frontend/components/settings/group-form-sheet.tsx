"use client";

import { useEffect, useId, useState } from "react";
import { Loader2, X } from "lucide-react";

import { groupsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { Group, GroupRole, GroupType, UserRef } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";

import { FieldRow, fieldError } from "./field-row";
import { UserSearchCombobox } from "./user-search-combobox";

const GROUP_TYPES: { value: GroupType; label: string }[] = [
  { value: "service_desk", label: "Service Desk" },
  { value: "network", label: "Network Team" },
  { value: "infra", label: "Infrastructure Team" },
  { value: "security", label: "Security Team" },
  { value: "app_support", label: "Application Support" },
  { value: "custom", label: "Custom" },
];

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);

const without = (list: UserRef[], id: string) => list.filter((u) => u.id !== id);

export function GroupFormSheet({
  open,
  onOpenChange,
  helpdeskId,
  group,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  helpdeskId: string;
  /** When set, edit mode; otherwise create. */
  group?: Group | null;
  onSaved: () => void;
}) {
  const baseId = useId();
  const editing = Boolean(group);

  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [type, setType] = useState<GroupType>("custom");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  // Team (edit mode only) — leads (role=lead, leads[0] = primary used by the
  // group-lead auto-assign strategy) and agents (role=member). Changes here are
  // saved immediately, the same as the standalone members sheet.
  const [leads, setLeads] = useState<UserRef[]>([]);
  const [agents, setAgents] = useState<UserRef[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamBusy, setTeamBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setKey(group?.key ?? "");
    setKeyTouched(Boolean(group));
    setDescription(group?.description ?? "");
    setType(group?.type ?? "custom");
    setErrors({});
    setLeads([]);
    setAgents([]);
    if (!group) return;
    setTeamLoading(true);
    groupsApi
      .members(group.id)
      .then((rows) => {
        const ref = (m: { user: string; username: string; full_name: string }): UserRef => ({
          id: m.user,
          username: m.username,
          full_name: m.full_name,
        });
        const leadRefs = rows.filter((m) => m.role_in_group === "lead").map(ref);
        // Surface the group's primary lead first so its badge is accurate.
        setLeads([
          ...leadRefs.filter((u) => u.id === group.lead),
          ...leadRefs.filter((u) => u.id !== group.lead),
        ]);
        setAgents(rows.filter((m) => m.role_in_group === "member").map(ref));
      })
      .catch(() => {
        setLeads([]);
        setAgents([]);
      })
      .finally(() => setTeamLoading(false));
  }, [open, group]);

  const effectiveKey = keyTouched ? key : slugify(name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !effectiveKey) return;
    setBusy(true);
    setErrors({});
    // `lead` is owned by the Team section (immediate writes), so the core save
    // must not send it — that would clobber the primary lead.
    const body = { name: name.trim(), key: effectiveKey, description: description.trim(), type };
    try {
      if (editing && group) {
        await groupsApi.update(group.id, body);
        toast.success("Group updated.");
      } else {
        await groupsApi.create({ ...body, helpdesk: helpdeskId });
        toast.success("Group created. Open it again to add leads and agents.");
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ItsmApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        toast.error(err.message);
      } else {
        toast.error("Could not save the group.");
      }
    } finally {
      setBusy(false);
    }
  }

  /** Keep Group.lead (the primary, single FK) in sync with leads[0]. */
  async function syncPrimary(prev: UserRef[], next: UserRef[]) {
    if (!group) return;
    const before = prev[0]?.id ?? null;
    const after = next[0]?.id ?? null;
    if (before !== after) await groupsApi.update(group.id, { lead: after });
  }

  /** Add a user (or move them) into the given role. add_member upserts the role. */
  async function assignRole(u: UserRef, role: GroupRole) {
    if (!group || !u.id) return;
    setTeamBusy(true);
    try {
      await groupsApi.addMember(group.id, { user: u.id, role_in_group: role });
      const nextLeads = role === "lead" ? [...without(leads, u.id), u] : without(leads, u.id);
      const nextAgents = role === "member" ? [...without(agents, u.id), u] : without(agents, u.id);
      await syncPrimary(leads, nextLeads);
      setLeads(nextLeads);
      setAgents(nextAgents);
      onSaved();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not update the member.");
    } finally {
      setTeamBusy(false);
    }
  }

  /** Remove a user from the group entirely (soft on the backend). */
  async function removeFromGroup(u: UserRef) {
    if (!group) return;
    setTeamBusy(true);
    try {
      await groupsApi.removeMember(group.id, u.id);
      const nextLeads = without(leads, u.id);
      await syncPrimary(leads, nextLeads);
      setLeads(nextLeads);
      setAgents(without(agents, u.id));
      onSaved();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not remove the member.");
    } finally {
      setTeamBusy(false);
    }
  }

  /** Promote a lead to the primary slot (Group.lead). */
  async function makePrimary(u: UserRef) {
    if (!group || leads[0]?.id === u.id) return;
    setTeamBusy(true);
    try {
      await groupsApi.update(group.id, { lead: u.id });
      setLeads([u, ...without(leads, u.id)]);
      onSaved();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not set the primary lead.");
    } finally {
      setTeamBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit group" : "New group"}</SheetTitle>
          <SheetDescription>
            Teams own and work tickets in this helpdesk. They can be set as a project&apos;s default
            group or targeted by routing rules.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="space-y-5 py-5">
          <FieldRow label="Name" htmlFor={`${baseId}-name`} error={fieldError(errors, "name")} required>
            <Input
              id={`${baseId}-name`}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </FieldRow>

          <FieldRow
            label="Key"
            htmlFor={`${baseId}-key`}
            error={fieldError(errors, "key")}
            hint="Unique slug; auto-derived from the name unless you edit it."
            required
          >
            <Input
              id={`${baseId}-key`}
              value={effectiveKey}
              disabled={busy}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(slugify(e.target.value));
              }}
              className="font-mono"
            />
          </FieldRow>

          <FieldRow label="Type" htmlFor={`${baseId}-type`}>
            <Select value={type} onValueChange={(v) => setType(v as GroupType)} disabled={busy}>
              <SelectTrigger id={`${baseId}-type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUP_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>

          <FieldRow label="Description" htmlFor={`${baseId}-desc`}>
            <textarea
              id={`${baseId}-desc`}
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            />
          </FieldRow>

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editing ? "Save" : "Create group"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
          </div>

          {/* Team management — leads + agents. Needs a saved group, so edit-mode only. */}
          {editing && group ? (
            <div className="space-y-5 border-t pt-5">
              <div>
                <h3 className="text-sm font-medium">Team</h3>
                <p className="text-xs text-muted-foreground">
                  Leads and agents are saved immediately. Members and leads can be auto-assigned
                  tickets in this group.
                </p>
              </div>

              {teamLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
                </p>
              ) : (
                <>
                  <FieldRow
                    label="Leads"
                    hint="Used by the group-lead auto-assign strategy. The first lead is the primary."
                  >
                    <div className="space-y-2">
                      {leads.length > 0 ? (
                        <ul className="flex flex-wrap gap-1.5">
                          {leads.map((u, i) => (
                            <li
                              key={u.id}
                              className="flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs text-primary"
                            >
                              <span className="font-medium">{u.full_name || u.username}</span>
                              {i === 0 ? (
                                <span className="rounded bg-primary/20 px-1 text-[10px] font-medium uppercase tracking-wide">
                                  primary
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={teamBusy}
                                  onClick={() => void makePrimary(u)}
                                  className="rounded px-1 text-[10px] uppercase tracking-wide hover:bg-primary/20 disabled:opacity-50"
                                >
                                  Set primary
                                </button>
                              )}
                              <button
                                type="button"
                                aria-label={`Remove lead ${u.full_name || u.username}`}
                                disabled={teamBusy}
                                onClick={() => void removeFromGroup(u)}
                                className="rounded-full p-0.5 hover:bg-primary/20 disabled:opacity-50"
                              >
                                <X className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <UserSearchCombobox
                        placeholder="Add a lead…"
                        onSelect={(u) => void assignRole(u, "lead")}
                        disabled={teamBusy}
                      />
                    </div>
                  </FieldRow>

                  <FieldRow label="Agents" hint="Team members who work and can be assigned tickets.">
                    <div className="space-y-2">
                      {agents.length > 0 ? (
                        <ul className="divide-y rounded-lg border">
                          {agents.map((u) => (
                            <li key={u.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                              <div className="min-w-0">
                                <p className="truncate font-medium">{u.full_name || u.username}</p>
                                <p className="truncate text-xs text-muted-foreground">@{u.username}</p>
                              </div>
                              <div className="ml-auto flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={teamBusy}
                                  onClick={() => void assignRole(u, "lead")}
                                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                                >
                                  Make lead
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Remove agent ${u.full_name || u.username}`}
                                  disabled={teamBusy}
                                  onClick={() => void removeFromGroup(u)}
                                  className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                                >
                                  <X className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                          No agents yet.
                        </div>
                      )}
                      <UserSearchCombobox
                        placeholder="Add an agent…"
                        onSelect={(u) => void assignRole(u, "member")}
                        disabled={teamBusy}
                      />
                    </div>
                  </FieldRow>
                </>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Create the group first, then reopen it to add leads and agents.
            </p>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}
