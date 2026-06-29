"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Plus, Settings2 } from "lucide-react";

import { helpdesksApi, membersApi, projectsApi, rolesApi, ssoApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useItsmAuth } from "@/lib/itsm/auth";
import type { Helpdesk, Member, Project, SystemRole } from "@/lib/itsm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

import { UserHelpdesksSheet } from "./user-helpdesks-sheet";

const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

export function UsersList({ canManage }: { canManage: boolean }) {
  const { user: me } = useItsmAuth();
  const [rows, setRows] = useState<Member[]>([]);
  const [roles, setRoles] = useState<SystemRole[]>([]);
  const [helpdesks, setHelpdesks] = useState<Helpdesk[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [manageUser, setManageUser] = useState<Member | null>(null);
  const [resetUser, setResetUser] = useState<Member | null>(null);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Debounce the search box so we fetch once typing settles, not per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(handle);
  }, [search]);

  // Fetch on debounced-search / explicit reload, ignoring out-of-order responses.
  useEffect(() => {
    let active = true;
    setLoading(true);
    membersApi
      .list({ search: debouncedSearch.trim() || undefined })
      .then((r) => {
        if (active) setRows(r);
      })
      .catch(() => {
        if (active) setRows([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [debouncedSearch, refreshKey]);

  // Pickers (load once): assignable roles + all helpdesks.
  useEffect(() => {
    rolesApi
      .list()
      .then((r) => setRoles(r.filter((x) => x.is_active)))
      .catch(() => setRoles([]));
    // Only active helpdesks are assignable (the manager list also returns
    // inactive/archived ones, which can't take new members).
    helpdesksApi
      .list()
      .then((all) => setHelpdesks(all.filter((h) => h.status === "active")))
      .catch(() => setHelpdesks([]));
  }, []);

  async function changeRole(m: Member, roleCode: string) {
    // Demoting to requestor strips helpdesk/project access server-side — confirm first.
    if (roleCode === "requestor" && m.helpdesks.length > 0) {
      const ok = window.confirm(
        `Switching ${m.full_name || m.username} to Requestor removes their helpdesk and project access. Continue?`,
      );
      if (!ok) return;
    }
    setBusy(String(m.id));
    try {
      await membersApi.setRole(m.id, roleCode);
      const role = roles.find((r) => r.code === roleCode);
      setRows((rs) =>
        rs.map((x) =>
          x.id === m.id
            ? { ...x, role: role ? { code: role.code, name: role.name } : null }
            : x,
        ),
      );
      // Requestor demotion drops memberships on the server; refetch so the
      // Helpdesks column reflects the removal.
      if (roleCode === "requestor") reload();
      toast.success("Role updated.");
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not update the role.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(m: Member, isActive: boolean) {
    setBusy(String(m.id));
    try {
      await membersApi.setActive(m.id, isActive);
      setRows((rs) => rs.map((x) => (x.id === m.id ? { ...x, is_active: isActive } : x)));
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not change status.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, username or email…"
          className="h-9 max-w-xs"
        />
        {canManage ? (
          <Button onClick={() => setAdding(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add user
          </Button>
        ) : null}
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No users found.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>ITSM Role</TableHead>
                <TableHead>Helpdesks</TableHead>
                <TableHead className="text-center">Active</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => {
                const isSelf = me ? String(me.id) === String(m.id) : false;
                const currentRoleCode = m.role?.code ?? "";
                return (
                  <TableRow key={String(m.id)}>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="font-medium">{m.full_name || m.username}</p>
                        <p className="text-xs text-muted-foreground">
                          @{m.username}
                          {m.email ? ` · ${m.email}` : ""}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {m.is_superuser ? (
                        <Badge variant="secondary">Administrator</Badge>
                      ) : canManage && !isSelf ? (
                        <select
                          value={currentRoleCode}
                          disabled={busy === String(m.id)}
                          onChange={(e) => void changeRole(m, e.target.value)}
                          className={SELECT_CLASS}
                        >
                          <option value="">— none —</option>
                          {roles.map((r) => (
                            <option key={r.id} value={r.code}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-sm">{m.role?.name ?? "—"}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {m.is_superuser ? (
                        <span className="text-xs text-muted-foreground">All helpdesks</span>
                      ) : m.helpdesks.length === 0 ? (
                        <span className="text-xs text-muted-foreground">None</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {m.helpdesks.map((h) => (
                            <Badge key={h.id} variant="outline" className="font-normal">
                              {h.key}
                              {h.role_in_helpdesk === "lead" ? " · lead" : ""}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={m.is_active}
                        disabled={!canManage || isSelf || m.is_superuser || busy === String(m.id)}
                        onCheckedChange={(v) => void toggleActive(m, v)}
                        aria-label="Active"
                      />
                    </TableCell>
                    <TableCell>
                      {canManage && (!m.is_superuser || me?.is_superuser) ? (
                        <div className="flex items-center justify-end gap-1">
                          {/* A superuser's password (e.g. break-glass for an SSO admin) can only
                              be reset by another superuser — mirrors the backend rule. */}
                          <Button variant="ghost" size="sm" onClick={() => setResetUser(m)}>
                            <KeyRound className="mr-1.5 h-4 w-4" /> Reset password
                          </Button>
                          {!m.is_superuser ? (
                            <Button variant="ghost" size="sm" onClick={() => setManageUser(m)}>
                              <Settings2 className="mr-1.5 h-4 w-4" /> Helpdesks
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AddUserDialog
        open={adding}
        onOpenChange={setAdding}
        roles={roles}
        helpdesks={helpdesks}
        onCreated={reload}
      />

      <UserHelpdesksSheet
        open={Boolean(manageUser)}
        onOpenChange={(o) => !o && setManageUser(null)}
        user={manageUser}
        helpdesks={helpdesks}
        canManage={canManage}
        onChanged={reload}
      />

      <ResetPasswordDialog user={resetUser} onOpenChange={(o) => !o && setResetUser(null)} />
    </div>
  );
}

function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: Member | null;
  onOpenChange: (o: boolean) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);

  // Clear any revealed password when the target changes.
  useEffect(() => {
    setNewPassword(null);
  }, [user]);

  async function doReset() {
    if (!user) return;
    setSubmitting(true);
    try {
      const m = await membersApi.resetPassword(user.id);
      setNewPassword(m.temp_password ?? null);
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not reset the password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={Boolean(user)}
      onOpenChange={(o) => {
        if (!o) setNewPassword(null);
        onOpenChange(o);
      }}
    >
      <DialogContent>
        {newPassword ? (
          <>
            <DialogHeader>
              <DialogTitle>Password reset</DialogTitle>
              <DialogDescription>
                Share this new one-time password with {user?.full_name || user?.username}. It
                won&apos;t be shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
              {newPassword}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(newPassword);
                  toast.success("Password copied.");
                }}
              >
                Copy password
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Reset password?</DialogTitle>
              <DialogDescription>
                A new temporary password will be generated for{" "}
                {user?.full_name || user?.username}. Their current password stops working
                immediately.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={doReset} disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Reset password
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
  roles,
  helpdesks,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  roles: SystemRole[];
  helpdesks: Helpdesk[];
  onCreated: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [authMethod, setAuthMethod] = useState<"password" | "microsoft">("password");
  const [roleCode, setRoleCode] = useState("");
  const [selectedHelpdesks, setSelectedHelpdesks] = useState<string[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState("");
  const [ssoEnabled, setSsoEnabled] = useState(true);

  // Active projects (grouped by helpdesk) for the per-helpdesk project picker.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    projectsApi
      .list()
      .then((rows) => !cancelled && setProjects(rows.filter((p) => p.status === "active")))
      .catch(() => !cancelled && setProjects([]));
    // Is Microsoft sign-in actually enabled? Drives the warning under the method picker.
    ssoApi
      .publicConfig()
      .then((c) => !cancelled && setSsoEnabled(Boolean(c.microsoft_enabled)))
      .catch(() => !cancelled && setSsoEnabled(false));
    return () => {
      cancelled = true;
    };
  }, [open]);

  function reset() {
    setFullName("");
    setUsername("");
    setEmail("");
    setAuthMethod("password");
    setRoleCode("");
    setSelectedHelpdesks([]);
    setSelectedProjects([]);
  }

  function toggleHelpdesk(id: string, on: boolean) {
    setSelectedHelpdesks((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));
    if (!on) {
      // Drop project selections that belonged to the de-selected helpdesk.
      const drop = new Set(projects.filter((p) => p.helpdesk === id).map((p) => p.id));
      setSelectedProjects((cur) => cur.filter((pid) => !drop.has(pid)));
    }
  }

  function toggleProject(id: string, on: boolean) {
    setSelectedProjects((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));
  }

  async function submit() {
    if (!username.trim()) {
      toast.error("Username is required.");
      return;
    }
    if (authMethod === "microsoft" && !email.trim()) {
      toast.error("Email is required for a Microsoft sign-in user.");
      return;
    }
    if (roleCode === "requestor" && selectedHelpdesks.length > 0) {
      toast.error("Requestors can't be assigned helpdesks.");
      return;
    }
    setSubmitting(true);
    try {
      const member = await membersApi.createUser({
        username: username.trim(),
        email: email.trim() || undefined,
        full_name: fullName.trim() || undefined,
        auth_method: authMethod,
        role_code: roleCode || undefined,
        helpdesks: selectedHelpdesks.map((id) => ({ id, role_in_helpdesk: "member" })),
        projects: selectedProjects.map((id) => ({ id })),
      });
      setCreatedName(member.full_name || member.username);
      setTempPassword(member.temp_password ?? null);
      setDone(true);
      reset();
      onCreated();
    } catch (e) {
      const msg =
        e instanceof ItsmApiError
          ? e.fieldErrors?.username?.[0] ?? e.message
          : "Could not create the user.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setDone(false);
          setTempPassword(null);
          reset();
        }
        onOpenChange(o);
      }}
    >
      <DialogContent>
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>User created</DialogTitle>
              <DialogDescription>
                {tempPassword
                  ? `Share this one-time password with ${createdName}. It won't be shown again.`
                  : `${createdName} will sign in with Microsoft — no password is needed.`}
              </DialogDescription>
            </DialogHeader>
            {tempPassword ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
                {tempPassword}
              </div>
            ) : null}
            <DialogFooter>
              {tempPassword ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(tempPassword);
                    toast.success("Password copied.");
                  }}
                >
                  Copy password
                </Button>
              ) : null}
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add user</DialogTitle>
              <DialogDescription>
                Creates a user with a generated temporary password you can share.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="nu-name">Full name</Label>
                <Input id="nu-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="nu-username">Username *</Label>
                  <Input
                    id="nu-username"
                    value={username}
                    autoComplete="off"
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nu-email">Email{authMethod === "microsoft" ? " *" : ""}</Label>
                  <Input
                    id="nu-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nu-auth">Sign-in method</Label>
                <select
                  id="nu-auth"
                  value={authMethod}
                  onChange={(e) => setAuthMethod(e.target.value as "password" | "microsoft")}
                  className={`${SELECT_CLASS} w-full`}
                >
                  <option value="password">Username &amp; password</option>
                  <option value="microsoft">Microsoft (SSO)</option>
                </select>
                {authMethod === "microsoft" ? (
                  ssoEnabled ? (
                    <p className="text-xs text-muted-foreground">
                      Signs in with Microsoft using the email above — no password is created.
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      Microsoft sign-in isn&apos;t enabled for this organisation yet — this user won&apos;t be
                      able to sign in until you turn it on in Authentication settings.
                    </p>
                  )
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nu-role">ITSM role</Label>
                <select
                  id="nu-role"
                  value={roleCode}
                  onChange={(e) => {
                    const next = e.target.value;
                    setRoleCode(next);
                    // Requestors can't hold helpdesks/projects — drop any selection.
                    if (next === "requestor") {
                      setSelectedHelpdesks([]);
                      setSelectedProjects([]);
                    }
                  }}
                  className={`${SELECT_CLASS} w-full`}
                >
                  <option value="">— no role —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              {roleCode === "requestor" ? (
                <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  Requestors are portal-only end-users and don&apos;t get helpdesk access.
                </p>
              ) : helpdesks.length > 0 ? (
                <div className="space-y-1.5">
                  <Label>Helpdesks &amp; projects</Label>
                  <p className="text-xs text-muted-foreground">
                    Add as a member, then tick the projects they can work (assigning a helpdesk alone
                    grants no project tab). Promote to lead later from the row.
                  </p>
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                    {helpdesks.map((h) => {
                      const checked = selectedHelpdesks.includes(h.id);
                      const hdProjects = projects.filter((p) => p.helpdesk === h.id);
                      return (
                        <div key={h.id}>
                          <label className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/50">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => toggleHelpdesk(h.id, Boolean(v))}
                            />
                            <span className="min-w-0">
                              {h.name}
                              <span className="ml-1 text-xs text-muted-foreground">{h.key}</span>
                            </span>
                          </label>
                          {checked && hdProjects.length > 0 ? (
                            <div className="ml-6 space-y-0.5 border-l pl-2">
                              {hdProjects.map((p) => (
                                <label
                                  key={p.id}
                                  className="flex items-center gap-2 rounded px-1.5 py-0.5 text-xs hover:bg-accent/50"
                                >
                                  <Checkbox
                                    checked={selectedProjects.includes(p.id)}
                                    onCheckedChange={(v) => toggleProject(p.id, Boolean(v))}
                                  />
                                  <span className="min-w-0 truncate">
                                    {p.name}
                                    <span className="ml-1 text-muted-foreground">{p.key}</span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {roleCode && roleCode !== "requestor" && selectedHelpdesks.length === 0 ? (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      No helpdesk selected — this user won&apos;t be able to open the agent app until
                      one is assigned.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create user
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
