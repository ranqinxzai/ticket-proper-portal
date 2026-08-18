"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

import { portalApi } from "@/lib/itsm/api";
import { ItsmApiError } from "@/lib/itsm/client";
import type { PortalSurveyState, SurveyScaleType } from "@/lib/itsm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function scaleOptions(scale: SurveyScaleType): number[] {
  if (scale === "nps") return Array.from({ length: 11 }, (_, i) => i);
  if (scale === "thumbs") return [1, 2];
  return [1, 2, 3, 4, 5];
}

/** The rating control for the survey's scale. Controlled by `value`/`onChange`. */
function RatingInput({
  scale,
  labels,
  value,
  onChange,
  disabled,
}: {
  scale: SurveyScaleType;
  labels: string[];
  value: number | null;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const opts = scaleOptions(scale);

  if (scale === "thumbs") {
    return (
      <div className="flex gap-4">
        {[
          { v: 1, Icon: ThumbsDown, label: labels[0] || "Not satisfied" },
          { v: 2, Icon: ThumbsUp, label: labels[1] || "Satisfied" },
        ].map(({ v, Icon, label }) => (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border px-6 py-4 text-sm transition",
              value === v ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
            )}
          >
            <Icon className="h-7 w-7" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    );
  }

  if (scale === "stars5") {
    return (
      <div className="flex gap-1">
        {opts.map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            aria-pressed={value === n}
            className="p-1 transition hover:scale-110"
          >
            <Star
              className={cn(
                "h-9 w-9",
                value != null && n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
              )}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    );
  }

  // csat5 / nps — numbered buttons with optional end labels.
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {opts.map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            className={cn(
              "grid h-11 min-w-11 place-items-center rounded-md border px-3 text-base font-medium transition",
              value === n ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      {(labels[0] || labels[labels.length - 1]) && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}

export default function PortalFeedbackPage() {
  const { org, id } = useParams<{ org: string; id: string }>();
  const backHref = `/t/${org}/portal/requests/${id}`;

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<PortalSurveyState | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await portalApi.survey(id);
      setState(s);
      if (s?.response?.status === "submitted") {
        setDone(true);
        setRating(s.response.rating);
        setComment(s.response.comment || "");
      } else if (s?.config) {
        // Preselect a rating passed from the email link (?r=N), when valid. Read
        // from window (not useSearchParams) so the page needs no Suspense boundary.
        const r = Number(new URLSearchParams(window.location.search).get("r"));
        if (Number.isFinite(r) && scaleOptions(s.config.scale_type).includes(r)) {
          setRating(r);
        }
      }
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Couldn't load the survey.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (rating == null) {
      toast.error("Please choose a rating.");
      return;
    }
    setSubmitting(true);
    try {
      const s = await portalApi.submitSurvey(id, { rating, comment: comment.trim() || undefined });
      setState(s);
      setDone(true);
      toast.success("Thanks for your feedback!");
    } catch (err) {
      toast.error(err instanceof ItsmApiError ? err.message : "Couldn't submit your feedback.");
    } finally {
      setSubmitting(false);
    }
  }

  const config = state?.config;

  return (
    <div className="mx-auto max-w-xl space-y-5 py-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to request {id}
      </Link>

      <div className="rounded-xl border bg-card p-6 shadow-soft">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" aria-hidden="true" />
            <h1 className="text-lg font-semibold">
              {config?.thank_you_text || "Thank you for your feedback!"}
            </h1>
            <p className="text-sm text-muted-foreground">Your response has been recorded.</p>
            <Button asChild variant="outline" className="mt-2">
              <Link href={backHref}>Back to your request</Link>
            </Button>
          </div>
        ) : !config || !state?.enabled ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            There's no feedback survey available for this request.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-1">
              <h1 className="text-lg font-semibold">{config.question_text}</h1>
              {config.intro_text && (
                <p className="text-sm text-muted-foreground">{config.intro_text}</p>
              )}
            </div>

            <RatingInput
              scale={config.scale_type}
              labels={config.scale_labels || []}
              value={rating}
              onChange={setRating}
              disabled={submitting}
            />

            {config.comment_enabled && (
              <div className="space-y-1.5">
                <label htmlFor="svy-comment" className="text-sm font-medium">
                  {config.comment_prompt}
                  {config.comment_required && <span className="text-destructive"> *</span>}
                </label>
                <textarea
                  id="svy-comment"
                  className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  disabled={submitting}
                />
              </div>
            )}

            <Button onClick={submit} disabled={submitting || rating == null} className="w-full">
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Submit feedback
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
