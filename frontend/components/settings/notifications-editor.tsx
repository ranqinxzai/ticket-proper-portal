"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Eye, Loader2, Mail, MessageCircle, Pencil, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import {
  emailTemplatesApi,
  notificationRulesApi,
  notificationSchemesApi,
} from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type {
  NotificationChannelKey,
  NotificationChannelMeta,
  NotificationMeta,
  NotificationMetaItem,
  NotificationRule,
  Project,
} from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { EmailShellPreview } from "@/components/settings/email-shell-preview";
import { cn } from "@/lib/utils";

const CHANNEL_ICON: Record<string, LucideIcon> = {
  in_app: Bell,
  email: Mail,
  whatsapp: MessageCircle,
};

type SampleContext = Record<string, string>;

/** Replace `{{ ticket.number }}`-style placeholders with sample values for the
 *  template preview. The real substitution is Django templating done server-side
 *  when the email is sent; this is a faithful client-side approximation. */
function substitutePlaceholders(html: string, sample: SampleContext): string {
  return html.replace(/{{\s*([\w.]+)\s*}}/g, (_m, key: string) => sample[key] ?? "…");
}

// ---- email-template editor dialog -----------------------------------------

function TemplateDialog({
  open,
  templateId,
  eventLabel,
  eventType,
  canEdit,
  sample,
  onOpenChange,
}: {
  open: boolean;
  templateId: string | null;
  eventLabel: string;
  eventType: string;
  canEdit: boolean;
  sample: SampleContext;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  useEffect(() => {
    if (!open || !templateId) return;
    setLoading(true);
    setMode("edit");
    emailTemplatesApi
      .get(templateId)
      .then((t) => {
        setSubject(t.subject_template);
        setBodyHtml(t.body_html_template);
      })
      .catch(() => toast.error("Could not load the email template."))
      .finally(() => setLoading(false));
  }, [open, templateId]);

  async function save() {
    if (!templateId) return;
    setSaving(true);
    try {
      const updated = await emailTemplatesApi.update(templateId, {
        subject_template: subject,
        body_html_template: bodyHtml,
      });
      // Reflect the server-sanitised body that was actually stored.
      setBodyHtml(updated.body_html_template);
      toast.success("Email template saved.");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ItsmApiError ? e.message : "Could not save the email template.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Email template — {eventLabel}</DialogTitle>
          <DialogDescription>
            Placeholders like {"{{ ticket.number }}"}, {"{{ ticket.summary }}"} and {"{{ actor }}"}{" "}
            are filled in automatically when the email is sent. Preview shows your message inside the
            branded email layout recipients receive — you edit the message; the header, ticket
            details and button are added automatically.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Subject</label>
              <Input
                value={subject}
                disabled={!canEdit || saving}
                onChange={(e) => setSubject(e.target.value)}
                aria-label="Email subject"
              />
              {mode === "preview" ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Preview: {substitutePlaceholders(subject, sample) || "—"}
                </p>
              ) : null}
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Body</label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === "edit" ? "default" : "outline"}
                    onClick={() => setMode("edit")}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === "preview" ? "default" : "outline"}
                    onClick={() => setMode("preview")}
                  >
                    <Eye className="mr-1 h-3.5 w-3.5" /> Preview
                  </Button>
                </div>
              </div>
              {mode === "edit" ? (
                <RichTextEditor
                  value={bodyHtml}
                  onChange={setBodyHtml}
                  disabled={!canEdit || saving}
                  minHeight={180}
                  ariaLabel="Email body"
                  placeholder="Write the email body…"
                />
              ) : (
                // Safe: the body is Tiptap-constrained markup and is bleach-sanitised
                // server-side on every save (see EmailTemplateSerializer). The shell mirrors
                // the backend email_base.html so the preview matches what's actually sent.
                <EmailShellPreview
                  eventType={eventType}
                  contentHtml={substitutePlaceholders(bodyHtml, sample)}
                  sample={sample}
                />
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Close
          </Button>
          {canEdit ? (
            <Button onClick={save} disabled={saving || loading}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save template
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- toggle chip ----------------------------------------------------------

function Chip({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        disabled && "cursor-not-allowed opacity-50 hover:bg-background hover:text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ---- one event row --------------------------------------------------------

function EventRow({
  event,
  rule,
  channels,
  recipients,
  canEditRules,
  canEditTemplates,
  saving,
  onToggleActive,
  onToggleChannel,
  onToggleRecipient,
  onToggleNotifyActor,
  onEditTemplate,
}: {
  event: NotificationMetaItem;
  rule: NotificationRule;
  channels: NotificationChannelMeta[];
  recipients: NotificationMetaItem[];
  canEditRules: boolean;
  canEditTemplates: boolean;
  saving: boolean;
  onToggleActive: (rule: NotificationRule, on: boolean) => void;
  onToggleChannel: (rule: NotificationRule, channel: NotificationChannelKey) => void;
  onToggleRecipient: (rule: NotificationRule, value: string) => void;
  onToggleNotifyActor: (rule: NotificationRule, on: boolean) => void;
  onEditTemplate: (rule: NotificationRule, eventLabel: string) => void;
}) {
  const emailOn = rule.channels.includes("email");
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{event.label}</span>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{rule.is_active ? "On" : "Off"}</span>
          <Switch
            checked={rule.is_active}
            disabled={!canEditRules || saving}
            onCheckedChange={(v) => onToggleActive(rule, v)}
            aria-label={`Enable ${event.label} notifications`}
          />
        </div>
      </div>

      {rule.is_active ? (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Channels</span>
            {channels.map((ch) => {
              const Icon = CHANNEL_ICON[ch.value] ?? Bell;
              const active = rule.channels.includes(ch.value) && ch.available;
              const disabled = !canEditRules || saving || !ch.available;
              return (
                <Chip
                  key={ch.value}
                  active={active}
                  disabled={disabled}
                  title={ch.available ? undefined : "Coming soon"}
                  onClick={() => onToggleChannel(rule, ch.value)}
                >
                  <Icon className="h-3.5 w-3.5" /> {ch.label}
                  {!ch.available ? (
                    <span className="ml-1 rounded bg-muted px-1 text-[10px] font-semibold uppercase text-muted-foreground">
                      Soon
                    </span>
                  ) : null}
                </Chip>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Recipients</span>
            {recipients.map((rc) => (
              <Chip
                key={rc.value}
                active={rule.recipients.includes(rc.value)}
                disabled={!canEditRules || saving}
                onClick={() => onToggleRecipient(rule, rc.value)}
              >
                {rc.label}
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={rule.notify_actor}
                disabled={!canEditRules || saving}
                onCheckedChange={(v) => onToggleNotifyActor(rule, v)}
                aria-label="Also notify the person who triggered the event"
              />
              Also notify the person who triggered it
            </label>
            {emailOn && rule.email_template ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!canEditTemplates}
                onClick={() => onEditTemplate(rule, event.label)}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" /> Email template
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---- main editor ----------------------------------------------------------

/** Per-project notification configuration: enable/disable each event, pick its
 *  channels (In-App / Email / WhatsApp-coming-soon) and recipients, and edit the
 *  email subject + HTML body. Backed by the project's own NotificationScheme. */
export function NotificationsEditor({
  project,
  canView,
  canEditRules,
  canEditTemplates,
}: {
  project: Project;
  canView: boolean;
  canEditRules: boolean;
  canEditTemplates: boolean;
}) {
  const [meta, setMeta] = useState<NotificationMeta | null>(null);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    { templateId: string; eventLabel: string; eventType: string } | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [scheme, m] = await Promise.all([
        notificationSchemesApi.forProject(project.id),
        notificationSchemesApi.metadata(),
      ]);
      setRules(scheme.rules);
      setMeta(m);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    load().catch(() => toast.error("Could not load notification settings."));
  }, [load, canView]);

  const sample = useMemo<SampleContext>(
    () => ({
      "ticket.number": `${project.key}-1024`,
      "ticket.summary": "Printer on 3rd floor not working",
      "ticket.priority": "High",
      "ticket.status": "In Progress",
      "ticket.assignee": "Alex Morgan",
      "ticket.group": "Service Desk",
      "ticket.url": "#",
      actor: "Jordan Lee",
      event: "updated",
    }),
    [project.key],
  );

  const patchRule = useCallback(
    async (rule: NotificationRule, partial: Partial<NotificationRule>) => {
      if (!canEditRules) return;
      setSavingRuleId(rule.id);
      const prev = rules;
      setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, ...partial } : r)));
      try {
        await notificationRulesApi.update(rule.id, partial);
      } catch (e) {
        setRules(prev); // revert optimistic change
        toast.error(e instanceof ItsmApiError ? e.message : "Could not save the change.");
      } finally {
        setSavingRuleId(null);
      }
    },
    [canEditRules, rules],
  );

  const onToggleActive = useCallback(
    (rule: NotificationRule, on: boolean) => void patchRule(rule, { is_active: on }),
    [patchRule],
  );
  const onToggleNotifyActor = useCallback(
    (rule: NotificationRule, on: boolean) => void patchRule(rule, { notify_actor: on }),
    [patchRule],
  );
  const onToggleChannel = useCallback(
    (rule: NotificationRule, channel: NotificationChannelKey) => {
      const channels = rule.channels.includes(channel)
        ? rule.channels.filter((c) => c !== channel)
        : [...rule.channels, channel];
      void patchRule(rule, { channels });
    },
    [patchRule],
  );
  const onToggleRecipient = useCallback(
    (rule: NotificationRule, value: string) => {
      const recipients = rule.recipients.includes(value)
        ? rule.recipients.filter((r) => r !== value)
        : [...rule.recipients, value];
      void patchRule(rule, { recipients });
    },
    [patchRule],
  );
  const onEditTemplate = useCallback((rule: NotificationRule, eventLabel: string) => {
    if (rule.email_template)
      setDialog({ templateId: rule.email_template, eventLabel, eventType: rule.event_type });
  }, []);

  if (!canView) {
    return (
      <p className="text-sm text-muted-foreground">
        You don’t have access to notification settings. Ask a supervisor to configure them.
      </p>
    );
  }
  if (loading) return <p className="text-sm text-muted-foreground">Loading notification settings…</p>;
  if (!meta) return null;

  const ruleByEvent = new Map(rules.map((r) => [r.event_type, r]));

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Notifications</h3>
        <p className="text-sm text-muted-foreground">
          Choose which events notify people on this project, the channels used, and who receives
          them. Email subjects and bodies are editable per event.
          {!canEditRules ? " You have read-only access — ask a supervisor to make changes." : ""}
        </p>
      </div>

      <div className="space-y-3">
        {meta.events.map((event) => {
          const rule = ruleByEvent.get(event.value);
          if (!rule) return null;
          return (
            <EventRow
              key={event.value}
              event={event}
              rule={rule}
              channels={meta.channels}
              recipients={meta.recipients}
              canEditRules={canEditRules}
              canEditTemplates={canEditTemplates}
              saving={savingRuleId === rule.id}
              onToggleActive={onToggleActive}
              onToggleChannel={onToggleChannel}
              onToggleRecipient={onToggleRecipient}
              onToggleNotifyActor={onToggleNotifyActor}
              onEditTemplate={onEditTemplate}
            />
          );
        })}
      </div>

      <TemplateDialog
        open={dialog !== null}
        templateId={dialog?.templateId ?? null}
        eventLabel={dialog?.eventLabel ?? ""}
        eventType={dialog?.eventType ?? ""}
        canEdit={canEditTemplates}
        sample={sample}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      />
    </div>
  );
}
