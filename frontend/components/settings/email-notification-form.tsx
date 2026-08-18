"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  Loader2,
  Mail,
  Send,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { helpdesksApi, helpdeskTransportApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { HelpdeskEmailTransport } from "@/lib/itsm/types";
import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { FieldRow, fieldError } from "./field-row";

/** A small "?" info tooltip to sit next to a field label — plain-language help for
 *  non-technical admins. TooltipProvider is mounted app-wide (app/layout.tsx). */
function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="More information"
          className="ml-1 inline-flex cursor-help align-middle text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-left leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** Common SMTP providers → host/port/security, so a non-technical admin can one-click
 *  the right settings instead of hunting for them. */
const SMTP_PRESETS: { label: string; host: string; port: number; security: "starttls" | "ssl" }[] = [
  { label: "Microsoft 365 / Outlook", host: "smtp.office365.com", port: 587, security: "starttls" },
  { label: "Gmail / Google Workspace", host: "smtp.gmail.com", port: 587, security: "starttls" },
  { label: "SendGrid", host: "smtp.sendgrid.net", port: 587, security: "starttls" },
  { label: "SiteGround", host: "gfram1019.siteground.biz", port: 465, security: "ssl" },
];

type CustomForm = {
  auth_method: "basic" | "oauth_microsoft";
  address: string;
  smtp_from_name: string;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "starttls" | "ssl" | "none";
  smtp_username: string;
  smtp_password: string;
  oauth_client_id: string;
  oauth_tenant_id: string;
  oauth_client_secret: string;
};

/**
 * How this helpdesk's NOTIFICATION emails (ticket created/updated/assigned/…) are sent.
 * Two modes:
 *  - "system": the platform relays them — the org just sets a From name + reply address.
 *  - "custom": the org connects its OWN mailbox (SMTP or Microsoft 365).
 * (A project's own inbound Mailbox, if configured, still sends its own tickets' mail — this
 *  page is the fallback/default for everything else.)
 */
export function EmailNotificationForm({
  helpdeskId,
  canEdit,
}: {
  helpdeskId: string;
  canEdit: boolean;
}) {
  const baseId = useId();
  const { org, helpdesk } = useWorkspace();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const [transport, setTransport] = useState<HelpdeskEmailTransport | null>(null);
  const [mode, setMode] = useState<"system" | "custom">("system");
  // system mode → the helpdesk's own From identity
  const [fromName, setFromName] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  // custom mode → the org's own transport
  const [custom, setCustom] = useState<CustomForm>({
    auth_method: "basic",
    address: "",
    smtp_from_name: "",
    smtp_host: "",
    smtp_port: 587,
    smtp_security: "starttls",
    smtp_username: "",
    smtp_password: "",
    oauth_client_id: "",
    oauth_tenant_id: "",
    oauth_client_secret: "",
  });
  const [dirty, setDirty] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const redirectUri = org ? `${origin}/api/v1/t/${org}/itsm/email/oauth/callback/` : "";
  const helpdeskName = helpdesk?.name ?? "your helpdesk";

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([helpdesksApi.get(helpdeskId), helpdeskTransportApi.forHelpdesk(helpdeskId)])
      .then(([hd, t]) => {
        if (!active) return;
        setFromName(hd.notification_from_name ?? "");
        setReplyEmail(hd.notification_from_email ?? "");
        setTransport(t);
        setMode(t.mode);
        setCustom({
          auth_method: t.auth_method === "oauth_microsoft" ? "oauth_microsoft" : "basic",
          address: t.address ?? "",
          smtp_from_name: t.smtp_from_name ?? "",
          smtp_host: t.smtp_host ?? "",
          smtp_port: t.smtp_port ?? 587,
          smtp_security: t.smtp_security ?? "starttls",
          smtp_username: t.smtp_username ?? "",
          smtp_password: "",
          oauth_client_id: t.oauth_client_id ?? "",
          oauth_tenant_id: t.oauth_tenant_id ?? "",
          oauth_client_secret: "",
        });
        setDirty(false);
      })
      .catch(() => {
        if (active) toast.error("Could not load the email notification settings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [helpdeskId]);

  function setC<K extends keyof CustomForm>(key: K, value: CustomForm[K]) {
    setCustom((c) => ({ ...c, [key]: value }));
    setDirty(true);
  }

  const isM365 = custom.auth_method === "oauth_microsoft";

  async function save(): Promise<HelpdeskEmailTransport | null> {
    if (!transport) return null;
    setBusy(true);
    setErrors({});
    try {
      if (mode === "system") {
        await helpdesksApi.update(helpdeskId, {
          notification_from_name: fromName.trim(),
          notification_from_email: replyEmail.trim(),
        });
      }
      const body: Partial<HelpdeskEmailTransport> = { mode };
      if (mode === "custom") {
        Object.assign(body, {
          auth_method: custom.auth_method,
          address: custom.address.trim(),
          smtp_from_name: custom.smtp_from_name.trim(),
          smtp_host: custom.smtp_host.trim(),
          smtp_port: custom.smtp_port,
          smtp_security: custom.smtp_security,
          smtp_username: custom.smtp_username.trim(),
          oauth_client_id: custom.oauth_client_id.trim(),
          oauth_tenant_id: custom.oauth_tenant_id.trim(),
        });
        // Write-only secrets: only send when the admin typed a new value.
        if (custom.smtp_password) (body as CustomForm & { smtp_password: string }).smtp_password = custom.smtp_password;
        if (custom.oauth_client_secret)
          (body as CustomForm & { oauth_client_secret: string }).oauth_client_secret = custom.oauth_client_secret;
      }
      const updated = await helpdeskTransportApi.update(transport.id, body);
      setTransport(updated);
      setCustom((c) => ({ ...c, smtp_password: "", oauth_client_secret: "" }));
      setDirty(false);
      toast.success("Email notification settings saved.");
      return updated;
    } catch (err) {
      if (err instanceof ItsmApiError) {
        if (err.fieldErrors) setErrors(err.fieldErrors);
        toast.error(err.message);
      } else {
        toast.error("Could not save the settings.");
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function testSend() {
    if (!transport) return;
    setTesting(true);
    try {
      const res = await helpdeskTransportApi.testSmtp(transport.id);
      if (res.ok) {
        toast.success(res.detail || "Connection OK — this mailbox can send.");
        setTransport((t) => (t ? { ...t, send_verified: true, verify_error: "" } : t));
      } else {
        toast.error(res.detail || "Could not connect.");
        setTransport((t) => (t ? { ...t, send_verified: false, verify_error: res.detail } : t));
      }
    } catch {
      toast.error("Could not run the test.");
    } finally {
      setTesting(false);
    }
  }

  async function connectMicrosoft() {
    // Persist first (so the client id/secret + method are stored), then start consent.
    const saved = dirty || !transport?.oauth_authorized ? await save() : transport;
    if (!saved) return;
    try {
      const { authorize_url } = await helpdeskTransportApi.oauthStart(saved.id);
      window.location.href = authorize_url;
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Could not start Microsoft sign-in.");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }

  const fieldsDisabled = !canEdit || busy;

  return (
    <div className="max-w-2xl space-y-5">
      {/* How it works — plain language for anyone */}
      <Alert variant="info">
        <Info className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>How {helpdeskName}&rsquo;s emails are sent</AlertTitle>
        <AlertDescription>
          <p className="mb-2">
            When a ticket is created, updated, assigned or commented on, the people involved
            (agents and the requester) get an email. This page controls <strong>who those emails
            appear to come from</strong> and <strong>which mail server sends them</strong>.
          </p>
          <ol className="ml-4 list-decimal space-y-0.5 text-xs">
            <li>Pick a mode below — use our built-in email, or connect your own.</li>
            <li>Fill in the details (we explain each field).</li>
            <li>Send a test to confirm it works, then save.</li>
          </ol>
        </AlertDescription>
      </Alert>

      {/* Mode toggle */}
      <div className="flex items-start justify-between gap-4 rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
            Use OneDesk&rsquo;s email system
            <InfoTip>
              ON (recommended): we send every notification for you through our own mail server —
              nothing to set up, and it lands reliably in inboxes.{"\n\n"}
              OFF: you connect your own mailbox (SMTP or Microsoft 365) and emails go out from it
              instead.
            </InfoTip>
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === "system"
              ? "We send your notifications. You only choose the name and reply address people see."
              : "Your own mailbox sends the notifications. You provide the connection details below."}
          </p>
        </div>
        <Switch
          checked={mode === "system"}
          disabled={fieldsDisabled}
          onCheckedChange={(on) => {
            setMode(on ? "system" : "custom");
            setDirty(true);
          }}
          aria-label="Use OneDesk's email system"
        />
      </div>

      {mode === "system" ? (
        <Section
          title="Sender identity"
          description="Recipients see this name and reply address, even though OneDesk sends the message for you."
        >
          <FieldRow
            label="From name"
            htmlFor={`${baseId}-name`}
            error={fieldError(errors, "notification_from_name")}
            hint={
              <>
                The sender name people see, e.g. &ldquo;IT Support&rdquo;.
                <InfoTip>Shown in the recipient&rsquo;s inbox as the sender. Leave blank to use the helpdesk name ({helpdeskName}).</InfoTip>
              </>
            }
          >
            <Input
              id={`${baseId}-name`}
              value={fromName}
              disabled={fieldsDisabled}
              onChange={(e) => {
                setFromName(e.target.value);
                setDirty(true);
              }}
              placeholder="IT Support"
            />
          </FieldRow>

          <FieldRow
            label="Reply-to address"
            htmlFor={`${baseId}-reply`}
            error={fieldError(errors, "notification_from_email")}
            hint={
              <>
                Where replies go when someone answers a notification.
                <InfoTip>
                  We send from our own address for reliable delivery, but we set &ldquo;Reply-To&rdquo;
                  to this address — so if a recipient hits Reply, it reaches you here. Make sure it&rsquo;s
                  a mailbox someone actually watches. Leave blank to disable replies.
                </InfoTip>
              </>
            }
          >
            <Input
              id={`${baseId}-reply`}
              type="email"
              value={replyEmail}
              disabled={fieldsDisabled}
              onChange={(e) => {
                setReplyEmail(e.target.value);
                setDirty(true);
              }}
              placeholder="support@yourcompany.com"
            />
          </FieldRow>

          {/* Live preview of what recipients see */}
          <div className="rounded-lg border bg-muted/40 p-3 text-xs">
            <p className="mb-2 font-medium text-muted-foreground">Preview — what recipients see:</p>
            <div className="space-y-1 font-mono">
              <div>
                <span className="text-muted-foreground">From:&nbsp;</span>
                <span className="font-semibold">{fromName.trim() || helpdeskName}</span>{" "}
                <span className="text-muted-foreground">(sent via OneDesk)</span>
              </div>
              <div>
                <span className="text-muted-foreground">Reply-To:&nbsp;</span>
                {replyEmail.trim() ? (
                  <span>{replyEmail.trim()}</span>
                ) : (
                  <span className="italic text-muted-foreground">no replies</span>
                )}
              </div>
            </div>
          </div>

          <Alert variant="info">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="text-xs">
              Recipients see your name, but the technical sender is OneDesk&rsquo;s server — this keeps
              your emails out of spam without any DNS setup. Want emails to come from your own domain
              instead? Switch off &ldquo;Use OneDesk&rsquo;s email system&rdquo; above and connect your mailbox.
            </AlertDescription>
          </Alert>
        </Section>
      ) : (
        <Section
          title="Connect your own email"
          description="Notifications for this helpdesk will be sent from your mailbox."
        >
          <FieldRow
            label="Connection type"
            hint="Choose how we sign in to your mail server."
          >
            <Select
              value={custom.auth_method}
              disabled={fieldsDisabled}
              onValueChange={(v) => setC("auth_method", v as CustomForm["auth_method"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="basic">SMTP (username &amp; password)</SelectItem>
                <SelectItem value="oauth_microsoft">Microsoft 365 (secure sign-in)</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          <FieldRow
            label="From address"
            htmlFor={`${baseId}-addr`}
            required
            error={fieldError(errors, "address")}
            hint={
              <>
                The mailbox address emails are sent from, e.g. support@yourcompany.com.
                <InfoTip>This is both the visible sender and the account we sign in as. For Microsoft 365 it must be the mailbox you consent with.</InfoTip>
              </>
            }
          >
            <Input
              id={`${baseId}-addr`}
              type="email"
              value={custom.address}
              disabled={fieldsDisabled}
              onChange={(e) => setC("address", e.target.value)}
              placeholder="support@yourcompany.com"
            />
          </FieldRow>

          <FieldRow label="From name" htmlFor={`${baseId}-cname`} hint="Sender name shown to recipients.">
            <Input
              id={`${baseId}-cname`}
              value={custom.smtp_from_name}
              disabled={fieldsDisabled}
              onChange={(e) => setC("smtp_from_name", e.target.value)}
              placeholder="IT Support"
            />
          </FieldRow>

          {isM365 ? (
            <div className="space-y-4">
              <Alert variant="info">
                <Info className="h-4 w-4" aria-hidden="true" />
                <AlertDescription className="text-xs">
                  Microsoft 365 uses secure sign-in (no password stored). Register an app in your Azure
                  portal, paste its Client ID &amp; secret below, add the redirect URL, then click Connect.
                  We request <strong>send-only</strong> permission (SMTP.Send) — we never read your mail.
                </AlertDescription>
              </Alert>

              <FieldRow label="Application (client) ID" htmlFor={`${baseId}-cid`} required
                error={fieldError(errors, "oauth_client_id")}
                hint="From your Azure app registration → Overview.">
                <Input id={`${baseId}-cid`} value={custom.oauth_client_id} disabled={fieldsDisabled}
                  onChange={(e) => setC("oauth_client_id", e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
              </FieldRow>

              <FieldRow label="Directory (tenant) ID" htmlFor={`${baseId}-tid`}
                error={fieldError(errors, "oauth_tenant_id")}
                hint="Your Azure tenant ID, or leave blank for 'common'.">
                <Input id={`${baseId}-tid`} value={custom.oauth_tenant_id} disabled={fieldsDisabled}
                  onChange={(e) => setC("oauth_tenant_id", e.target.value)} placeholder="common" />
              </FieldRow>

              <FieldRow label="Client secret" htmlFor={`${baseId}-csec`}
                error={fieldError(errors, "oauth_client_secret")}
                hint={transport?.has_oauth_client_secret ? "Saved. Leave blank to keep it." : "From Azure → Certificates & secrets."}>
                <Input id={`${baseId}-csec`} type="password" value={custom.oauth_client_secret} disabled={fieldsDisabled}
                  onChange={(e) => setC("oauth_client_secret", e.target.value)}
                  placeholder={transport?.has_oauth_client_secret ? "••••••••" : ""} />
              </FieldRow>

              <FieldRow label="Redirect URL (add this to your Azure app)"
                hint="Azure → Authentication → Web → Redirect URIs. Must match exactly.">
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded-md border bg-muted/50 px-2 py-1.5 text-[11px]">
                    {redirectUri || "—"}
                  </code>
                  <Button type="button" variant="outline" size="icon"
                    onClick={() => { navigator.clipboard?.writeText(redirectUri); toast.success("Copied."); }}
                    disabled={!redirectUri} aria-label="Copy redirect URL">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </FieldRow>

              <div className="flex flex-wrap items-center gap-2">
                {transport?.oauth_authorized ? (
                  <Badge className="gap-1 border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                  </Badge>
                ) : (
                  <Badge variant="outline">Not connected</Badge>
                )}
                {canEdit ? (
                  <Button type="button" variant="secondary" onClick={connectMicrosoft} disabled={busy}>
                    {transport?.oauth_authorized ? "Reconnect" : "Connect Microsoft 365"}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <FieldRow label="Common providers" hint="One click fills in the server settings for you.">
                <div className="flex flex-wrap gap-2">
                  {SMTP_PRESETS.map((p) => (
                    <Button key={p.label} type="button" variant="outline" size="sm" disabled={fieldsDisabled}
                      onClick={() => {
                        setC("smtp_host", p.host);
                        setC("smtp_port", p.port);
                        setC("smtp_security", p.security);
                      }}>
                      {p.label}
                    </Button>
                  ))}
                </div>
              </FieldRow>

              <div className="grid gap-4 sm:grid-cols-2">
                <FieldRow label="SMTP server" htmlFor={`${baseId}-host`} required
                  error={fieldError(errors, "smtp_host")} hint="Your outgoing mail server.">
                  <Input id={`${baseId}-host`} value={custom.smtp_host} disabled={fieldsDisabled}
                    onChange={(e) => setC("smtp_host", e.target.value)} placeholder="smtp.yourcompany.com" />
                </FieldRow>
                <FieldRow label="Port" htmlFor={`${baseId}-port`}
                  error={fieldError(errors, "smtp_port")}
                  hint={<>Usually 587 or 465.<InfoTip>587 = STARTTLS, 465 = SSL/TLS. Pick the security below to match.</InfoTip></>}>
                  <Input id={`${baseId}-port`} type="number" value={custom.smtp_port} disabled={fieldsDisabled}
                    onChange={(e) => setC("smtp_port", Number(e.target.value) || 0)} />
                </FieldRow>
              </div>

              <FieldRow label="Security" hint="How the connection is encrypted (match your port).">
                <Select value={custom.smtp_security} disabled={fieldsDisabled}
                  onValueChange={(v) => setC("smtp_security", v as CustomForm["smtp_security"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starttls">STARTTLS (port 587)</SelectItem>
                    <SelectItem value="ssl">SSL / TLS (port 465)</SelectItem>
                    <SelectItem value="none">None (not recommended)</SelectItem>
                  </SelectContent>
                </Select>
              </FieldRow>

              <div className="grid gap-4 sm:grid-cols-2">
                <FieldRow label="Username" htmlFor={`${baseId}-user`}
                  error={fieldError(errors, "smtp_username")}
                  hint="Usually the full email address. Blank = the From address.">
                  <Input id={`${baseId}-user`} value={custom.smtp_username} disabled={fieldsDisabled}
                    onChange={(e) => setC("smtp_username", e.target.value)} placeholder="support@yourcompany.com" />
                </FieldRow>
                <FieldRow label="Password" htmlFor={`${baseId}-pass`}
                  error={fieldError(errors, "smtp_password")}
                  hint={transport?.has_smtp_password ? "Saved. Leave blank to keep it." : "Your mailbox / app password."}>
                  <Input id={`${baseId}-pass`} type="password" value={custom.smtp_password} disabled={fieldsDisabled}
                    onChange={(e) => setC("smtp_password", e.target.value)}
                    placeholder={transport?.has_smtp_password ? "••••••••" : ""} />
                </FieldRow>
              </div>
            </div>
          )}

          {/* Send-capability status + test */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-xs">
              <ServerCog className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {transport?.send_verified === true ? (
                <Badge className="gap-1 border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Verified — this mailbox can send
                </Badge>
              ) : transport?.send_verified === false ? (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Can&rsquo;t send — check the details
                </Badge>
              ) : (
                <Badge variant="secondary">Not tested yet</Badge>
              )}
            </div>
            {canEdit ? (
              <Button type="button" variant="outline" size="sm" onClick={testSend}
                disabled={testing || busy || dirty}>
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Test connection
              </Button>
            ) : null}
          </div>
          {dirty ? (
            <p className="text-xs text-muted-foreground">Save your changes before testing.</p>
          ) : null}
          {transport?.send_verified === false && transport?.verify_error ? (
            <p className="text-xs text-destructive">{transport.verify_error}</p>
          ) : null}

          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="text-xs">
              Using your own mailbox means emails come from your domain — best for branding, but your
              mail server must allow sending (Microsoft 365, for example, often has SMTP turned off by
              default). If sending ever fails, we automatically fall back to OneDesk&rsquo;s email so
              notifications are never lost.
            </AlertDescription>
          </Alert>
        </Section>
      )}

      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button type="button" onClick={() => void save()} disabled={busy || !dirty}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
          {dirty ? <span className="text-xs text-muted-foreground">You have unsaved changes.</span> : null}
        </div>
      ) : null}
    </div>
  );
}
