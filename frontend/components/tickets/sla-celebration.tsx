"use client";

import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import { CheckCircle2, Medal, Star, ThumbsUp, Trophy, X, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CelebrationResult, CelebrationTier } from "@/lib/itsm/sla-celebration";

const GOLD = ["#f59e0b", "#fbbf24", "#fcd34d", "#fde68a", "#eab308"];
const FESTIVE = ["#6366f1", "#8b5cf6", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4"];

const TIERS: Record<
  CelebrationTier,
  { Icon: LucideIcon; title: string; blurb: string; badge: string }
> = {
  legendary: { Icon: Trophy, title: "Legendary resolve!", blurb: "You crushed this SLA with time to spare.", badge: "from-amber-400 to-yellow-500" },
  excellent: { Icon: Medal, title: "Excellent work!", blurb: "Resolved well ahead of the deadline.", badge: "from-amber-400 to-orange-500" },
  great: { Icon: Star, title: "Great job!", blurb: "Comfortably inside the SLA window.", badge: "from-violet-500 to-fuchsia-500" },
  ontime: { Icon: ThumbsUp, title: "On time!", blurb: "Nicely done — SLA met.", badge: "from-sky-500 to-indigo-500" },
  justintime: { Icon: CheckCircle2, title: "Just in time!", blurb: "Cut it close, but you made it.", badge: "from-emerald-500 to-teal-500" },
};

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Fire a confetti sequence whose intensity escalates with the tier. */
function fireConfetti(tier: CelebrationTier) {
  if (reducedMotion()) return;
  const base = { zIndex: 200, disableForReducedMotion: true } as const;
  const colors = tier === "legendary" || tier === "excellent" ? [...GOLD, ...FESTIVE] : FESTIVE;

  if (tier === "legendary") {
    confetti({ ...base, particleCount: 180, spread: 100, startVelocity: 45, origin: { y: 0.6 }, colors, scalar: 1.1 });
    const end = Date.now() + 1400;
    const frame = () => {
      confetti({ ...base, particleCount: 7, angle: 60, spread: 72, origin: { x: 0 }, colors });
      confetti({ ...base, particleCount: 7, angle: 120, spread: 72, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  } else if (tier === "excellent") {
    confetti({ ...base, particleCount: 140, spread: 90, startVelocity: 42, origin: { y: 0.6 }, colors, scalar: 1.05 });
    confetti({ ...base, particleCount: 55, angle: 60, spread: 60, origin: { x: 0 }, colors });
    confetti({ ...base, particleCount: 55, angle: 120, spread: 60, origin: { x: 1 }, colors });
  } else if (tier === "great") {
    confetti({ ...base, particleCount: 110, spread: 80, origin: { y: 0.6 }, colors });
  } else if (tier === "ontime") {
    confetti({ ...base, particleCount: 70, spread: 66, origin: { y: 0.65 }, colors });
  } else {
    confetti({ ...base, particleCount: 45, spread: 55, startVelocity: 32, origin: { y: 0.7 }, colors });
  }
}

function fmtMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h}h ${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
}

/** Full-screen "SLA win" celebration: confetti + a congratulatory tier card.
 *  Auto-dismisses; also closes on backdrop click, the button, or Esc. Confetti is
 *  skipped under prefers-reduced-motion (the card still shows). */
export function SlaCelebration({ result, onClose }: { result: CelebrationResult; onClose: () => void }) {
  const meta = TIERS[result.tier];
  const Icon = meta.Icon;
  const pct = Math.round(result.pctLeft);

  // Keep the latest onClose without re-running the mount effect (avoids re-firing
  // confetti / resetting the timer on parent re-renders).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    fireConfetti(result.tier);
    const ms = result.tier === "legendary" ? 6500 : result.tier === "excellent" ? 5500 : 5000;
    const timer = window.setTimeout(() => closeRef.current(), ms);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [result.tier]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="SLA achievement">
      <div className="absolute inset-0 bg-background/50 backdrop-blur-sm animate-in fade-in" onClick={onClose} />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border bg-card p-6 text-center shadow-soft-lg duration-300 animate-in fade-in zoom-in-95">
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className={cn("mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-soft-md", meta.badge)}>
          <Icon className="h-8 w-8" aria-hidden="true" />
        </div>
        <p className="sr-only" aria-live="assertive">
          Ticket resolved within SLA. {meta.title} {pct}% of the SLA still to spare.
        </p>

        <h2 className="mt-4 text-xl font-bold tracking-tight">{meta.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{meta.blurb}</p>

        <div className="mt-4 rounded-xl border bg-muted/40 p-4">
          <div className="bg-gradient-to-br from-primary to-chart-4 bg-clip-text text-3xl font-extrabold tabular-nums text-transparent">
            {pct}%
          </div>
          <div className="text-xs font-medium text-muted-foreground">of SLA still to spare</div>
          <div className="mt-2 text-xs text-muted-foreground">
            {result.metricName}: {fmtMinutes(result.elapsedMinutes)} of {fmtMinutes(result.targetMinutes)}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-gradient-to-br from-primary to-chart-4 px-5 text-sm font-semibold text-white shadow-soft-md transition hover:brightness-105"
        >
          Nice! 🎉
        </button>
      </div>
    </div>
  );
}
