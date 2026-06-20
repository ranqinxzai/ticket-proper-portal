"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { helpdesksApi, usersApi, type HelpdeskMember } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useItsmAuth } from "@/lib/itsm/auth";
import type { AccountUser, Helpdesk } from "@/lib/itsm/types";

export default function AdminHelpdesksPage() {
  const router = useRouter();
  const { loading, isSupervisor } = useItsmAuth();
  const [helpdesks, setHelpdesks] = useState<Helpdesk[] | null>(null);

  const reload = useCallback(() => {
    helpdesksApi.list().then(setHelpdesks).catch(() => setHelpdesks([]));
  }, []);

  useEffect(() => {
    if (!loading && !isSupervisor) router.replace("/queues");
  }, [loading, isSupervisor, router]);

  useEffect(() => { reload(); }, [reload]);

  if (loading || !isSupervisor) {
    return <div className="grid place-items-center py-20 text-sm text-muted-foreground">Checking access…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/admin")} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Building2 className="h-5 w-5 text-indigo-500" />
        <h1 className="text-xl font-semibold">Helpdesks</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Each helpdesk is a department workspace with its own Incident and Request projects. Agents only
        see the helpdesks they are a member of.
      </p>

      <CreateHelpdesk onCreated={reload} />

      {helpdesks === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : helpdesks.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">
          No helpdesks yet — create one above.
        </div>
      ) : (
        <div className="space-y-3">
          {helpdesks.map((h) => <HelpdeskRow key={h.id} helpdesk={h} />)}
        </div>
      )}
    </div>
  );
}

function CreateHelpdesk({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim() || !key.trim()) {
      toast.error("Name and key are required");
      return;
    }
    setBusy(true);
    try {
      await helpdesksApi.create({ name: name.trim(), key: key.trim().toUpperCase(), description: description.trim() });
      toast.success("Helpdesk created");
      setName(""); setKey(""); setDescription("");
      onCreated();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not create helpdesk");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-3 text-sm font-semibold">New helpdesk</div>
      <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
        <div className="grid gap-1.5">
          <Label htmlFor="hd-name">Name</Label>
          <Input id="hd-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Facilities Helpdesk" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hd-key">Code</Label>
          <Input id="hd-key" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="FAC" maxLength={5} />
        </div>
      </div>
      <div className="mt-3 grid gap-1.5">
        <Label htmlFor="hd-desc">Description</Label>
        <Input id="hd-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this helpdesk supports" />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        The code (2–5 uppercase chars) prefixes ticket numbers, e.g. <span className="font-mono">FACINC-1</span>.
        Run <span className="font-mono">seed_itsm</span> after creating to scaffold its Incident/Request projects.
      </p>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={submit} disabled={busy} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create
        </Button>
      </div>
    </div>
  );
}

function HelpdeskRow({ helpdesk }: { helpdesk: Helpdesk }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-white">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold text-white"
          style={{ backgroundColor: helpdesk.color || "#6366f1" }}>
          {helpdesk.key}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{helpdesk.name}</div>
          <div className="truncate text-xs text-muted-foreground">{helpdesk.description || "—"}</div>
        </div>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Members"}</span>
      </button>
      {open && <MemberManager helpdesk={helpdesk} />}
    </div>
  );
}

function MemberManager({ helpdesk }: { helpdesk: Helpdesk }) {
  const [members, setMembers] = useState<HelpdeskMember[] | null>(null);
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [toAdd, setToAdd] = useState<string>("");

  const reload = useCallback(() => {
    helpdesksApi.members(helpdesk.id).then(setMembers).catch(() => setMembers([]));
  }, [helpdesk.id]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { usersApi.list().then(setUsers).catch(() => setUsers([])); }, []);

  async function add() {
    if (!toAdd) return;
    try {
      await helpdesksApi.addMember(helpdesk.id, toAdd);
      setToAdd("");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add member");
    }
  }

  async function remove(userId: string) {
    try {
      await helpdesksApi.removeMember(helpdesk.id, userId);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove member");
    }
  }

  return (
    <div className="border-t p-4">
      <div className="mb-2 flex items-end gap-2">
        <div className="grid flex-1 gap-1.5">
          <Label className="text-xs">Add member</Label>
          <Select value={toAdd} onValueChange={setToAdd}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Choose a user…" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {users.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>{u.full_name || u.username}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={add} disabled={!toAdd} className="gap-1.5">
          <UserPlus className="h-4 w-4" /> Add
        </Button>
      </div>

      {members === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : members.length === 0 ? (
        <p className="text-xs text-muted-foreground">No members yet.</p>
      ) : (
        <ul className="divide-y">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="flex-1 truncate">{m.full_name || m.username}</span>
              <span className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{m.role_in_helpdesk}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => remove(String(m.user))} aria-label="Remove">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
