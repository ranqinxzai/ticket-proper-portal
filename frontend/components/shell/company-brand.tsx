"use client";

import { useEffect, useState } from "react";

import { brandingApi } from "@/lib/itsm/api";
import type { BrandingPublicConfig } from "@/lib/itsm/types";
import { cn } from "@/lib/utils";

/**
 * Centered company-brand mark for the top bar (agent shell, workspace bar, and
 * Service Portal). Shows the org's uploaded branding logo — clickable to the
 * website set on the Branding page (opens in a new tab). Falls back to the
 * company name when no logo is uploaded, and renders nothing when the org has no
 * branding configured (so the header centre stays empty, as before).
 *
 * The public config (client name / logo / website) is fetched once and memoized
 * at module scope so the three shells don't each refetch as the user moves
 * between agent home ↔ helpdesk workspace ↔ portal.
 */
let cache: BrandingPublicConfig | null = null;
let inflight: Promise<BrandingPublicConfig> | null = null;

function loadBranding(): Promise<BrandingPublicConfig> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = brandingApi
      .publicConfig()
      .then((c) => (cache = c))
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function CompanyBrand({ className }: { className?: string }) {
  const [branding, setBranding] = useState<BrandingPublicConfig | null>(cache);

  useEffect(() => {
    let cancelled = false;
    loadBranding()
      .then((c) => !cancelled && setBranding(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!branding) return null;
  const name = branding.client_name?.trim();
  const hasLogo = Boolean(branding.logo_url);
  if (!hasLogo && !name) return null;

  const inner = hasLogo ? (
    // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded asset
    <img src={branding.logo_url} alt={name || "Company logo"} className="max-h-9 w-auto" />
  ) : (
    <span className="truncate text-sm font-semibold">{name}</span>
  );

  const site = branding.website?.trim();
  if (!site) {
    return <span className={cn("flex items-center", className)}>{inner}</span>;
  }
  return (
    <a
      href={site}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={name ? `${name} website` : "Company website"}
      className={cn(
        "flex items-center rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {inner}
    </a>
  );
}
