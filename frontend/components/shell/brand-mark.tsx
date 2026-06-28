"use client";

import { useState } from "react";
import { LifeBuoy } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Company logo + "One Helpdesk" wordmark for the top bar.
 *
 * Tries the logo from `public/` in order of preference (webp/png/svg/jpg) so
 * whichever format you drop in works without a code change. If none load it
 * falls back to a LifeBuoy mark so the chrome never breaks. Drop the real file
 * at e.g. `frontend/public/logo.webp` to display the company logo (the pilot
 * bakes `public/` in at build time, so a rebuild is required to pick it up).
 */
const LOGO_CANDIDATES = ["/logo.webp", "/logo.png", "/logo.svg", "/logo.jpg"];

export function BrandMark({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  const [idx, setIdx] = useState(0);
  const exhausted = idx >= LOGO_CANDIDATES.length;

  return (
    <span className={cn("flex items-center gap-2 font-semibold", className)}>
      {exhausted ? (
        <span
          aria-hidden="true"
          className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground"
        >
          <LifeBuoy className="h-4 w-4" />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- optional asset; needs onError fallback
        <img
          src={LOGO_CANDIDATES[idx]}
          alt={showWordmark ? "" : "One Helpdesk"}
          className="h-7 w-auto"
          onError={() => setIdx((i) => i + 1)}
        />
      )}
      {showWordmark ? <span>One Helpdesk</span> : null}
    </span>
  );
}
