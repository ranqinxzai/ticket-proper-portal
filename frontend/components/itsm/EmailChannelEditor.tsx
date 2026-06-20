"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, Loader2, Mail, Play, Plus, RefreshCw, Save, ShieldCheck, Trash2, XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { emailAdminApi } from "@/lib/itsm/admin-api";
import { ItsmApiError } from "@/lib/itsm/client";
import {
  EMAIL_AUTH_METHODS, EMAIL_PROTOCOLS, PRIORITIES, REOPEN_POLICIES,
} from "@/lib/itsm/admin-types";
import type { EmailChannel, EmailRule } from "@/lib/itsm/admin-types";
import type { Group, Project } from "@/lib/itsm/types";

const NO_PROJECT = "__none__";
const NO_GROUP = "__none__";

const PROTOCOL_LABELS: Record<string, string> = { imap: "IMAP", pop3: "POP3" };
const AUTH_LABELS: Record<string, string> = {
  basic: "Basic (password)",
  oauth_google: "OAuth – Google",
  oauth_microsoft: "OAuth – Microsoft",
};
const REOPEN_LABELS: Record<string, string> = {
  comment_only: "Comment only (keep closed)",
  reopen: "Reopen the ticket",
  new_ticket: "Open a new ticket",
};

export function errMessage(e: unknown, fallback: string): string {
  if (e instanceof ItsmApiError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

/** Empty channel form defaults for the "new channel" flow. */
export function emptyChannelForm(): Partial<EmailChannel> {
  return {
    name: "",
    address: "",
    domain: "",
    is_active: true,
    protocol: "imap",
    host: "",
    port: 993,
    use_ssl: true,
    username: "",
    folder: "INBOX",
    auth_method: "basic",
    create_users: true,
    default_requestor: null,
    default_priority: "medium",
    default_group: null,
    strip_quotes: true,
    cc_watchers: true,
    reopen_policy: "comment_only",
    reopen_window_days: 14,
    ignore_auto_replies: true,
    max_age_days: 30,
    max_size_bytes: 10485760,
    loop_window_min: 5,
    loop_max_messages: 10,
    poll_interval_seconds: null,
  };
}

type Props = {
  /** The persisted channel, or null when creating a new one. */
  channel: EmailChannel | null;
  projects: Project[];
  groups: Group[];
  busy: boolean;
  onSave: (body: Partial<EmailChannel>) => Promise<void>;
  onDelete: () => void;
  onTest: () => void;
  onPoll: () => void;
  onOauth: () => void;
};

export function EmailChannelEditor({
  channel, projects, groups, busy, onSave, onDelete, onTest, onPoll, onOauth,
}: Props) {
  const [form, setForm] = useState<Partial<EmailChannel>>(() => channel ?? emptyChannelForm());
  const [password, setPassword] = useState("");

  // Re-seed the form when switching the selected channel.
  useEffect(() => {
    setForm(channel ?? emptyChannelForm());
    setPassword("");
  }, [channel]);

  const set = useCallback(<K extends keyof EmailChannel>(key: K, value: EmailChannel[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isOauth = useMemo(
    () => form.auth_method === "oauth_google" || form.auth_method === "oauth_microsoft",
    [form.auth_method],
  );

  const oauthProvider = form.auth_method === "oauth_microsoft" ? "Microsoft" : "Google";

  function submit() {
    const body: Partial<EmailChannel> = { ...form };
    // Only send a password when the admin actually typed one.
    if (password.trim()) body.password = password;
    else delete body.password;
    // Drop read-only fields the serializer would reject / ignore.
    delete body.id;
    delete body.effective_domain;
    delete body.is_oauth;
    delete body.oauth_authorized;
    delete body.has_password;
    delete body.last_polled_at;
    delete body.last_seen_uid;
    delete body.last_error;
    delete body.created_at;
    void onSave(body).then(() => setPassword(""));
  }

  return (
    <div className="space-y-4">
      {/* Header / status */}
      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Mail className="h-4 w-4 text-indigo-500" />
          <Input
            value={form.name ?? ""}
            disabled={busy}
            placeholder="Channel name"
            className="h-9 max-w-[280px] font-medium"
            onChange={(e) => set("name", e.target.value)}
          />
          <label className="ml-2 flex items-center gap-2 text-sm">
            <Switch
              checked={Boolean(form.is_active)}
              disabled={busy}
              onCheckedChange={(v) => set("is_active", v)}
            />
            Active
          </label>
          {channel?.oauth_authorized && (
            <Badge variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-600">
              <ShieldCheck className="h-3 w-3" /> OAuth authorized
            </Badge>
          )}
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        {channel?.last_error && (
          <p className="mt-2 text-xs text-destructive">Last error: {channel.last_error}</p>
        )}
        {channel?.last_polled_at && (
          <p className="mt-1 text-xs text-muted-foreground">
            Last polled {new Date(channel.last_polled_at).toLocaleString()}
          </p>
        )}
      </div>

      {/* Identity */}
      <Section title="Identity">
        <Field label="Address" htmlFor="ec-address">
          <Input
            id="ec-address"
            type="email"
            value={form.address ?? ""}
            disabled={busy}
            placeholder="support@example.com"
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
        <Field label="Domain" htmlFor="ec-domain" hint={channel?.effective_domain ? `Effective: ${channel.effective_domain}` : undefined}>
          <Input
            id="ec-domain"
            value={form.domain ?? ""}
            disabled={busy}
            placeholder="example.com"
            onChange={(e) => set("domain", e.target.value)}
          />
        </Field>
      </Section>

      {/* Connection */}
      <Section title="Connection">
        <Field label="Protocol">
          <Select value={form.protocol ?? "imap"} disabled={busy} onValueChange={(v) => set("protocol", v as EmailChannel["protocol"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {EMAIL_PROTOCOLS.map((p) => (
                <SelectItem key={p} value={p}>{PROTOCOL_LABELS[p] ?? p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Host" htmlFor="ec-host">
          <Input id="ec-host" value={form.host ?? ""} disabled={busy} placeholder="imap.example.com" onChange={(e) => set("host", e.target.value)} />
        </Field>
        <Field label="Port" htmlFor="ec-port">
          <Input
            id="ec-port"
            type="number"
            min={0}
            value={form.port ?? ""}
            disabled={busy}
            onChange={(e) => set("port", e.target.value === "" ? 0 : Number(e.target.value))}
          />
        </Field>
        <Field label="Folder" htmlFor="ec-folder">
          <Input id="ec-folder" value={form.folder ?? ""} disabled={busy} placeholder="INBOX" onChange={(e) => set("folder", e.target.value)} />
        </Field>
        <Field label="Username" htmlFor="ec-username">
          <Input id="ec-username" value={form.username ?? ""} disabled={busy} onChange={(e) => set("username", e.target.value)} />
        </Field>
        <Field label="Authentication">
          <Select value={form.auth_method ?? "basic"} disabled={busy} onValueChange={(v) => set("auth_method", v as EmailChannel["auth_method"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {EMAIL_AUTH_METHODS.map((a) => (
                <SelectItem key={a} value={a}>{AUTH_LABELS[a] ?? a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <label className="col-span-full flex items-center gap-2 text-sm">
          <Switch checked={Boolean(form.use_ssl)} disabled={busy} onCheckedChange={(v) => set("use_ssl", v)} />
          Use SSL/TLS
        </label>

        {!isOauth && (
          <Field
            label="Password"
            htmlFor="ec-password"
            hint={channel?.has_password ? "Leave blank to keep the current password." : undefined}
          >
            <Input
              id="ec-password"
              type="password"
              value={password}
              disabled={busy}
              placeholder={channel?.has_password ? "••••••••" : "Mailbox password"}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}
      </Section>

      {/* OAuth */}
      {isOauth && (
        <Section title="OAuth">
          <div className="col-span-full flex flex-wrap items-center gap-3">
            {channel?.oauth_authorized ? (
              <Badge variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                <CheckCircle2 className="h-3 w-3" /> Authorized
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-amber-600">
                <XCircle className="h-3 w-3" /> Not authorized
              </Badge>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={busy || !channel}
              onClick={onOauth}
              title={!channel ? "Save the channel first" : undefined}
            >
              <ShieldCheck className="h-4 w-4" />
              {channel?.oauth_authorized ? `Reconnect ${oauthProvider}` : `Connect ${oauthProvider}`}
            </Button>
            {!channel && (
              <span className="text-xs text-muted-foreground">Save the channel before connecting.</span>
            )}
          </div>
        </Section>
      )}

      {/* Routing */}
      <Section title="Routing">
        <Field label="Project">
          <Select
            value={form.project ?? NO_PROJECT}
            disabled={busy}
            onValueChange={(v) => set("project", v === NO_PROJECT ? null : v)}
          >
            <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PROJECT}>No project</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Default group">
          <Select
            value={form.default_group ?? NO_GROUP}
            disabled={busy}
            onValueChange={(v) => set("default_group", v === NO_GROUP ? null : v)}
          >
            <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_GROUP}>Unassigned</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Default priority">
          <Select value={form.default_priority ?? "medium"} disabled={busy} onValueChange={(v) => set("default_priority", v as EmailChannel["default_priority"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}><span className="capitalize">{p}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>

      {/* Behaviour */}
      <Section title="Behaviour">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={Boolean(form.create_users)} disabled={busy} onCheckedChange={(v) => set("create_users", v)} />
          Create users for unknown senders
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={Boolean(form.strip_quotes)} disabled={busy} onCheckedChange={(v) => set("strip_quotes", v)} />
          Strip quoted replies
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={Boolean(form.cc_watchers)} disabled={busy} onCheckedChange={(v) => set("cc_watchers", v)} />
          Add CC recipients as watchers
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={Boolean(form.ignore_auto_replies)} disabled={busy} onCheckedChange={(v) => set("ignore_auto_replies", v)} />
          Ignore auto-replies
        </label>

        <Field label="Reopen policy">
          <Select value={form.reopen_policy ?? "comment_only"} disabled={busy} onValueChange={(v) => set("reopen_policy", v as EmailChannel["reopen_policy"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {REOPEN_POLICIES.map((p) => (
                <SelectItem key={p} value={p}>{REOPEN_LABELS[p] ?? p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <NumberField label="Reopen window (days)" value={form.reopen_window_days} busy={busy} onChange={(n) => set("reopen_window_days", n ?? 0)} />
        <NumberField label="Max age (days)" value={form.max_age_days} busy={busy} onChange={(n) => set("max_age_days", n ?? 0)} />
        <NumberField label="Max size (bytes)" value={form.max_size_bytes} busy={busy} onChange={(n) => set("max_size_bytes", n ?? 0)} />
        <NumberField label="Loop window (min)" value={form.loop_window_min} busy={busy} onChange={(n) => set("loop_window_min", n ?? 0)} />
        <NumberField label="Loop max messages" value={form.loop_max_messages} busy={busy} onChange={(n) => set("loop_max_messages", n ?? 0)} />
        <NumberField
          label="Poll interval (sec)"
          value={form.poll_interval_seconds ?? undefined}
          busy={busy}
          allowEmpty
          placeholder="default"
          onChange={(n) => set("poll_interval_seconds", n)}
        />
      </Section>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3">
        <Button size="sm" className="gap-1.5" disabled={busy} onClick={submit}>
          <Save className="h-4 w-4" /> {channel ? "Save changes" : "Create channel"}
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || !channel} onClick={onTest}>
          <RefreshCw className="h-4 w-4" /> Test connection
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || !channel} onClick={onPoll}>
          <Play className="h-4 w-4" /> Poll now
        </Button>
        {channel && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto gap-1.5 text-destructive hover:text-destructive"
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        )}
      </div>

      {channel && <EmailRulesSection channelId={channel.id} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-white">
      <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold">{title}</div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label, htmlFor, hint, children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function NumberField({
  label, value, busy, onChange, allowEmpty, placeholder,
}: {
  label: string;
  value: number | null | undefined;
  busy: boolean;
  onChange: (n: number | null) => void;
  allowEmpty?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        inputMode="numeric"
        value={value ?? ""}
        disabled={busy}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") onChange(allowEmpty ? null : 0);
          else onChange(Number(raw));
        }}
      />
    </div>
  );
}

// ---- filter rules ---------------------------------------------------------

const RULE_TYPE_LABELS: Record<string, string> = { block: "Block", allow: "Allow" };

function EmailRulesSection({ channelId }: { channelId: string }) {
  const [rules, setRules] = useState<EmailRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ruleType, setRuleType] = useState<EmailRule["rule_type"]>("block");
  const [pattern, setPattern] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRules(await emailAdminApi.rules.list(channelId));
    } catch (e) {
      toast.error(errMessage(e, "Failed to load filter rules"));
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addRule() {
    if (!pattern.trim()) {
      toast.error("Pattern is required");
      return;
    }
    setBusy(true);
    try {
      await emailAdminApi.rules.create({
        channel: channelId,
        rule_type: ruleType,
        pattern: pattern.trim(),
        note: note.trim(),
        is_active: true,
      });
      toast.success("Filter rule added");
      setPattern("");
      setNote("");
      await load();
    } catch (e) {
      toast.error(errMessage(e, "Could not add rule"));
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(id: string) {
    setBusy(true);
    try {
      await emailAdminApi.rules.remove(id);
      toast.success("Filter rule removed");
      await load();
    } catch (e) {
      toast.error(errMessage(e, "Could not remove rule"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(rule: EmailRule, value: boolean) {
    setBusy(true);
    try {
      await emailAdminApi.rules.update(rule.id, { is_active: value });
      await load();
    } catch (e) {
      toast.error(errMessage(e, "Could not update rule"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border bg-white">
      <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold">Filter rules</div>
      <div className="space-y-3 p-4">
        {loading ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading rules…
          </p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No filter rules. Inbound mail from any sender is processed.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {rules.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <Badge variant={r.rule_type === "block" ? "destructive" : "default"}>
                  {RULE_TYPE_LABELS[r.rule_type] ?? r.rule_type}
                </Badge>
                <span className="font-mono">{r.pattern}</span>
                {r.note && <span className="text-xs text-muted-foreground">{r.note}</span>}
                <label className="ml-auto flex items-center gap-1.5 text-xs">
                  <Switch checked={r.is_active} disabled={busy} onCheckedChange={(v) => toggleActive(r, v)} />
                  Active
                </label>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  disabled={busy}
                  title="Remove rule"
                  onClick={() => removeRule(r.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add rule */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">Type</Label>
            <Select value={ruleType} disabled={busy} onValueChange={(v) => setRuleType(v as EmailRule["rule_type"])}>
              <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="block">Block</SelectItem>
                <SelectItem value="allow">Allow</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Pattern</Label>
            <Input
              value={pattern}
              disabled={busy}
              className="h-8 w-[200px]"
              placeholder="*@spam.com"
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Note</Label>
            <Input
              value={note}
              disabled={busy}
              className="h-8 w-[200px]"
              placeholder="optional"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy} onClick={addRule}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>
    </section>
  );
}
