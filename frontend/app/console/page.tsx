"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { Building2, ExternalLink, Loader2, Plus, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { ThemeToggle } from "@/components/theme/theme-toggle";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PasswordField } from "@/components/console/password-field";
import { ConsoleGuard, useConsoleAuth } from "@/lib/console/auth";
import { ConsoleApiError, consoleApi, type Org, type OrgUser } from "@/lib/console/client";

const SLUG_RE = /^[a-z][a-z0-9_-]*$/;
const SYSTEM_USER = "email-bot";

function when(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

function OrgRow({
  org,
  busy,
  onToggle,
  onManage,
}: {
  org: Org;
  busy: boolean;
  onToggle: (active: boolean) => void;
  onManage: () => void;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">{org.name}</TableCell>
      <TableCell>
        <span className="font-mono text-xs text-muted-foreground">{org.schema_name}</span>
      </TableCell>
      <TableCell className="text-muted-foreground">{when(org.created_on)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
          <Switch
            checked={org.is_active}
            onCheckedChange={onToggle}
            disabled={busy}
            aria-label={org.is_active ? `Disable ${org.name}` : `Enable ${org.name}`}
          />
          <span className="text-xs text-muted-foreground">
            {org.is_active ? "Active" : "Disabled"}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={onManage} aria-label={`Manage ${org.name}`}>
            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
            Manage
          </Button>
          <Link
            href={org.login_url}
            className="inline-flex items-center gap-1 px-2 text-sm text-primary hover:underline"
          >
            Login <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </TableCell>
    </TableRow>
  );
}

/* ── Org settings section ─────────────────────────────────────────────── */

function OrgSettingsSection({
  org,
  admin,
  onSaved,
}: {
  /** The org as last loaded; its `schema_name` is the original/target for the PATCH. */
  org: Org;
  /** The org's primary administrator (first superuser), or null while loading. */
  admin: OrgUser | null;
  /** Called after a successful save. slugChanged → parent reloads + closes. */
  onSaved: (slugChanged: boolean) => void;
}) {
  const [name, setName] = useState(org.name);
  const [slug, setSlug] = useState(org.schema_name);
  const [active, setActive] = useState(org.is_active);
  const [adminEmail, setAdminEmail] = useState(admin?.email ?? "");
  const [adminPassword, setAdminPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  // Reset the form whenever the underlying org identity changes.
  useEffect(() => {
    setName(org.name);
    setSlug(org.schema_name);
    setActive(org.is_active);
    setErrors({});
  }, [org]);

  // The admin loads asynchronously (after the users fetch) — sync its email in.
  useEffect(() => {
    setAdminEmail(admin?.email ?? "");
    setAdminPassword("");
  }, [admin]);

  const slugChanged = slug !== org.schema_name;
  const slugValid = SLUG_RE.test(slug);
  const adminEmailChanged = !!admin && adminEmail.trim() !== (admin.email ?? "");
  const canSave = !busy && name.trim().length > 0 && slugValid;

  async function save() {
    if (!canSave) return;
    if (adminPassword && adminPassword.length < 8) {
      toast.error("Admin password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      // Update the admin FIRST — a slug change below renames the schema and would
      // invalidate the old slug used here.
      if (admin && (adminEmailChanged || adminPassword)) {
        await consoleApi.updateUser(org.schema_name, admin.username, {
          ...(adminEmailChanged ? { email: adminEmail.trim() } : {}),
          ...(adminPassword ? { password: adminPassword } : {}),
        });
      }
      await consoleApi.updateOrg(org.schema_name, {
        name: name.trim(),
        slug: slug.trim(),
        is_active: active,
      });
      toast.success("Saved.");
      setAdminPassword("");
      onSaved(slugChanged);
    } catch (e) {
      if (e instanceof ConsoleApiError && e.fieldErrors) setErrors(e.fieldErrors);
      toast.error(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold">Organisation settings</h3>

      <div className="space-y-1.5">
        <Label htmlFor="manage-org-name">Name</Label>
        <Input
          id="manage-org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Organisation name"
          disabled={busy}
        />
        {errors.name?.[0] ? <p className="text-xs text-destructive">{errors.name[0]}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="manage-org-slug">Slug (URL)</Label>
        <Input
          id="manage-org-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          placeholder="acme"
          className="font-mono"
          aria-invalid={!slugValid}
          disabled={busy}
        />
        <p className="text-xs text-muted-foreground">
          Reached at <code className="font-mono">/t/{slug || "<slug>"}/</code>. Lowercase; starts with
          a letter; letters, digits, <code>-</code> or <code>_</code>.
        </p>
        {!slugValid && slug.length > 0 ? (
          <p className="text-xs text-destructive">Invalid slug format.</p>
        ) : null}
        {errors.slug?.[0] ? <p className="text-xs text-destructive">{errors.slug[0]}</p> : null}
        {slugChanged && slugValid ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            ⚠ Changing the slug renames the org&apos;s URL and schema. The old{" "}
            <code className="font-mono">/t/{org.schema_name}/</code> links stop working and any
            logged-in users must sign in again at <code className="font-mono">/t/{slug}/</code>.
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div>
          <Label htmlFor="manage-org-active" className="text-sm">Active</Label>
          <p className="text-xs text-muted-foreground">A disabled org returns 404 at its URL.</p>
        </div>
        <Switch
          id="manage-org-active"
          checked={active}
          onCheckedChange={setActive}
          disabled={busy}
        />
      </div>

      {admin ? (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <div>
            <h4 className="text-xs font-semibold">Administrator</h4>
            <p className="text-xs text-muted-foreground">
              Owner account <code className="font-mono">{admin.username}</code> — the login for{" "}
              <code className="font-mono">/t/{org.schema_name}/login</code>. (Manage all users below.)
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manage-admin-email" className="text-xs">
              Admin email
            </Label>
            <Input
              id="manage-admin-email"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@example.com"
              autoComplete="off"
              disabled={busy}
            />
          </div>
          <PasswordField
            id="manage-admin-password"
            label="Admin password (leave blank to keep current)"
            value={adminPassword}
            onChange={setAdminPassword}
            disabled={busy}
            placeholder="Set a new password"
          />
        </div>
      ) : null}

      <div>
        <Button onClick={save} disabled={!canSave}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Save changes
        </Button>
      </div>
    </section>
  );
}

/* ── User row ─────────────────────────────────────────────────────────── */

function UserRow({
  schemaName,
  user,
  onChanged,
}: {
  schemaName: string;
  user: OrgUser;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // Edit form state.
  const [email, setEmail] = useState(user.email);
  const [fullName, setFullName] = useState(user.full_name);
  const [active, setActive] = useState(user.is_active);
  const [admin, setAdmin] = useState(user.is_superuser);
  const [newPassword, setNewPassword] = useState("");

  const isSystem = user.username === SYSTEM_USER;

  function openEdit() {
    setEmail(user.email);
    setFullName(user.full_name);
    setActive(user.is_active);
    setAdmin(user.is_superuser);
    setNewPassword("");
    setConfirmDelete(false);
    setEditing(true);
  }

  async function saveEdit() {
    if (busy) return;
    if (newPassword.length > 0 && newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const body = isSystem
        ? { ...(newPassword ? { password: newPassword } : {}) }
        : {
            email: email.trim(),
            full_name: fullName.trim(),
            is_active: active,
            is_admin: admin,
            ...(newPassword ? { password: newPassword } : {}),
          };
      await consoleApi.updateUser(schemaName, user.username, body);
      toast.success(`Updated ${user.username}.`);
      setEditing(false);
      setNewPassword("");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the user.");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await consoleApi.deleteUser(schemaName, user.username);
      toast.success(`Deleted ${user.username}.`);
      onChanged();
    } catch (e) {
      // Backend blocks deleting the system user / last admin with a 400 {detail}.
      toast.error(e instanceof Error ? e.message : "Could not delete the user.");
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <li className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="truncate">{user.full_name || user.username}</span>
            {user.is_superuser ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                admin
              </span>
            ) : null}
            {!user.is_active ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                inactive
              </span>
            ) : null}
            {isSystem ? (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                system
              </span>
            ) : null}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {user.username}
            {user.email ? ` · ${user.email}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => (editing ? setEditing(false) : openEdit())}
            disabled={busy}
          >
            {editing ? "Close" : "Edit"}
          </Button>
          {confirmDelete ? (
            <>
              <Button variant="destructive" size="sm" onClick={doDelete} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Confirm"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              aria-label={`Delete ${user.username}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
          {isSystem ? (
            <p className="text-xs text-muted-foreground">
              This is the system <code className="font-mono">{SYSTEM_USER}</code> account. Only its
              password can be changed here.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`edit-email-${user.username}`} className="text-xs">
                    Email
                  </Label>
                  <Input
                    id={`edit-email-${user.username}`}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="off"
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`edit-name-${user.username}`} className="text-xs">
                    Full name
                  </Label>
                  <Input
                    id={`edit-name-${user.username}`}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    autoComplete="off"
                    disabled={busy}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={active} onCheckedChange={setActive} disabled={busy} />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={admin} onCheckedChange={setAdmin} disabled={busy} />
                  Org admin
                </label>
              </div>
            </>
          )}

          <PasswordField
            id={`edit-pw-${user.username}`}
            label="New password (optional, min 8 chars)"
            value={newPassword}
            onChange={setNewPassword}
            disabled={busy}
            placeholder="Leave blank to keep current"
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveEdit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/* ── Add-user form ────────────────────────────────────────────────────── */

function AddUserForm({
  schemaName,
  onCreated,
}: {
  schemaName: string;
  onCreated: () => void;
}) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function reset() {
    setUsername("");
    setPassword("");
    setEmail("");
    setFullName("");
    setAdmin(false);
    setErrors({});
  }

  const canSubmit = !busy && username.trim().length > 0 && password.length >= 8;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setErrors({});
    try {
      await consoleApi.createUser(schemaName, {
        username: username.trim(),
        password,
        email: email.trim() || undefined,
        full_name: fullName.trim() || undefined,
        is_admin: admin,
      });
      toast.success(`Created ${username.trim()}.`);
      reset();
      setOpen(false);
      onCreated();
    } catch (e) {
      if (e instanceof ConsoleApiError && e.fieldErrors) setErrors(e.fieldErrors);
      toast.error(e instanceof Error ? e.message : "Could not create the user.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add user
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <h4 className="text-xs font-semibold">New user</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${ids}-username`} className="text-xs">
            Username
          </Label>
          <Input
            id={`${ids}-username`}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
          {errors.username?.[0] ? (
            <p className="text-xs text-destructive">{errors.username[0]}</p>
          ) : null}
        </div>
        <div className="space-y-1">
          <PasswordField
            id={`${ids}-password`}
            label="Password (min 8)"
            value={password}
            onChange={setPassword}
            disabled={busy}
          />
          {errors.password?.[0] ? (
            <p className="text-xs text-destructive">{errors.password[0]}</p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${ids}-email`} className="text-xs">
            Email (optional)
          </Label>
          <Input
            id={`${ids}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
          {errors.email?.[0] ? <p className="text-xs text-destructive">{errors.email[0]}</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${ids}-fullname`} className="text-xs">
            Full name (optional)
          </Label>
          <Input
            id={`${ids}-fullname`}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
          {errors.full_name?.[0] ? (
            <p className="text-xs text-destructive">{errors.full_name[0]}</p>
          ) : null}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={admin}
          onCheckedChange={(v) => setAdmin(v === true)}
          disabled={busy}
        />
        Org admin
      </label>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={!canSubmit}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Create user
        </Button>
      </div>
    </div>
  );
}

/* ── Users section ────────────────────────────────────────────────────── */

function UsersSection({
  schemaName,
  users,
  loading,
  reload,
}: {
  schemaName: string;
  users: OrgUser[];
  loading: boolean;
  reload: () => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Users</h3>
        <AddUserForm schemaName={schemaName} onCreated={reload} />
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Loading users…</div>
      ) : users.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          No users in this organisation.
        </div>
      ) : (
        <ul className="divide-y rounded-md border">
          {users.map((u) => (
            <UserRow key={u.username} schemaName={schemaName} user={u} onChanged={reload} />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Danger zone ──────────────────────────────────────────────────────── */

function DangerZone({
  org,
  onDeleted,
}: {
  org: Org;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const canDelete = !busy && typed === org.schema_name;

  async function doDelete() {
    if (!canDelete) return;
    setBusy(true);
    try {
      await consoleApi.deleteOrg(org.schema_name);
      toast.success(`Deleted ${org.name}.`);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the organisation.");
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
      <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
      {!confirming ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Deleting this organisation drops the org and all its data. This is irreversible.
          </p>
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0"
            onClick={() => {
              setTyped("");
              setConfirming(true);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete organisation
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-destructive">
            This permanently drops <span className="font-medium">{org.name}</span> and all its data.
            To confirm, type the slug{" "}
            <code className="font-mono">{org.schema_name}</code> below.
          </p>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={org.schema_name}
            className="font-mono"
            autoComplete="off"
            disabled={busy}
            aria-label="Type the org slug to confirm deletion"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirming(false);
                setTyped("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={doDelete} disabled={!canDelete}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Delete forever
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ── Manage dialog (one dialog, all sections) ─────────────────────────── */

function ManageOrgDialog({
  org,
  onClose,
  onReload,
}: {
  org: Org | null;
  /** Close the dialog (and clear the selected org). */
  onClose: () => void;
  /** Reload the org list (slug/name/status may have changed). */
  onReload: () => void;
}) {
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  const reloadUsers = useCallback(() => {
    if (!org) return;
    setUsersLoading(true);
    consoleApi
      .listUsers(org.schema_name)
      .then(setUsers)
      .catch(() => toast.error("Could not load users."))
      .finally(() => setUsersLoading(false));
  }, [org]);

  useEffect(() => {
    if (org) reloadUsers();
  }, [org, reloadUsers]);

  const primaryAdmin = users.find((u) => u.is_superuser) ?? null;

  return (
    <Dialog
      open={org !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage — {org?.name}</DialogTitle>
          <DialogDescription>
            Edit this organisation&apos;s settings, manage its users, or delete it.
          </DialogDescription>
        </DialogHeader>

        {org ? (
          <div className="space-y-8 pt-2">
            <OrgSettingsSection
              // Re-mount the form when the slug changes so it picks up the new identity.
              key={org.schema_name}
              org={org}
              admin={primaryAdmin}
              onSaved={(slugChanged) => {
                onReload();
                // A renamed schema invalidates the rest of this dialog's API calls.
                if (slugChanged) onClose();
                else reloadUsers();
              }}
            />

            <UsersSection
              schemaName={org.schema_name}
              users={users}
              loading={usersLoading}
              reload={reloadUsers}
            />

            <DangerZone
              org={org}
              onDeleted={() => {
                onReload();
                onClose();
              }}
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

function ConsoleOrgs() {
  const { user, logout } = useConsoleAuth();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manageOrg, setManageOrg] = useState<Org | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrgs(await consoleApi.listOrgs());
    } catch {
      toast.error("Could not load organisations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(org: Org, active: boolean) {
    setBusyId(org.schema_name);
    setOrgs((cur) =>
      cur.map((o) => (o.schema_name === org.schema_name ? { ...o, is_active: active } : o)),
    );
    try {
      await consoleApi.updateOrg(org.schema_name, { is_active: active });
    } catch {
      setOrgs((cur) =>
        cur.map((o) =>
          o.schema_name === org.schema_name ? { ...o, is_active: org.is_active } : o,
        ),
      );
      toast.error("Could not update the organisation.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header role="banner" className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <span className="font-semibold tracking-tight">Platform Console</span>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <span className="text-sm text-muted-foreground">{user?.full_name || user?.username}</span>
            <Button variant="ghost" size="sm" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <PageHeader
          title="Organisations"
          description={
            <>
              Each organisation is an isolated tenant reached at{" "}
              <code className="font-mono">/t/&lt;slug&gt;/</code>.
            </>
          }
          actions={
            <Button asChild>
              <Link href="/console/orgs/new">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New organisation
              </Link>
            </Button>
          }
        />

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : orgs.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No organisations yet"
            description="Create your first organisation to provision an isolated tenant."
            action={
              <Button asChild>
                <Link href="/console/orgs/new">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New organisation
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="rounded-xl border bg-card shadow-soft">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map((org) => (
                  <OrgRow
                    key={org.schema_name}
                    org={org}
                    busy={busyId === org.schema_name}
                    onToggle={(v) => toggle(org, v)}
                    onManage={() => setManageOrg(org)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      <ManageOrgDialog
        org={manageOrg}
        onClose={() => setManageOrg(null)}
        onReload={() => void load()}
      />
    </div>
  );
}

export default function ConsolePage() {
  return (
    <ConsoleGuard>
      <ConsoleOrgs />
    </ConsoleGuard>
  );
}
