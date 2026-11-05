"use client";

import { useEffect, useRef } from "react";

/**
 * App-wide keyboard shortcuts for the Modern interface (2026-11-05, step B2):
 * ⌘K / Ctrl+K opens the command palette, `?` the shortcuts sheet, and `G` then a
 * letter (within 1.2 s) jumps to a section: D dashboard, T tickets, A approvals,
 * E assets, S settings. Ignored while typing (inputs, textareas, selects, rich-text
 * editors, comboboxes) and with Ctrl/Alt/⌘ (except ⌘K). Mount once (ShortcutsHost).
 *
 * Pages add their own single keys (the queue's J/K, Enter, /, F — step B3) through
 * `usePageShortcuts` in shortcuts-host.tsx; they run after the global keys, under the
 * same typing / dialog / modifier guards, so there is still exactly one listener.
 */
export type GoTarget = "dashboard" | "tickets" | "approvals" | "assets" | "settings";

/** A page's keys: `KeyboardEvent.key` lower-cased ("j", "enter", "arrowdown", "/").
 *  Return `false` to let the key through untouched (e.g. Enter on a focused link). */
export type PageKeyMap = Record<string, (e: KeyboardEvent) => boolean | void>;

const GO: Record<string, GoTarget> = { d: "dashboard", t: "tickets", a: "approvals", e: "assets", s: "settings" };

export function isTypingTarget(el: Element | null): boolean {
  return Boolean(
    el?.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"]',
    ),
  );
}

export function useGlobalShortcuts({
  enabled,
  onPalette,
  onHelp,
  goTo,
  pageKeys,
}: {
  enabled: boolean;
  onPalette: () => void;
  onHelp: () => void;
  goTo: (target: GoTarget) => void;
  /** The keys of the page on screen now (latest registration wins), or null. */
  pageKeys?: () => PageKeyMap | null;
}) {
  // Latest callbacks without re-binding the listener on every render.
  const ref = useRef({ onPalette, onHelp, goTo, pageKeys });
  ref.current = { onPalette, onHelp, goTo, pageKeys };

  useEffect(() => {
    if (!enabled) return;
    let armedAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current.onPalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target as Element | null)) return;
      // Don't steal keys from an open menu / dialog.
      if ((e.target as Element | null)?.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      if (e.key === "?") {
        e.preventDefault();
        ref.current.onHelp();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "g") {
        armedAt = Date.now();
        return;
      }
      if (GO[k] && Date.now() - armedAt < 1200) {
        armedAt = 0;
        e.preventDefault();
        ref.current.goTo(GO[k]);
        return;
      }
      const run = ref.current.pageKeys?.()?.[k];
      if (run && run(e) !== false) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
