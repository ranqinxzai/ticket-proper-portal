"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ssoConfigApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { TenantSsoConfig, TenantSsoConfigInput } from "@/lib/itsm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

/** Tenant admin form for per-org Microsoft (Entra) SSO. Mirrors the mailbox
 *  credential pattern: the tenant pastes their OWN app's Client ID / Directory
 *  ID / Client secret, and copies the Redirect URI into their Entra app. */
export function SsoConfigForm({ canManage }: { canManage: boolean }) {
  const [config, setConfig] = useState<TenantSsoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Editable fields. `secret` stays empty unless the admin types a new one
  // (so we never overwrite the stored secret with a blank on save).
  const [enabled, setEnabled] = useState(false);
  const [clientId, setClientId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [secret, setSecret] = useState("");
  const [autoProvision, setAutoProvision] = useState(true);
  const [domains, setDomains] = useState("");

  function hydrate(c: TenantSsoConfig) {
    setConfig(c);
    setEnabled(c.enabled);
    setClientId(c.microsoft_client_id ?? "");
    setTenantId(c.microsoft_tenant_id ?? "");
    setAutoProvision(c.auto_provision);
    setDomains(c.allowed_email_domains ?? "");
    setSecret("");
  }

  useEffect(() => {
    let active = true;
    ssoConfigApi
      .get()
      .then((c) => active && hydrate(c))
      .catch(() => active && toast.error("Could not load SSO settings."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (enabled && (!clientId.trim() || !tenantId.trim())) {
      toast.error("Client ID and Directory (tenant) ID are required to enable Microsoft sign-in.");
      return;
    }
    if (enabled && !secret.trim() && !config?.has_microsoft_client_secret) {
      toast.error("Add the Client secret from your Entra app before enabling.");
      return;
    }
    const body: TenantSsoConfigInput = {
      enabled,
      microsoft_client_id: clientId.trim(),
      microsoft_tenant_id: tenantId.trim(),
      auto_provision: autoProvision,
      allowed_email_domains: domains.trim(),
    };
    // Only send the secret when the admin actually entered one.
    if (secret.trim()) body.microsoft_client_secret = secret.trim();

    setSaving(true);
    try {
      const updated = await ssoConfigApi.update(body);
      hydrate(updated);
      toast.success("SSO settings saved.");
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save SSO settings.");
    } finally {
      setSaving(false);
    }
  }

  function copyRedirect() {
    const uri = config?.redirect_uri ?? "";
    if (!uri) return;
    void navigator.clipboard?.writeText(uri);
    setCopied(true);
    toast.success("Redirect URI copied.");
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  const fieldsDisabled = !canManage || saving;

  return (
    <div className="space-y-6">
      {/* Status summary */}
      <div className="flex flex-wrap items-center gap-2">
        {config?.microsoft_enabled ? (
          <Badge className="bg-emerald-600 hover:bg-emerald-600">Microsoft sign-in active</Badge>
        ) : config?.microsoft_configured ? (
          <Badge variant="secondary">Configured · disabled</Badge>
        ) : (
          <Badge variant="outline">Not configured</Badge>
        )}
      </div>

      {/* Redirect URI to register in Entra */}
      <div className="space-y-1.5">
        <Label>Redirect URI (add this to your Entra app)</Label>
        <div className="flex items-center gap-2">
          <Input readOnly value={config?.redirect_uri ?? ""} className="font-mono text-xs" />
          <Button type="button" variant="outline" size="icon" onClick={copyRedirect} aria-label="Copy redirect URI">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          In Entra → your app → Authentication → add this as a <strong>Web</strong> redirect URI.
        </p>
      </div>

      <Separator />

      {/* Microsoft app credentials */}
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ms-client-id">Application (client) ID</Label>
            <Input
              id="ms-client-id"
              value={clientId}
              disabled={fieldsDisabled}
              placeholder="00000000-0000-0000-0000-000000000000"
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ms-tenant-id">Directory (tenant) ID</Label>
            <Input
              id="ms-tenant-id"
              value={tenantId}
              disabled={fieldsDisabled}
              placeholder="00000000-0000-0000-0000-000000000000"
              onChange={(e) => setTenantId(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ms-secret">Client secret</Label>
          <Input
            id="ms-secret"
            type="password"
            value={secret}
            disabled={fieldsDisabled}
            autoComplete="off"
            placeholder={config?.has_microsoft_client_secret ? "•••••••• (leave blank to keep current)" : "Paste the secret value from Entra"}
            onChange={(e) => setSecret(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Use the secret <strong>Value</strong> (not the Secret ID). Stored encrypted — it&apos;s never shown again.
          </p>
        </div>
      </div>

      <Separator />

      {/* Behaviour toggles */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="ms-autoprov">Auto-create first-time users</Label>
            <p className="text-xs text-muted-foreground">
              When a directory user signs in with no matching account, create a portal Requestor
              from their Microsoft profile. Turn off to allow only pre-created users.
            </p>
          </div>
          <Switch
            id="ms-autoprov"
            checked={autoProvision}
            disabled={fieldsDisabled}
            onCheckedChange={setAutoProvision}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ms-domains">Allowed email domains (optional)</Label>
          <Input
            id="ms-domains"
            value={domains}
            disabled={fieldsDisabled}
            placeholder="acme.com, acme.co.uk"
            onChange={(e) => setDomains(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated. Only these domains may auto-provision. Leave blank to allow any address
            in your directory.
          </p>
        </div>
      </div>

      <Separator />

      {/* Master switch + save */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Switch
            id="ms-enabled"
            checked={enabled}
            disabled={fieldsDisabled}
            onCheckedChange={setEnabled}
          />
          <Label htmlFor="ms-enabled" className="cursor-pointer">
            Enable “Sign in with Microsoft”
          </Label>
        </div>
        {canManage ? (
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        ) : null}
      </div>
    </div>
  );
}
