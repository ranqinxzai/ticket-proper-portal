"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2, Bell } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { notifAdminApi } from "@/lib/itsm/admin-api";
import { ItsmApiError } from "@/lib/itsm/client";
import {
  NOTIF_EVENTS, NOTIF_RECIPIENTS, NOTIF_CHANNELS,
} from "@/lib/itsm/admin-types";
import type {
  NotificationSchemeRow, NotificationRuleRow, EmailTemplateRow,
} from "@/lib/itsm/admin-types";

const NO_TEMPLATE = "__none__";

const RECIPIENT_LABELS: Record<string, string> = {
  requestor: "Requestor",
  assignee: "Assignee",
  assigned_group: "Assigned group",
  group_lead: "Group lead",
  watchers: "Watchers",
  mentioned: "Mentioned",
};

const CHANNEL_LABELS: Record<string, string> = {
  in_app: "In-app",
  email: "Email",
};

function eventLabel(event: string): string {
  return event.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function errMessage(e: unknown, fallback: string): string {
  if (e instanceof ItsmApiError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

type Props = {
  scheme: NotificationSchemeRow;
  /** Refetch the active scheme after a mutation persists. */
  onRefetch: () => void;
};

export function NotificationSchemeEditor({ scheme, onRefetch }: Props) {
  const [templates, setTemplates] = useState<EmailTemplateRow[]>([]);
  const [addEvent, setAddEvent] = useState<string>(NOTIF_EVENTS[0]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    notifAdminApi
      .templates()
      .then(setTemplates)
      .catch((e) => toast.error(errMessage(e, "Failed to load email templates")));
  }, []);

  // Group rules by event for readability, preserving NOTIF_EVENTS order.
  const grouped = useMemo(() => {
    const byEvent = new Map<string, NotificationRuleRow[]>();
    for (const rule of scheme.rules) {
      const list = byEvent.get(rule.event_type) ?? [];
      list.push(rule);
      byEvent.set(rule.event_type, list);
    }
    const ordered: { event: string; rules: NotificationRuleRow[] }[] = [];
    for (const event of NOTIF_EVENTS) {
      const rules = byEvent.get(event);
      if (rules && rules.length) ordered.push({ event, rules });
    }
    // Include any unknown events at the end (defensive).
    for (const [event, rules] of byEvent) {
      if (!NOTIF_EVENTS.includes(event as (typeof NOTIF_EVENTS)[number])) {
        ordered.push({ event, rules });
      }
    }
    return ordered;
  }, [scheme.rules]);

  const patchRule = useCallback(
    async (id: string, body: Partial<NotificationRuleRow>) => {
      setBusy(true);
      try {
        await notifAdminApi.updateRule(id, body);
        onRefetch();
      } catch (e) {
        toast.error(errMessage(e, "Failed to update rule"));
      } finally {
        setBusy(false);
      }
    },
    [onRefetch],
  );

  const addRule = useCallback(async () => {
    setBusy(true);
    try {
      await notifAdminApi.createRule({
        scheme: scheme.id,
        event_type: addEvent,
        recipients: ["assignee"],
        channels: ["in_app"],
        is_active: true,
      });
      toast.success(`Rule added for ${eventLabel(addEvent)}`);
      onRefetch();
    } catch (e) {
      toast.error(errMessage(e, "Failed to add rule"));
    } finally {
      setBusy(false);
    }
  }, [addEvent, scheme.id, onRefetch]);

  const removeRule = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await notifAdminApi.deleteRule(id);
        toast.success("Rule removed");
        onRefetch();
      } catch (e) {
        toast.error(errMessage(e, "Failed to delete rule"));
      } finally {
        setBusy(false);
      }
    },
    [onRefetch],
  );

  function toggleInList(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  return (
    <div className="space-y-4">
      {/* Scheme header */}
      <div className="rounded-lg border bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-indigo-500" />
              <h2 className="text-base font-semibold">{scheme.name}</h2>
              {scheme.is_default && (
                <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">Default</span>
              )}
            </div>
            {scheme.description && (
              <p className="mt-1 text-sm text-muted-foreground">{scheme.description}</p>
            )}
          </div>
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Add rule */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3">
        <span className="text-sm font-medium">Add rule for event</span>
        <Select value={addEvent} onValueChange={setAddEvent}>
          <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {NOTIF_EVENTS.map((ev) => (
              <SelectItem key={ev} value={ev}>{eventLabel(ev)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="gap-1" onClick={addRule} disabled={busy}>
          <Plus className="h-4 w-4" /> Add rule
        </Button>
      </div>

      {/* Rules grouped by event */}
      {grouped.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
          No rules yet. Add a rule above to start notifying recipients.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ event, rules }) => (
            <div key={event} className="rounded-lg border bg-white">
              <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold">
                {eventLabel(event)}
              </div>
              <div className="divide-y">
                {rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    templates={templates}
                    busy={busy}
                    onToggleRecipient={(value) =>
                      patchRule(rule.id, { recipients: toggleInList(rule.recipients, value) })
                    }
                    onToggleChannel={(value) =>
                      patchRule(rule.id, { channels: toggleInList(rule.channels, value) })
                    }
                    onTemplate={(value) =>
                      patchRule(rule.id, { email_template: value === NO_TEMPLATE ? null : value })
                    }
                    onNotifyActor={(value) => patchRule(rule.id, { notify_actor: value })}
                    onActive={(value) => patchRule(rule.id, { is_active: value })}
                    onDelete={() => removeRule(rule.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  label, active, onClick, disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={
        "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 " +
        (active
          ? "border-indigo-500 bg-indigo-500 text-white hover:bg-indigo-600"
          : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600")
      }
    >
      {label}
    </button>
  );
}

function RuleRow({
  rule, templates, busy,
  onToggleRecipient, onToggleChannel, onTemplate, onNotifyActor, onActive, onDelete,
}: {
  rule: NotificationRuleRow;
  templates: EmailTemplateRow[];
  busy: boolean;
  onToggleRecipient: (value: string) => void;
  onToggleChannel: (value: string) => void;
  onTemplate: (value: string) => void;
  onNotifyActor: (value: boolean) => void;
  onActive: (value: boolean) => void;
  onDelete: () => void;
}) {
  const emailActive = rule.channels.includes("email");

  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[1fr_auto]">
      <div className="space-y-3">
        {/* Recipients */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 w-20 shrink-0 text-xs font-medium text-muted-foreground">Recipients</span>
          {NOTIF_RECIPIENTS.map((r) => (
            <Chip
              key={r}
              label={RECIPIENT_LABELS[r] ?? r}
              active={rule.recipients.includes(r)}
              onClick={() => onToggleRecipient(r)}
              disabled={busy}
            />
          ))}
        </div>

        {/* Channels */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 w-20 shrink-0 text-xs font-medium text-muted-foreground">Channels</span>
          {NOTIF_CHANNELS.map((c) => (
            <Chip
              key={c}
              label={CHANNEL_LABELS[c] ?? c}
              active={rule.channels.includes(c)}
              onClick={() => onToggleChannel(c)}
              disabled={busy}
            />
          ))}
        </div>

        {/* Email template (only meaningful when email channel is on) */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 w-20 shrink-0 text-xs font-medium text-muted-foreground">Template</span>
          <Select
            value={rule.email_template ?? NO_TEMPLATE}
            onValueChange={onTemplate}
            disabled={busy}
          >
            <SelectTrigger className="h-8 w-[240px] text-xs">
              <SelectValue placeholder="No template" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TEMPLATE}>No template (default)</SelectItem>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!emailActive && (
            <span className="text-xs text-muted-foreground">used when the Email channel is enabled</span>
          )}
        </div>
      </div>

      {/* Switches + delete */}
      <div className="flex items-start gap-4 lg:flex-col lg:items-end">
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={rule.notify_actor} onCheckedChange={onNotifyActor} disabled={busy} />
          Notify actor
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={rule.is_active} onCheckedChange={onActive} disabled={busy} />
          Active
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      </div>
    </div>
  );
}
