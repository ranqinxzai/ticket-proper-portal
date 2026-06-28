"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { emailChannelsApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { EmailChannel, Project } from "@/lib/itsm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { EmailPriorityMapEditor } from "./email-priority-map-editor";
import { EmailRulesEditor } from "./email-rules-editor";
import { FieldRow, fieldError } from "./field-row";

const MB = 1024 * 1024;
const toMb = (b: number) => Math.round((b / MB) * 10) / 10;
const fromMb = (mb: number) => Math.round(mb * MB);

type FormState = Partial<EmailChannel> & { password?: string; smtp_password?: string };

const DEFAULTS: FormState = {
  name: "", address: "", domain: "", is_active: true,
  protocol: "imap", host: "", port: 993, use_ssl: true, username: "", folder: "INBOX",
  auth_method: "basic", oauth_client_id: "", oauth_tenant_id: "",
  outbound_enabled: true, smtp_host: "", smtp_port: 587, smtp_security: "starttls",
  smtp_username: "", smtp_from_name: "",
  create_users: true, default_priority: "medium", priority_map: {}, max_attachment_bytes: 10 * MB,
  strip_quotes: true, cc_watchers: true, ignore_auto_replies: true,
  reopen_policy: "comment_only", reopen_window_days: 14,
  max_age_days: 7, max_size_bytes: 25 * MB, loop_window_min: 10, loop_max_messages: 30,
};

const FIXED_MAPPINGS = [
  { from: "Email Subject", to: "Ticket Summary" },
  { from: "Email Body", to: "Ticket Description" },
  { from: "Sender (From)", to: "Requestor" },
  { from: "CC recipients", to: "Watchers" },
  { from: "Attachments", to: "Attachments" },
];

/** A bordered group of related fields with a heading — gives the form structure. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** A switch presented as a full-width labelled row (title + helper + switch). */
function ToggleRow({
  checked,
  onCheckedChange,
  disabled,
  title,
  description,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  title: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3 text-sm transition-colors hover:bg-accent/40">
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="mt-0.5 shrink-0"
      />
    </label>
  );
}

export function EmailChannelFormSheet({
  open,
  onOpenChange,
  channel,
  projects,
  canManage,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel?: EmailChannel | null;
  projects: Project[];
  canManage: boolean;
  onSaved: () => void;
}) {
  const baseId = useId();
  const params = useParams<{ org: string }>();
  const org = params?.org ?? "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const redirectUri = org ? `${origin}/api/v1/t/${org}/itsm/email/oauth/callback/` : "";
  const editing = Boolean(channel);
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<"inbound" | "smtp" | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(channel ? { ...channel, password: "", smtp_password: "" } : { ...DEFAULTS });
  }, [open, channel]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isOauth = form.auth_method === "oauth_google" || form.auth_method === "oauth_microsoft";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setErrors({});
    // Only send secrets when the admin actually typed one.
    const body: Partial<EmailChannel> = { ...form } as Partial<EmailChannel>;
    if (!form.password) delete (body as FormState).password;
    if (!form.smtp_password) delete (body as FormState).smtp_password;
    if (!form.oauth_client_secret) delete (body as FormState).oauth_client_secret;
    try {
      if (editing && channel) {
        await emailChannelsApi.update(channel.id, body);
        toast.success("Mailbox updated.");
      } else {
        await emailChannelsApi.create(body);
        toast.success("Mailbox created.");
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ItsmApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        toast.error(err.message);
      } else {
        toast.error("Could not save the mailbox.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function runTest(kind: "inbound" | "smtp") {
    if (!channel) return;
    setTesting(kind);
    try {
      const res = kind === "inbound"
        ? await emailChannelsApi.testConnection(channel.id)
        : await emailChannelsApi.testSmtp(channel.id);
      if (res.ok) toast.success(res.detail);
      else toast.error(res.detail);
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Test failed.");
    } finally {
      setTesting(null);
    }
  }

  async function connectOauth() {
    if (!channel) return;
    try {
      const { authorize_url } = await emailChannelsApi.oauthStart(channel.id);
      window.location.href = authorize_url;
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not start OAuth.");
    }
  }

  const fieldsDisabled = !canManage || busy;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:w-[92vw] md:w-[78vw] lg:w-[58vw] lg:min-w-[720px] lg:max-w-[1080px]">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit mailbox" : "New mailbox"}</SheetTitle>
          <SheetDescription>
            Connect a mailbox so inbound email becomes tickets, and replies/acknowledgements go out
            from this address.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <Tabs defaultValue="connection" className="flex min-h-0 flex-1 flex-col">
            <div className="border-b px-5 py-3">
              <TabsList className="grid w-full grid-cols-2 gap-1 sm:grid-cols-5">
                <TabsTrigger value="connection">Connection</TabsTrigger>
                <TabsTrigger value="outbound">Outbound</TabsTrigger>
                <TabsTrigger value="mapping">Field Mapping</TabsTrigger>
                <TabsTrigger value="processing">Processing</TabsTrigger>
                <TabsTrigger value="domains">Domains</TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {/* ── Connection ─────────────────────────────────────────── */}
              <TabsContent value="connection" className="mt-0 space-y-5">
                <Section title="Mailbox" description="What this inbox is called and where its tickets land.">
                  <FieldRow label="Name" htmlFor={`${baseId}-name`} error={fieldError(errors, "name")} required>
                    <Input id={`${baseId}-name`} value={form.name ?? ""} disabled={fieldsDisabled}
                      placeholder="e.g. IT Support Inbox"
                      onChange={(e) => set("name", e.target.value)} />
                  </FieldRow>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FieldRow label="Project" error={fieldError(errors, "project")} required
                      hint="The project tickets land in. One mailbox per project.">
                      <Select value={form.project ?? ""} disabled={fieldsDisabled}
                        onValueChange={(v) => set("project", v)}>
                        <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
                        <SelectContent>
                          {projects.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FieldRow>
                    <FieldRow label="Mailbox address" htmlFor={`${baseId}-addr`} error={fieldError(errors, "address")} required
                      hint="e.g. support@company.com">
                      <Input id={`${baseId}-addr`} type="email" value={form.address ?? ""} disabled={fieldsDisabled}
                        placeholder="support@company.com"
                        onChange={(e) => set("address", e.target.value)} />
                    </FieldRow>
                  </div>
                </Section>

                <Section title="Inbound server" description="Where new mail is fetched from.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FieldRow label="Protocol">
                      <Select value={form.protocol ?? "imap"} disabled={fieldsDisabled}
                        onValueChange={(v) => set("protocol", v as EmailChannel["protocol"])}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="imap">IMAP</SelectItem>
                          <SelectItem value="pop3">POP3</SelectItem>
                        </SelectContent>
                      </Select>
                    </FieldRow>
                    <FieldRow label="Auth method">
                      <Select value={form.auth_method ?? "basic"} disabled={fieldsDisabled}
                        onValueChange={(v) => set("auth_method", v as EmailChannel["auth_method"])}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="basic">Username &amp; password</SelectItem>
                          <SelectItem value="oauth_google">Google (OAuth2)</SelectItem>
                          <SelectItem value="oauth_microsoft">Microsoft 365 (OAuth2)</SelectItem>
                        </SelectContent>
                      </Select>
                    </FieldRow>
                    <FieldRow label="Host" htmlFor={`${baseId}-host`} hint="Blank ⇒ provider default (OAuth)">
                      <Input id={`${baseId}-host`} value={form.host ?? ""} disabled={fieldsDisabled}
                        placeholder="imap.gmail.com"
                        onChange={(e) => set("host", e.target.value)} />
                    </FieldRow>
                    <FieldRow label="Port">
                      <Input type="number" value={form.port ?? 993} disabled={fieldsDisabled}
                        onChange={(e) => set("port", Number(e.target.value))} />
                    </FieldRow>
                    <FieldRow label="Username" htmlFor={`${baseId}-user`}>
                      <Input id={`${baseId}-user`} value={form.username ?? ""} disabled={fieldsDisabled}
                        onChange={(e) => set("username", e.target.value)} />
                    </FieldRow>
                    <FieldRow label="Folder">
                      <Input value={form.folder ?? "INBOX"} disabled={fieldsDisabled}
                        onChange={(e) => set("folder", e.target.value)} />
                    </FieldRow>
                  </div>
                  <ToggleRow
                    title="Use SSL/TLS"
                    description="Recommended. Encrypts the connection to the mail server."
                    checked={!!form.use_ssl}
                    disabled={fieldsDisabled}
                    onCheckedChange={(v) => set("use_ssl", v)}
                  />
                </Section>

                <Section title="Authentication" description="How the platform signs in to fetch mail.">
                  {!isOauth ? (
                    <FieldRow label="Password" htmlFor={`${baseId}-pw`}
                      hint={channel?.has_password ? "Leave blank to keep the current password." : undefined}>
                      <Input id={`${baseId}-pw`} type="password" value={form.password ?? ""}
                        placeholder={channel?.has_password ? "••••••••" : ""} disabled={fieldsDisabled}
                        onChange={(e) => set("password", e.target.value)} />
                    </FieldRow>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {form.auth_method === "oauth_microsoft" ? "Microsoft 365" : "Google"} OAuth app
                        </span>
                        {channel?.oauth_authorized ? (
                          <Badge className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                          </Badge>
                        ) : (
                          <Badge variant="outline">Not connected</Badge>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Register an app in your organisation&apos;s{" "}
                        {form.auth_method === "oauth_microsoft"
                          ? "Microsoft Entra (Azure AD)"
                          : "Google Cloud Console"}
                        , then paste its credentials here. Add this exact redirect URI to the app:
                      </p>
                      {redirectUri ? (
                        <div className="flex items-center gap-2 rounded bg-muted px-2 py-1">
                          <code className="flex-1 break-all text-[11px]">{redirectUri}</code>
                          <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                            onClick={() => {
                              navigator.clipboard?.writeText(redirectUri);
                              toast.success("Redirect URI copied.");
                            }}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : null}

                      <div className="grid gap-4 sm:grid-cols-2">
                        <FieldRow label="Client ID" error={fieldError(errors, "oauth_client_id")}>
                          <Input value={form.oauth_client_id ?? ""} disabled={fieldsDisabled}
                            onChange={(e) => set("oauth_client_id", e.target.value)} />
                        </FieldRow>
                        <FieldRow label="Client secret"
                          hint={channel?.has_oauth_client_secret ? "Leave blank to keep the current secret." : undefined}>
                          <Input type="password" value={form.oauth_client_secret ?? ""} disabled={fieldsDisabled}
                            placeholder={channel?.has_oauth_client_secret ? "••••••••" : ""}
                            onChange={(e) => set("oauth_client_secret", e.target.value)} />
                        </FieldRow>
                        {form.auth_method === "oauth_microsoft" ? (
                          <FieldRow label="Directory (tenant) ID"
                            hint="Your Entra Directory (tenant) ID, or 'common' for a multi-tenant app.">
                            <Input value={form.oauth_tenant_id ?? ""} disabled={fieldsDisabled}
                              placeholder="common" onChange={(e) => set("oauth_tenant_id", e.target.value)} />
                          </FieldRow>
                        ) : null}
                      </div>

                      <p className="text-[11px] text-muted-foreground">
                        Delegated permissions to grant:{" "}
                        {form.auth_method === "oauth_microsoft"
                          ? "IMAP.AccessAsUser.All, SMTP.Send, offline_access"
                          : "https://mail.google.com/ (full mail access)"}
                        .
                      </p>

                      {editing ? (
                        <div className="space-y-1">
                          <Button type="button" variant="outline" size="sm" disabled={!canManage}
                            onClick={connectOauth}>
                            {channel?.oauth_authorized ? "Reconnect" : "Connect"} mailbox
                          </Button>
                          <p className="text-[11px] text-muted-foreground">
                            Save any credential changes before connecting.
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Save the mailbox first, then connect.</p>
                      )}
                    </div>
                  )}

                  {editing ? (
                    <Button type="button" variant="secondary" size="sm" disabled={testing !== null}
                      onClick={() => runTest("inbound")}>
                      {testing === "inbound" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Test inbound connection
                    </Button>
                  ) : null}
                  {channel?.last_error ? (
                    <p className="text-xs text-destructive">Last error: {channel.last_error}</p>
                  ) : null}
                </Section>
              </TabsContent>

              {/* ── Outbound SMTP ──────────────────────────────────────── */}
              <TabsContent value="outbound" className="mt-0 space-y-5">
                <Section title="Outbound email" description="How acknowledgements and agent replies are sent.">
                  <ToggleRow
                    title="Send acknowledgement & agent replies from this mailbox"
                    checked={!!form.outbound_enabled}
                    disabled={fieldsDisabled}
                    onCheckedChange={(v) => set("outbound_enabled", v)}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FieldRow label="SMTP host" hint={isOauth ? "Blank ⇒ provider default" : undefined}>
                      <Input value={form.smtp_host ?? ""} disabled={fieldsDisabled}
                        placeholder="smtp.gmail.com"
                        onChange={(e) => set("smtp_host", e.target.value)} />
                    </FieldRow>
                    <FieldRow label="SMTP port">
                      <Input type="number" value={form.smtp_port ?? 587} disabled={fieldsDisabled}
                        onChange={(e) => set("smtp_port", Number(e.target.value))} />
                    </FieldRow>
                    <FieldRow label="Security">
                      <Select value={form.smtp_security ?? "starttls"} disabled={fieldsDisabled}
                        onValueChange={(v) => set("smtp_security", v as EmailChannel["smtp_security"])}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="starttls">STARTTLS</SelectItem>
                          <SelectItem value="ssl">SSL/TLS</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </FieldRow>
                    <FieldRow label="From display name">
                      <Input value={form.smtp_from_name ?? ""} disabled={fieldsDisabled}
                        placeholder={form.name ?? ""} onChange={(e) => set("smtp_from_name", e.target.value)} />
                    </FieldRow>
                    {!isOauth ? (
                      <>
                        <FieldRow label="SMTP username" hint="Blank ⇒ reuse inbound username">
                          <Input value={form.smtp_username ?? ""} disabled={fieldsDisabled}
                            onChange={(e) => set("smtp_username", e.target.value)} />
                        </FieldRow>
                        <FieldRow label="SMTP password"
                          hint={channel?.has_smtp_password ? "Blank ⇒ keep current / reuse inbound." : "Blank ⇒ reuse inbound."}>
                          <Input type="password" value={form.smtp_password ?? ""} disabled={fieldsDisabled}
                            placeholder={channel?.has_smtp_password ? "••••••••" : ""}
                            onChange={(e) => set("smtp_password", e.target.value)} />
                        </FieldRow>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        OAuth mailboxes send via XOAUTH2 using the same authorization as inbound.
                      </p>
                    )}
                  </div>
                  {editing ? (
                    <Button type="button" variant="secondary" size="sm" disabled={testing !== null}
                      onClick={() => runTest("smtp")}>
                      {testing === "smtp" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Test SMTP
                    </Button>
                  ) : null}
                </Section>
              </TabsContent>

              {/* ── Field Mapping ──────────────────────────────────────── */}
              <TabsContent value="mapping" className="mt-0 space-y-5">
                <Section title="Field mapping" description="How parts of an email become parts of a ticket.">
                  <div className="divide-y rounded-lg border">
                    {FIXED_MAPPINGS.map((m) => (
                      <div key={m.from} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span>{m.from}</span>
                        <span className="text-muted-foreground">→ {m.to}</span>
                      </div>
                    ))}
                  </div>
                  <ToggleRow
                    title="Create the requestor in real time when the sender is unknown"
                    checked={!!form.create_users}
                    disabled={fieldsDisabled}
                    onCheckedChange={(v) => set("create_users", v)}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FieldRow label="Default priority">
                      <Select value={form.default_priority ?? "medium"} disabled={fieldsDisabled}
                        onValueChange={(v) => set("default_priority", v as EmailChannel["default_priority"])}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="critical">Critical</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </FieldRow>
                    <FieldRow label="Max attachment size (MB)" hint="Larger parts are skipped; ticket still created.">
                      <Input type="number" min={1} value={toMb(form.max_attachment_bytes ?? 10 * MB)}
                        disabled={fieldsDisabled}
                        onChange={(e) => set("max_attachment_bytes", fromMb(Number(e.target.value)))} />
                    </FieldRow>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Email Priority → Ticket Priority</Label>
                    <div className="mt-2">
                      <EmailPriorityMapEditor value={form.priority_map ?? {}} disabled={fieldsDisabled}
                        onChange={(next) => set("priority_map", next)} />
                    </div>
                  </div>
                </Section>
              </TabsContent>

              {/* ── Processing ─────────────────────────────────────────── */}
              <TabsContent value="processing" className="mt-0 space-y-5">
                <Section title="Message handling" description="Clean up and filter incoming mail.">
                  <ToggleRow
                    title="Strip quoted replies & signatures from comments"
                    checked={!!form.strip_quotes}
                    disabled={fieldsDisabled}
                    onCheckedChange={(v) => set("strip_quotes", v)}
                  />
                  <ToggleRow
                    title="Add CC recipients as watchers"
                    checked={!!form.cc_watchers}
                    disabled={fieldsDisabled}
                    onCheckedChange={(v) => set("cc_watchers", v)}
                  />
                  <ToggleRow
                    title="Ignore auto-replies, bounces & bulk mail"
                    checked={!!form.ignore_auto_replies}
                    disabled={fieldsDisabled}
                    onCheckedChange={(v) => set("ignore_auto_replies", v)}
                  />
                </Section>
                <Section title="Replies, limits & loop protection">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FieldRow label="Reply to closed ticket">
                      <Select value={form.reopen_policy ?? "comment_only"} disabled={fieldsDisabled}
                        onValueChange={(v) => set("reopen_policy", v as EmailChannel["reopen_policy"])}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="comment_only">Comment only (leave closed)</SelectItem>
                          <SelectItem value="reopen">Reopen the ticket</SelectItem>
                          <SelectItem value="new_ticket">Create a new ticket</SelectItem>
                        </SelectContent>
                      </Select>
                    </FieldRow>
                    <FieldRow label="Reopen window (days)">
                      <Input type="number" value={form.reopen_window_days ?? 14} disabled={fieldsDisabled}
                        onChange={(e) => set("reopen_window_days", Number(e.target.value))} />
                    </FieldRow>
                    <FieldRow label="Max message age (days)">
                      <Input type="number" value={form.max_age_days ?? 7} disabled={fieldsDisabled}
                        onChange={(e) => set("max_age_days", Number(e.target.value))} />
                    </FieldRow>
                    <FieldRow label="Max message size (MB)" hint="Larger messages are ignored (size_cap).">
                      <Input type="number" value={toMb(form.max_size_bytes ?? 25 * MB)} disabled={fieldsDisabled}
                        onChange={(e) => set("max_size_bytes", fromMb(Number(e.target.value)))} />
                    </FieldRow>
                    <FieldRow label="Loop window (min)">
                      <Input type="number" value={form.loop_window_min ?? 10} disabled={fieldsDisabled}
                        onChange={(e) => set("loop_window_min", Number(e.target.value))} />
                    </FieldRow>
                    <FieldRow label="Loop max messages">
                      <Input type="number" value={form.loop_max_messages ?? 30} disabled={fieldsDisabled}
                        onChange={(e) => set("loop_max_messages", Number(e.target.value))} />
                    </FieldRow>
                    <FieldRow label="Poll interval (sec)" hint="Blank ⇒ global cadence">
                      <Input type="number" value={form.poll_interval_seconds ?? ""} disabled={fieldsDisabled}
                        onChange={(e) =>
                          set("poll_interval_seconds", e.target.value ? Number(e.target.value) : null)} />
                    </FieldRow>
                  </div>
                </Section>
              </TabsContent>

              {/* ── Domains & Senders ──────────────────────────────────── */}
              <TabsContent value="domains" className="mt-0 space-y-5">
                <Section title="Domains & senders" description="Allow or block who can open tickets by email.">
                  {editing && channel ? (
                    <EmailRulesEditor channelId={channel.id} disabled={!canManage} />
                  ) : (
                    <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                      Save the mailbox first, then add allow/block rules here.
                    </p>
                  )}
                </Section>
              </TabsContent>
            </div>
          </Tabs>

          {canManage ? (
            <div className="flex items-center justify-end gap-2 border-t bg-background px-5 py-4">
              <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Create mailbox"}
              </Button>
            </div>
          ) : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}
