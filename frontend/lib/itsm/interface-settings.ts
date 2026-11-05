"use client";

import { useEffect, useState } from "react";

import { interfaceApi } from "./api";
import type { InterfacePublicConfig, ItsmUser } from "./types";

/**
 * Interface: Classic / Modern — the organisation's policy and how the agent app
 * resolves which interface a user gets (2026-11-05, Modern step B2).
 *
 * The public policy (`GET auth/interface/`, no auth) is fetched once per page load
 * and memoised at module scope, like the branding in `company-brand.tsx`.
 */

export type UiMode = "classic" | "modern";

let cache: InterfacePublicConfig | null = null;
let inflight: Promise<InterfacePublicConfig> | null = null;

function loadInterfaceConfig(): Promise<InterfacePublicConfig> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = interfaceApi
      .publicConfig()
      .then((c) => (cache = c))
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Drop the memoised policy (after an admin saves the Interface page). */
export function invalidateInterfaceConfig(next?: InterfacePublicConfig) {
  cache = next ?? null;
}

/** The org's policy, or `undefined` while it loads (and if it can't be read). */
export function useInterfaceConfig(): InterfacePublicConfig | undefined {
  const [config, setConfig] = useState<InterfacePublicConfig | undefined>(cache ?? undefined);
  useEffect(() => {
    let alive = true;
    loadInterfaceConfig()
      .then((c) => alive && setConfig(c))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return config;
}

/**
 * Which interface the user gets, and whether they may change it:
 * 1. Classic retired (date passed) → Modern, locked.
 * 2. Switching turned off → the organisation's default, locked.
 * 3. The user's own choice ("classic" / "modern").
 * 4. The organisation's default (Classic when nothing is known).
 */
export function resolveUi(
  user: Pick<ItsmUser, "ui_preference"> | null,
  config: InterfacePublicConfig | undefined,
): { ui: UiMode; locked: boolean } {
  if (config?.classic_retired) return { ui: "modern", locked: true };
  if (config && !config.ui_allow_switch) return { ui: config.ui_default, locked: true };
  const pref = user?.ui_preference;
  if (pref === "classic" || pref === "modern") return { ui: pref, locked: false };
  return { ui: config?.ui_default ?? "modern", locked: false };
}
