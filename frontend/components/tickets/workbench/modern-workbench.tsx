"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { WorkbenchContext, type Workbench, type WorkbenchList } from "./workbench-context";

/** The properties panel (`]`) is remembered per device. */
const PANEL_KEY = "itsm-wb-panel";

function readPanel(): boolean {
  try {
    return window.localStorage.getItem(PANEL_KEY) !== "0";
  } catch {
    return true;
  }
}

/**
 * Modern workbench (step B4, 2026-11-05; mockup `ui-designs/workbench-v7-2026-11.html`).
 * One viewport-tall grid under the top bar: the queue on the left (440px) and, when a
 * ticket is open, the ticket as a lifted card on a grey stage. Rendered by the project
 * and All Tickets route layouts in Modern on lg+; the queue element keeps its place in
 * the tree, so opening, paging and closing tickets never reloads the list.
 */
export function ModernWorkbench({
  kind,
  queuePath,
  currentNumber,
  queue,
  children,
}: {
  kind: "project" | "combined";
  queuePath: string;
  currentNumber: string | null;
  queue: React.ReactNode;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [list, setList] = useState<WorkbenchList | null>(null);
  const [listHidden, setListHidden] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  useEffect(() => setPanelOpen(readPanel()), []);

  // Closing the ticket always brings the queue back.
  useEffect(() => {
    if (!currentNumber) setListHidden(false);
  }, [currentNumber]);

  const hrefFor = useCallback((n: string) => `${queuePath}/${encodeURIComponent(n)}`, [queuePath]);
  const close = useCallback(() => router.push(queuePath), [router, queuePath]);
  const toggleList = useCallback(() => setListHidden((h) => !h), []);
  const togglePanel = useCallback(
    () =>
      setPanelOpen((o) => {
        try {
          window.localStorage.setItem(PANEL_KEY, o ? "0" : "1");
        } catch {
          /* per-device preference only */
        }
        return !o;
      }),
    [],
  );

  // Next past the last loaded row: load the next batch, then move once it arrives.
  const wantNextRef = useRef(false);
  const navigate = useCallback(
    (delta: -1 | 1) => {
      if (!list || !currentNumber) return;
      const i = list.numbers.indexOf(currentNumber);
      if (i < 0) return;
      const j = i + delta;
      if (j < 0) return;
      if (j < list.numbers.length) {
        router.push(hrefFor(list.numbers[j]));
        return;
      }
      if (list.hasMore) {
        wantNextRef.current = true;
        void list.loadMore();
      }
    },
    [list, currentNumber, router, hrefFor],
  );
  useEffect(() => {
    if (!wantNextRef.current || !list || !currentNumber) return;
    const i = list.numbers.indexOf(currentNumber);
    if (i >= 0 && i + 1 < list.numbers.length) {
      wantNextRef.current = false;
      router.push(hrefFor(list.numbers[i + 1]));
    }
  }, [list, currentNumber, router, hrefFor]);

  const position = useMemo(() => {
    if (!list || !currentNumber) return null;
    const i = list.numbers.indexOf(currentNumber);
    return i < 0 ? null : { index: i + 1, total: Math.max(list.count, list.numbers.length) };
  }, [list, currentNumber]);

  const value = useMemo<Workbench>(
    () => ({
      kind,
      queuePath,
      currentNumber,
      hrefFor,
      list,
      publishList: setList,
      position,
      navigate,
      close,
      listHidden,
      toggleList,
      panelOpen,
      togglePanel,
    }),
    [kind, queuePath, currentNumber, hrefFor, list, position, navigate, close, listHidden, toggleList, panelOpen, togglePanel],
  );

  const docked = !!currentNumber;
  const showList = !docked || !listHidden;
  return (
    <WorkbenchContext.Provider value={value}>
      {/* -mx-main-x / -my-main-y cancel <main>'s padding: the workbench is the page. */}
      <div
        data-workbench={docked ? "docked" : "list"}
        className={cn(
          "-mx-main-x -my-main-y grid h-[calc(100dvh-var(--header-h))] min-h-[28rem]",
          docked ? "bg-[var(--wb-stage)]" : "bg-card",
          docked && showList ? "grid-cols-[440px_minmax(0,1fr)]" : "grid-cols-1",
        )}
      >
        <section aria-label="Ticket queue" className={cn("flex min-h-0 min-w-0 flex-col", !showList && "hidden")}>
          {queue}
        </section>
        {docked ? (
          // The focus stage: the open ticket is the one lifted white card.
          <section
            aria-label="Ticket"
            className={cn(
              "relative m-2.5 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card",
              "shadow-[0_1px_3px_rgb(30_31_33/0.08),0_8px_24px_-12px_rgb(30_31_33/0.18)]",
              showList && "ml-0",
            )}
          >
            {children}
          </section>
        ) : null}
      </div>
    </WorkbenchContext.Provider>
  );
}
