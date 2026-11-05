"use client";

import { useLayoutEffect, useRef } from "react";

import { useItsmAuth } from "@/lib/itsm/auth";
import { resolveUi, useInterfaceConfig } from "@/lib/itsm/interface-settings";
import { UI_KEY, type UiMode, useUi } from "./density-provider";

/** Store the resolved interface for the pre-paint script without touching state. */
function persistUi(ui: UiMode) {
  try {
    if (localStorage.getItem(UI_KEY) !== ui) localStorage.setItem(UI_KEY, ui);
  } catch {
    /* ignore (private mode) */
  }
}

/**
 * Keeps the agent app's interface (Classic / Modern) in line with the user's saved
 * choice and the organisation's policy (2026-11-05, Modern step B2). Mounted once in
 * the agent layout, below AgentGuard (so the user is known).
 *
 * The pre-paint script can only read localStorage `itsm-ui`, so this writes the
 * resolved value through `setUi` (which stores it) EVERY time it resolves, not only on
 * a change — the next load is then right before paint (unset = Modern, so an org that
 * keeps Classic flashes Modern at most once, on a browser's very first load). Runs in a layout effect so a correction commits before the browser
 * paints. It re-resolves only when the saved preference or the policy changes, never
 * on `ui` itself: a switch in the profile menu must not be undone before the server
 * echo (refreshUser) arrives.
 */
export function InterfaceSync() {
  const { user } = useItsmAuth();
  const { ui, setUi, setUiLocked } = useUi();
  const config = useInterfaceConfig();
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const known = Boolean(user);
  const pref = user?.ui_preference ?? "";

  useLayoutEffect(() => {
    if (!known) return;
    // With no explicit choice the organisation's default decides: wait for the policy
    // instead of flipping to Classic and back.
    if (!pref && !config) return;
    const resolved = resolveUi({ ui_preference: pref }, config);
    setUiLocked(resolved.locked);
    if (resolved.ui !== uiRef.current) setUi(resolved.ui);
    else persistUi(resolved.ui);
  }, [known, pref, config, setUi, setUiLocked]);

  return null;
}
