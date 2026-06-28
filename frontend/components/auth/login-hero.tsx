"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Left-hand hero for the split login screen.
 *
 * Default look is a self-contained, on-brand gradient (ONE LEARN pink → violet →
 * cyan) with depth blobs + a headline — no asset required. If you drop a real
 * photo at `public/login-hero.{webp,png,jpg}` it's layered underneath a scrim so
 * the copy stays legible; if it's missing the gradient alone shows. The pilot
 * bakes `public/` in at build time, so a rebuild is needed to pick a photo up.
 */
const HERO_CANDIDATES = ["/login-hero.webp", "/login-hero.png", "/login-hero.jpg"];

const FEATURES = ["Incidents", "Service Requests", "Approvals", "SLA tracking"];

export function LoginHero({ className }: { className?: string }) {
  const [idx, setIdx] = useState(0);
  const photo = idx < HERO_CANDIDATES.length ? HERO_CANDIDATES[idx] : null;

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-[linear-gradient(135deg,#ec0a8c_0%,#7c3aed_52%,#22b5e6_100%)]",
        className,
      )}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- optional asset; needs onError fallback
        <img
          src={photo}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setIdx((i) => i + 1)}
        />
      ) : null}

      {/* Scrim keeps the copy legible whether or not a photo loaded. */}
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(236,10,140,0.85)_0%,rgba(124,58,237,0.78)_52%,rgba(34,181,230,0.72)_100%)]" />
      {/* Depth blobs. */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-white/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -right-10 h-96 w-96 rounded-full bg-cyan-200/25 blur-3xl" />

      <div className="relative z-10 flex h-full min-h-screen flex-col justify-between p-10 text-white xl:p-14">
        <span className="flex items-center gap-2.5 text-sm font-semibold uppercase tracking-[0.22em] text-white/85">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/logo-mark-light.svg" alt="" aria-hidden="true" className="h-8 w-8" />
          One Helpdesk
        </span>

        <div className="max-w-xl">
          <p className="text-4xl font-bold leading-[1.1] tracking-tight xl:text-5xl">
            Every request,
            <br />
            one helpdesk.
          </p>
          <p className="mt-5 text-base leading-relaxed text-white/85 xl:text-lg">
            IT, HR and Facilities support in a single workspace — incidents, service requests,
            approvals and SLAs, beautifully organised.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2">
            {FEATURES.map((f) => (
              <li
                key={f}
                className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-sm backdrop-blur"
              >
                {f}
              </li>
            ))}
          </ul>
        </div>

        <span className="text-sm text-white/70">Helpdesk, simplified.</span>
      </div>
    </div>
  );
}
