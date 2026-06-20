"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, ListChecks, Loader2, Mail, Plus, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { emailAdminApi } from "@/lib/itsm/admin-api";
import { groupsApi, projectsApi } from "@/lib/itsm/api";
import type { EmailChannel } from "@/lib/itsm/admin-types";
import type { Group, Project } from "@/lib/itsm/types";
import { ItsmApiError } from "@/lib/itsm/client";
import { useItsmAuth } from "@/lib/itsm/auth";
import { EmailChannelEditor, errMessage } from "@/components/itsm/EmailChannelEditor";

const NEW_CHANNEL = "__new__";

const AUTH_BADGE: Record<string, string> = {
  basic: "Basic",
  oauth_google: "Google",
  oauth_microsoft: "Microsoft",
};

export default function EmailChannelsAdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loading: authLoading, hasPerm, isSupervisor } = useItsmAuth();
  const allowed = isSupervisor || hasPerm("itsm.email.channels", "read");

  const [channels, setChannels] = useState<EmailChannel[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Selected channel id, or NEW_CHANNEL for the create form, or null. */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !allowed) router.replace("/queues");
  }, [authLoading, allowed, router]);

  // Surface the OAuth redirect outcome.
  useEffect(() => {
    const oauth = searchParams.get("oauth");
    if (oauth === "success") toast.success("Mailbox authorized successfully");
    else if (oauth === "error") toast.error("OAuth authorization failed or was cancelled");
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [chs, projs, grps] = await Promise.all([
        emailAdminApi.channels.list(),
        projectsApi.list(),
        groupsApi.list(),
      ]);
      setChannels(chs);
      setProjects(projs);
      setGroups(grps);
      setSelectedId((prev) => {
        if (prev === NEW_CHANNEL) return prev;
        if (prev && chs.some((c) => c.id === prev)) return prev;
        return chs[0]?.id ?? null;
      });
    } catch (e) {
      setError(errMessage(e, "Failed to load email channels"));
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const selected = useMemo<EmailChannel | null>(() => {
    if (!selectedId || selectedId === NEW_CHANNEL) return null;
    return channels.find((c) => c.id === selectedId) ?? null;
  }, [channels, selectedId]);

  const isCreating = selectedId === NEW_CHANNEL;

  const handleSave = useCallback(
    async (body: Partial<EmailChannel>) => {
      setBusy(true);
      try {
        if (selected) {
          await emailAdminApi.channels.update(selected.id, body);
          toast.success("Channel saved");
        } else {
          const created = await emailAdminApi.channels.create(body);
          toast.success("Channel created");
          setSelectedId(created.id);
        }
        await load();
      } catch (e) {
        toast.error(errMessage(e, "Could not save channel"));
      } finally {
        setBusy(false);
      }
    },
    [selected, load],
  );

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    if (!window.confirm(`Delete the "${selected.name}" channel? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await emailAdminApi.channels.remove(selected.id);
      toast.success("Channel deleted");
      setSelectedId(null);
      await load();
    } catch (e) {
      toast.error(errMessage(e, "Could not delete channel"));
    } finally {
      setBusy(false);
    }
  }, [selected, load]);

  const handleTest = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await emailAdminApi.channels.testConnection(selected.id);
      if (res.ok) toast.success(res.detail || "Connection OK");
      else toast.error(res.detail || "Connection failed");
    } catch (e) {
      toast.error(errMessage(e, "Test connection failed"));
    } finally {
      setBusy(false);
    }
  }, [selected]);

  const handlePoll = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await emailAdminApi.channels.pollNow(selected.id);
      if (res.error) toast.error(res.error);
      else toast.success(`Polled: ${res.processed} processed, ${res.failed} failed`);
      await load();
    } catch (e) {
      toast.error(errMessage(e, "Poll failed"));
    } finally {
      setBusy(false);
    }
  }, [selected, load]);

  const handleOauth = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await emailAdminApi.channels.oauthStart(selected.id);
      if (res.authorize_url) {
        window.open(res.authorize_url, "_blank", "noopener,noreferrer");
        toast.message("Complete the consent in the new tab, then return here.");
      } else {
        toast.error("No authorization URL returned");
      }
    } catch (e) {
      toast.error(errMessage(e, "Could not start OAuth"));
    } finally {
      setBusy(false);
    }
  }, [selected]);

  if (authLoading || !allowed) {
    return <div className="grid place-items-center py-20 text-sm text-muted-foreground">Checking access…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/admin" className="text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Mail className="h-5 w-5 text-indigo-500" />
        <h1 className="text-xl font-semibold">Email Channels</h1>
        <Link href="/admin/email/logs" className="ml-2">
          <Button size="sm" variant="outline" className="gap-1.5">
            <ListChecks className="h-4 w-4" /> Email logs
          </Button>
        </Link>
        <Button size="sm" className="ml-auto gap-1.5" onClick={() => setSelectedId(NEW_CHANNEL)}>
          <Plus className="h-4 w-4" /> New channel
        </Button>
      </div>

      {loading ? (
        <div className="grid place-items-center py-20 text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-destructive">{error}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* Channel list */}
          <div className="space-y-2">
            {channels.length === 0 && !isCreating ? (
              <div className="rounded-lg border bg-white p-6 text-center text-sm text-muted-foreground">
                No email channels yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border bg-white divide-y">
                {channels.map((c) => {
                  const active = c.id === selectedId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={
                        "flex w-full flex-col gap-1 px-3 py-2.5 text-left transition " +
                        (active ? "bg-indigo-50" : "hover:bg-muted/40")
                      }
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{c.name || "(unnamed)"}</span>
                        {c.oauth_authorized && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                        <Badge variant={c.is_active ? "default" : "outline"} className="ml-auto shrink-0">
                          {c.is_active ? "Active" : "Off"}
                        </Badge>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{c.address}</div>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="text-[10px]">{c.protocol.toUpperCase()}</Badge>
                        <Badge variant="outline" className="text-[10px]">{AUTH_BADGE[c.auth_method] ?? c.auth_method}</Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Editor */}
          <div>
            {isCreating || selected ? (
              <EmailChannelEditor
                key={selected?.id ?? NEW_CHANNEL}
                channel={selected}
                projects={projects}
                groups={groups}
                busy={busy}
                onSave={handleSave}
                onDelete={handleDelete}
                onTest={handleTest}
                onPoll={handlePoll}
                onOauth={handleOauth}
              />
            ) : (
              <div className="grid place-items-center rounded-lg border bg-white p-12 text-center text-sm text-muted-foreground">
                Select a channel on the left, or create a new one.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
