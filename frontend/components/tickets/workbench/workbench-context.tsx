"use client";

import { createContext, useContext } from "react";

/**
 * Modern workbench (step B4, 2026-11-05): the queue and the open ticket side by side.
 * Provided by `ModernWorkbench` (the project and All Tickets route layouts, Modern on
 * lg+ only). `useWorkbench()` is null in Classic and on narrow screens, where the
 * queue and the ticket stay separate pages.
 */
export type WorkbenchList = {
  /** Ticket numbers in the queue's current order (the rows loaded so far). */
  numbers: string[];
  /** Total in the view (may be more than loaded). */
  count: number;
  hasMore: boolean;
  loadMore: () => Promise<void>;
};

export type Workbench = {
  kind: "project" | "combined";
  /** The queue's own URL (no query); a ticket is `${queuePath}/${number}`. */
  queuePath: string;
  /** The open ticket's number, or null when only the queue shows. */
  currentNumber: string | null;
  hrefFor: (ticketNumber: string) => string;
  /** The queue publishes its loaded rows so the ticket card can page through them. */
  list: WorkbenchList | null;
  publishList: (list: WorkbenchList | null) => void;
  /** 1-based position of the open ticket in the list, or null when it isn't loaded. */
  position: { index: number; total: number } | null;
  /** Open the previous (-1) / next (+1) ticket in the list (loads the next batch if needed). */
  navigate: (delta: -1 | 1) => void;
  /** Back to the queue (the queue keeps its filters, rows and scroll). */
  close: () => void;
  /** `[`: hide the queue so the ticket uses the full width. */
  listHidden: boolean;
  toggleList: () => void;
  /** `]`: the properties panel on the ticket card. */
  panelOpen: boolean;
  togglePanel: () => void;
};

export const WorkbenchContext = createContext<Workbench | null>(null);

export function useWorkbench(): Workbench | null {
  return useContext(WorkbenchContext);
}
