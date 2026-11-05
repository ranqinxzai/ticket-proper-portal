"use client";

import { useEffect, useState } from "react";
import { History, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { interfaceApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import { INTERFACE_HELP } from "@/lib/itsm/help/admin";
import { invalidateInterfaceConfig } from "@/lib/itsm/interface-settings";
import type { TenantInterfaceConfig } from "@/lib/itsm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Ui = "classic" | "modern";

const CHOICES: { value: Ui; label: string; help: string; Icon: typeof History }[] = [
  { value: "classic", label: "Classic", help: "The previous layout", Icon: History },
  { value: "modern", label: "Modern", help: "The workbench (default)", Icon: Sparkles },
];

/** Tenant admin form for the Classic / Modern policy (TenantInterfaceConfig). */
export function InterfaceConfigForm({ canManage }: { canManage: boolean }) {
  const [config, setConfig] = useState<TenantInterfaceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uiDefault, setUiDefault] = useState<Ui>("modern");
  const [allowSwitch, setAllowSwitch] = useState(true);
  const [retireOn, setRetireOn] = useState("");

  function hydrate(c: TenantInterfaceConfig) {
    setConfig(c);
    setUiDefault(c.ui_default);
    setAllowSwitch(c.ui_allow_switch);
    setRetireOn(c.ui_classic_retire_on ?? "");
  }

  useEffect(() => {
    let alive = true;
    interfaceApi
      .get()
      .then((c) => alive && hydrate(c))
      .catch(() => alive && toast.error("Could not load the interface settings."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    try {
      const updated = await interfaceApi.update({
        ui_default: uiDefault,
        ui_allow_switch: allowSwitch,
        ui_classic_retire_on: retireOn || null,
      });
      hydrate(updated);
      invalidateInterfaceConfig({
        ui_default: updated.ui_default,
        ui_allow_switch: updated.ui_allow_switch,
        ui_classic_retire_on: updated.ui_classic_retire_on,
        classic_retired: updated.classic_retired,
      });
      toast.success("Interface settings saved. Agents get them on their next page load.");
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save the interface settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </p>
    );
  }

  const disabled = !canManage || saving;
  const dirty =
    !!config &&
    (config.ui_default !== uiDefault ||
      config.ui_allow_switch !== allowSwitch ||
      (config.ui_classic_retire_on ?? "") !== retireOn);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {config?.classic_retired ? (
          <Badge>Classic retired · everyone uses Modern</Badge>
        ) : !config?.ui_allow_switch ? (
          <Badge variant="secondary">Everyone uses {config?.ui_default === "modern" ? "Modern" : "Classic"}</Badge>
        ) : (
          <Badge variant="outline">Agents choose · default {config?.ui_default === "modern" ? "Modern" : "Classic"}</Badge>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <span id="ui-default-label" className="text-sm font-medium">
            Default interface for agents
          </span>
          <InfoTip label="About the default interface">{INTERFACE_HELP.default}</InfoTip>
        </div>
        <div role="radiogroup" aria-labelledby="ui-default-label" className="grid max-w-md gap-2 sm:grid-cols-2">
          {CHOICES.map(({ value, label, help, Icon }) => {
            const active = uiDefault === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => setUiDefault(value)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                  active ? "border-primary bg-accent" : "hover:bg-muted",
                )}
              >
                <Icon className={cn("h-5 w-5 shrink-0", active ? "text-primary-ink" : "text-muted-foreground")} aria-hidden="true" />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{help}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Separator />

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="ui-allow-switch">Let agents switch themselves</Label>
            <InfoTip label="About switching">{INTERFACE_HELP.allowSwitch}</InfoTip>
          </div>
          <p className="text-xs text-muted-foreground">From the profile menu → Interface.</p>
        </div>
        <Hint label={!canManage ? "You can view these settings but not change them" : ""}>
          <Switch id="ui-allow-switch" checked={allowSwitch} disabled={disabled} onCheckedChange={setAllowSwitch} />
        </Hint>
      </div>

      <Separator />

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="ui-retire-on">Retire Classic on</Label>
          <InfoTip label="About retiring Classic">{INTERFACE_HELP.retire}</InfoTip>
        </div>
        <div className="flex items-center gap-2">
          <Input
            id="ui-retire-on"
            type="date"
            value={retireOn}
            disabled={disabled}
            onChange={(e) => setRetireOn(e.target.value)}
            className="w-48"
          />
          {retireOn ? (
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setRetireOn("")}>
              Clear
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">Leave empty to keep both. Give agents at least a few weeks&apos; notice.</p>
      </div>

      {canManage ? (
        <div className="flex items-center gap-2">
          <Hint label={!dirty && !saving ? "Nothing to save yet: change a setting first" : ""}>
            <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Save
            </Button>
          </Hint>
          <p className="text-xs text-muted-foreground">{INTERFACE_HELP.usage}</p>
        </div>
      ) : null}
    </div>
  );
}
