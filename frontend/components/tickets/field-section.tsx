"use client";

import { useId, useState } from "react";
import { AlignLeft, ChevronDown, SlidersHorizontal } from "lucide-react";

import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";

/** One layout section card on the ticket detail view (header + field grid).
 *
 * `collapsible` sections have a header button that collapses / expands the card.
 * `defaultOpen=false` starts it closed: the layout's "Collapsed" switch, or a section
 * that is empty until a later step fills it (Resolution Details is captured on
 * Resolve). The open state follows `defaultOpen` until the agent toggles it, so a
 * section that gains values (e.g. the ticket gets resolved) opens by itself without a
 * remount. Module-top-level (React focus-stability rule). */
export function FieldSectionCard({
  title,
  collapsible = false,
  defaultOpen = true,
  summary,
  collapsedHint,
  children,
}: {
  title: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Muted one-liner shown beside the title while collapsed. */
  summary?: string;
  /** Hover / focus help on the collapsed header ("what is this, why is it closed"). */
  collapsedHint?: string;
  children: React.ReactNode;
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const bodyId = useId();
  const open = !collapsible || (userOpen ?? defaultOpen);
  const chip = (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg compact:h-6 compact:w-6",
        collapsible && !open ? "bg-muted text-muted-foreground" : "bg-accent text-accent-foreground",
      )}
    >
      <AlignLeft className="h-4 w-4" aria-hidden="true" />
    </span>
  );
  const headCls = "flex items-center gap-3 bg-muted/30 px-5 py-3.5 compact:px-3.5 compact:py-2";

  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-xl border bg-card shadow-soft transition-shadow duration-200 hover:shadow-soft-md"
    >
      {collapsible ? (
        <h2 className="text-sm font-semibold">
          <Hint label={!open ? collapsedHint : ""} align="start">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setUserOpen(!open)}
            className={cn(
              headCls,
              "w-full text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
              open && "border-b",
            )}
          >
            {chip}
            <span>{title}</span>
            {!open && summary ? (
              <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">{summary}</span>
            ) : null}
            <ChevronDown
              className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </button>
          </Hint>
        </h2>
      ) : (
        <div className={cn(headCls, "border-b")}>
          {chip}
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
      )}
      {open ? <div id={bodyId}>{children}</div> : null}
    </section>
  );
}

/** One layout section card in the ticket detail's side rail (People, Info, …):
 *  small uppercase header + label-beside-value rows. The header button collapses /
 *  expands it; `defaultOpen=false` (the layout's "Collapsed" switch) starts it closed.
 *  Same open-state rule as FieldSectionCard. Module-top-level. */
export function SideSectionCard({
  title,
  defaultOpen = true,
  collapsedHint,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  collapsedHint?: string;
  children: React.ReactNode;
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const bodyId = useId();
  const open = userOpen ?? defaultOpen;
  return (
    <section
      aria-label={title}
      className="rounded-xl border bg-card p-4 text-sm shadow-soft transition-shadow duration-200 hover:shadow-soft-md compact:p-3"
    >
      <h2 className={cn("text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", open && "mb-3 compact:mb-2")}>
        <Hint label={!open ? collapsedHint : ""} align="start">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setUserOpen(!open)}
            className="flex w-full items-center gap-2 rounded-md text-left uppercase transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {/* Decorative section chip — was an Info "i", which read as a help icon
                that did nothing. Field help lives on each label's ⓘ. */}
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                open ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground",
              )}
              aria-hidden="true"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 truncate">{title}</span>
            <ChevronDown
              className={cn("ml-auto h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </button>
        </Hint>
      </h2>
      {open ? <div id={bodyId}>{children}</div> : null}
    </section>
  );
}

/** Grid for a section's fields, honouring the layout designer's Half/Full widths
 *  (the create form already did; the detail view stacked everything full-width).
 *  Two columns where the main column is wide enough: md (no side rail yet) and xl+;
 *  one column at lg, where the side rail first appears and the main column is narrow. */
export const FIELD_GRID_CLS =
  "grid grid-cols-1 gap-4 p-5 compact:gap-3 compact:p-3.5 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2";

/** Column span for one field in FIELD_GRID_CLS — full width unless the layout item is
 *  "half" (rich text is always full). Same rule as the create form. */
export function fieldSpanClass(fieldType: string, width: string | undefined): string {
  return fieldType === "richtext" || width !== "half" ? "md:col-span-2 lg:col-span-1 xl:col-span-2" : "";
}
