"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Copy, Mail, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { notifAdminApi } from "@/lib/itsm/admin-api";
import { ItsmApiError } from "@/lib/itsm/client";
import { NOTIF_EVENTS } from "@/lib/itsm/admin-types";
import type { EmailTemplateRow } from "@/lib/itsm/admin-types";

/** Tokens supported by the Django templates, with sample values for the preview. */
const TOKENS: { token: string; sample: string; note: string }[] = [
  { token: "{{ ticket.number }}", sample: "INC-1042", note: "Ticket reference number" },
  { token: "{{ ticket.summary }}", sample: "Login page returns 500", note: "Short summary" },
  { token: "{{ ticket.status }}", sample: "In Progress", note: "Current status" },
  { token: "{{ ticket.priority }}", sample: "High", note: "Current priority" },
  { token: "{{ ticket.assignee }}", sample: "Jordan Lee", note: "Assigned agent" },
  { token: "{{ ticket.url }}", sample: "https://itsm.example.com/tickets/INC-1042", note: "Deep link to the ticket" },
  { token: "{{ actor }}", sample: "Sam Patel", note: "User who triggered the event" },
];

function eventLabel(event: string): string {
  return event.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function errMessage(e: unknown, fallback: string): string {
  if (e instanceof ItsmApiError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

/** Display-only token substitution for the preview (simple string replace). */
function renderPreview(input: string): string {
  let out = input;
  for (const { token, sample } of TOKENS) {
    out = out.split(token).join(sample);
  }
  return out;
}

type Draft = {
  name: string;
  event_type: string;
  subject_template: string;
  body_text_template: string;
  body_html_template: string;
};

function toDraft(t: EmailTemplateRow): Draft {
  return {
    name: t.name,
    event_type: t.event_type,
    subject_template: t.subject_template,
    body_text_template: t.body_text_template,
    body_html_template: t.body_html_template,
  };
}

const EMPTY_DRAFT: Draft = {
  name: "",
  event_type: NOTIF_EVENTS[0],
  subject_template: "",
  body_text_template: "",
  body_html_template: "",
};

export function EmailTemplateEditor() {
  const [templates, setTemplates] = useState<EmailTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (selectId?: string) => {
    setLoading(true);
    try {
      const list = await notifAdminApi.templates();
      setTemplates(list);
      if (selectId) {
        const found = list.find((t) => t.id === selectId);
        if (found) {
          setSelectedId(found.id);
          setCreating(false);
          setDraft(toDraft(found));
        }
      } else if (!selectId && list.length && selectedId === null && !creating) {
        setSelectedId(list[0].id);
        setDraft(toDraft(list[0]));
      }
    } catch (e) {
      toast.error(errMessage(e, "Failed to load templates"));
      setTemplates([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );
  const isSystem = !creating && Boolean(selected?.is_system);

  function selectTemplate(t: EmailTemplateRow) {
    setCreating(false);
    setSelectedId(t.id);
    setDraft(toDraft(t));
  }

  function startNew() {
    setCreating(true);
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
  }

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      toast.success(`Copied ${token}`);
    } catch {
      toast.error("Clipboard not available");
    }
  }

  const save = useCallback(async () => {
    if (!draft.name.trim()) {
      toast.error("Template name is required");
      return;
    }
    setSaving(true);
    try {
      if (creating) {
        const created = await notifAdminApi.createTemplate(draft);
        toast.success("Template created");
        await load(created.id);
      } else if (selectedId) {
        const updated = await notifAdminApi.updateTemplate(selectedId, draft);
        toast.success("Template saved");
        await load(updated.id);
      }
    } catch (e) {
      toast.error(errMessage(e, "Failed to save template"));
    } finally {
      setSaving(false);
    }
  }, [creating, draft, selectedId, load]);

  const showEditor = creating || selected !== null;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr_240px]">
      {/* Template list */}
      <div className="rounded-lg border bg-white">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Templates</span>
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={startNew}>
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>
        <div className="max-h-[520px] overflow-y-auto p-1">
          {loading ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : templates.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No templates yet.</div>
          ) : (
            templates.map((t) => {
              const active = !creating && t.id === selectedId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTemplate(t)}
                  className={
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors " +
                    (active ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-50")
                  }
                >
                  <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{t.name}</span>
                  {t.is_system && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                </button>
              );
            })
          )}
          {creating && (
            <div className="flex items-center gap-2 rounded-md bg-indigo-50 px-2.5 py-2 text-sm text-indigo-700">
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 truncate">New template…</span>
            </div>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="rounded-lg border bg-white p-4">
        {!showEditor ? (
          <div className="grid h-full place-items-center py-12 text-sm text-muted-foreground">
            Select a template or create a new one.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold">{creating ? "New template" : "Edit template"}</h3>
              <div className="flex items-center gap-2">
                {isSystem && (
                  <span className="flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                    <Lock className="h-3 w-3" /> System template
                  </span>
                )}
                <Button size="sm" className="gap-1" onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Name</Label>
                <Input
                  id="tpl-name"
                  value={draft.name}
                  onChange={(e) => setField("name", e.target.value)}
                  placeholder="e.g. Ticket assigned"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-event">Event</Label>
                <Select value={draft.event_type} onValueChange={(v) => setField("event_type", v)}>
                  <SelectTrigger id="tpl-event"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {NOTIF_EVENTS.map((ev) => (
                      <SelectItem key={ev} value={ev}>{eventLabel(ev)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-subject">Subject</Label>
              <Input
                id="tpl-subject"
                value={draft.subject_template}
                onChange={(e) => setField("subject_template", e.target.value)}
                placeholder="[{{ ticket.number }}] {{ ticket.summary }}"
              />
              {draft.subject_template && (
                <p className="text-xs text-muted-foreground">
                  Preview: <span className="font-medium text-foreground">{renderPreview(draft.subject_template)}</span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-text">Plain-text body</Label>
              <textarea
                id="tpl-text"
                value={draft.body_text_template}
                onChange={(e) => setField("body_text_template", e.target.value)}
                rows={5}
                placeholder="Hi, ticket {{ ticket.number }} was updated by {{ actor }}…"
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-html">HTML body</Label>
              <textarea
                id="tpl-html"
                value={draft.body_html_template}
                onChange={(e) => setField("body_html_template", e.target.value)}
                rows={7}
                placeholder="<p>Hi, ticket {{ ticket.number }} was updated.</p>"
                className="w-full rounded-lg border bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>

            {(draft.body_html_template || draft.body_text_template) && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Rendered preview (sample data)
                  </div>
                  {draft.body_html_template ? (
                    <div
                      className="prose prose-sm max-w-none rounded-lg border bg-slate-50 px-3 py-2"
                      // Display-only preview with sample substitutions; admin-authored content.
                      dangerouslySetInnerHTML={{ __html: renderPreview(draft.body_html_template) }}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap rounded-lg border bg-slate-50 px-3 py-2 text-sm">
                      {renderPreview(draft.body_text_template)}
                    </pre>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Token reference */}
      <div className="rounded-lg border bg-white p-3">
        <div className="text-sm font-semibold">Tokens</div>
        <p className="mt-1 text-xs text-muted-foreground">Click to copy into the clipboard.</p>
        <div className="mt-3 space-y-1.5">
          {TOKENS.map(({ token, note }) => (
            <button
              key={token}
              type="button"
              onClick={() => copyToken(token)}
              title={note}
              className="group flex w-full items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50"
            >
              <code className="flex-1 truncate text-xs text-indigo-700">{token}</code>
              <Copy className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-indigo-600" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
