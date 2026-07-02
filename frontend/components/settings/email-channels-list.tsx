"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Mail, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { emailChannelsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import type { EmailChannel } from "@/lib/itsm/types";
import { EmptyState } from "@/components/shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { EmailChannelFormSheet } from "./email-channel-form-sheet";

export function EmailChannelsList({ canManage }: { canManage: boolean }) {
  const { allProjects } = useWorkspace();
  const projectIds = useMemo(() => new Set(allProjects.map((p) => p.id)), [allProjects]);
  const projectName = useMemo(
    () => new Map(allProjects.map((p) => [p.id, p.name])),
    [allProjects],
  );

  const [rows, setRows] = useState<EmailChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EmailChannel | null>(null);
  const [deleting, setDeleting] = useState<EmailChannel | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    emailChannelsApi
      .list()
      .then((all) => setRows(all.filter((c) => !c.project || projectIds.has(c.project))))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [projectIds]);

  useEffect(() => {
    load();
  }, [load]);

  async function pollNow(channel: EmailChannel) {
    setBusy(channel.id);
    try {
      const res = await emailChannelsApi.pollNow(channel.id);
      toast.success(`Polled ${channel.name}: ${res.processed} processed, ${res.failed} failed.`);
      load();
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Poll failed.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(deleting.id);
    try {
      await emailChannelsApi.delete(deleting.id);
      toast.success("Mailbox deleted.");
      setRows((r) => r.filter((x) => x.id !== deleting.id));
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not delete the mailbox.");
    } finally {
      setBusy(null);
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button className="gap-1" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New mailbox
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
          icon={Mail}
          title="No mailboxes yet"
          description="Connect a mailbox per project so inbound email becomes tickets and replies go out from the support address."
          action={
            canManage ? (
              <Button className="gap-1" onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Plus className="h-4 w-4" aria-hidden="true" /> New mailbox
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
                <TableHead>Address</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.address}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.project ? projectName.get(c.project) ?? "—" : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant={c.is_active ? "default" : "outline"}>
                        {c.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline" className="uppercase">{c.protocol}</Badge>
                      {c.is_oauth ? (
                        <Badge variant="outline">{c.oauth_authorized ? "OAuth ✓" : "OAuth ✗"}</Badge>
                      ) : null}
                      {c.last_error ? (
                        <span title={c.last_error}>
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => pollNow(c)}
                        aria-label="Poll now">
                        {busy === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(c); setFormOpen(true); }}>
                        {canManage ? "Edit" : "View"}
                      </Button>
                      {canManage ? (
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(c)} aria-label="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <EmailChannelFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        channel={editing}
        projects={allProjects}
        canManage={canManage}
        onSaved={load}
      />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete mailbox?</DialogTitle>
            <DialogDescription>
              “{deleting?.name}” will stop polling. Existing tickets are kept. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy === deleting?.id} onClick={confirmDelete}>
              {busy === deleting?.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
