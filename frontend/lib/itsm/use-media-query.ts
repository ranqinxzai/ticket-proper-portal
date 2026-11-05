"use client";

import { useCallback, useSyncExternalStore } from "react";

/** `matchMedia` as a hook. Server snapshot is `false` (the agent chrome never
 *  server-renders — AgentGuard — so the first client value is already right). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined") return () => undefined;
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window === "undefined" ? false : window.matchMedia(query).matches),
    () => false,
  );
}
