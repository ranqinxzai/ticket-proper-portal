"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

import { surveyConfigApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { Project, SurveyConfig, SurveyMeta, SurveyScaleType } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReadOnlyBanner } from "@/components/settings/read-only-banner";

/** The rating options for a scale — shared shape used by the preview here and the
 *  portal feedback page. csat5/stars5 = 1..5, thumbs = down/up (1/2), nps = 0..10. */
export function scaleOptions(scale: SurveyScaleType): number[] {
  if (scale === "nps") return Array.from({ length: 11 }, (_, i) => i);
  if (scale === "thumbs") return [1, 2];
  return [1, 2, 3, 4, 5];
}

function ScalePreview({ scale }: { scale: SurveyScaleType }) {
  const opts = scaleOptions(scale);
  if (scale === "thumbs") {
    return (
      <div className="flex gap-3 text-muted-foreground">
        <ThumbsDown className="h-6 w-6" aria-hidden="true" />
        <ThumbsUp className="h-6 w-6" aria-hidden="true" />
      </div>
    );
  }
  if (scale === "stars5") {
    return (
      <div className="flex gap-1 text-amber-500">
        {opts.map((n) => (
          <Star key={n} className="h-6 w-6 fill-current" aria-hidden="true" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {opts.map((n) => (
        <span
          key={n}
          className="grid h-9 min-w-9 place-items-center rounded-md border bg-muted/40 px-2 text-sm font-medium"
        >
          {n}
        </span>
      ))}
    </div>
  );
}

export function SurveyEditor({
  project,
  canView,
  canEdit,
}: {
  project: Project;
  canView: boolean;
  canEdit: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState<SurveyMeta | null>(null);
  const [config, setConfig] = useState<SurveyConfig | null>(null);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [m, c] = await Promise.all([
        surveyConfigApi.metadata(),
        surveyConfigApi.forProject(project.id),
      ]);
      setMeta(m);
      setConfig(c);
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Failed to load survey settings.");
    } finally {
      setLoading(false);
    }
  }, [project.id, canView]);

  useEffect(() => {
    void load();
  }, [load]);

  function patch<K extends keyof SurveyConfig>(key: K, value: SurveyConfig[K]) {
    setConfig((c) => (c ? { ...c, [key]: value } : c));
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await surveyConfigApi.update(config.id, {
        enabled: config.enabled,
        trigger: config.trigger,
        scale_type: config.scale_type,
        question_text: config.question_text,
        intro_text: config.intro_text,
        comment_enabled: config.comment_enabled,
        comment_prompt: config.comment_prompt,
        comment_required: config.comment_required,
        thank_you_text: config.thank_you_text,
        email_subject: config.email_subject,
        email_body_html: config.email_body_html,
      });
      setConfig(updated);
      toast.success("Survey settings saved.");
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Failed to save survey settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return <ReadOnlyBanner message="You don't have access to survey configuration." />;
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading survey settings…
      </div>
    );
  }
  if (!config) {
    return <p className="text-sm text-muted-foreground">No survey configuration found.</p>;
  }

  const disabled = !canEdit || saving;

  return (
    <div className="space-y-5">
      {!canEdit && <ReadOnlyBanner />}

      <Card className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Customer satisfaction survey</h3>
            <p className="text-sm text-muted-foreground">
              Email the requestor for feedback when a ticket is resolved or closed. They rate their
              experience from the portal; results feed the CSAT report and dashboard KPI.
            </p>
          </div>
          <Switch
            checked={config.enabled}
            onCheckedChange={(v) => patch("enabled", v)}
            disabled={disabled}
            aria-label="Enable survey"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Send survey when ticket is</Label>
            <Select
              value={config.trigger}
              onValueChange={(v) => patch("trigger", v as SurveyConfig["trigger"])}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(meta?.triggers ?? []).map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Rating scale</Label>
            <Select
              value={config.scale_type}
              onValueChange={(v) => patch("scale_type", v as SurveyScaleType)}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(meta?.scale_types ?? []).map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Preview</Label>
          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="mb-3 text-sm font-medium">{config.question_text || "How did we do?"}</p>
            <ScalePreview scale={config.scale_type} />
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="text-sm font-semibold">Questions &amp; wording</h3>
        <div className="space-y-1.5">
          <Label htmlFor="svy-q">Rating question</Label>
          <Input
            id="svy-q"
            value={config.question_text}
            onChange={(e) => patch("question_text", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="svy-intro">Intro text (optional)</Label>
          <textarea
            id="svy-intro"
            className="min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            value={config.intro_text}
            onChange={(e) => patch("intro_text", e.target.value)}
            disabled={disabled}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>Ask for a comment</Label>
            <p className="text-xs text-muted-foreground">A free-text box below the rating.</p>
          </div>
          <Switch
            checked={config.comment_enabled}
            onCheckedChange={(v) => patch("comment_enabled", v)}
            disabled={disabled}
          />
        </div>
        {config.comment_enabled && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="svy-cp">Comment prompt</Label>
              <Input
                id="svy-cp"
                value={config.comment_prompt}
                onChange={(e) => patch("comment_prompt", e.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="flex items-end justify-between gap-2">
              <div>
                <Label>Require a comment</Label>
                <p className="text-xs text-muted-foreground">Block submit until filled.</p>
              </div>
              <Switch
                checked={config.comment_required}
                onCheckedChange={(v) => patch("comment_required", v)}
                disabled={disabled}
              />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="svy-ty">Thank-you message</Label>
          <Input
            id="svy-ty"
            value={config.thank_you_text}
            onChange={(e) => patch("thank_you_text", e.target.value)}
            disabled={disabled}
          />
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-semibold">Survey email</h3>
          <p className="text-sm text-muted-foreground">
            The message inside the branded email. A “Give feedback” button linking to the portal is
            added automatically. Use <code>{"{{ ticket.number }}"}</code> for the ticket number.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="svy-subj">Subject</Label>
          <Input
            id="svy-subj"
            value={config.email_subject}
            onChange={(e) => patch("email_subject", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Message</Label>
          <RichTextEditor
            value={config.email_body_html}
            onChange={(html) => patch("email_body_html", html)}
            disabled={disabled}
            minHeight={140}
            ariaLabel="Survey email body"
            placeholder="Write the survey email message…"
          />
        </div>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Save survey settings
          </Button>
        </div>
      )}
    </div>
  );
}
