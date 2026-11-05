"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Stored (server-sanitised) rich HTML, clamped to `lines` lines with "…" and a
 * **Show more / Show less** toggle — long email descriptions and reply trails no
 * longer push the page down (GridCrest 2026-10-29).
 *
 * - Collapsed: `-webkit-line-clamp` gives the "…" on the last line; a max-height
 *   fallback also cuts content that isn't lines (tables, images).
 * - The toggle only renders when the content really overflows (re-measured on
 *   resize, content change and image load) or while expanded.
 * - `bodyProps` go on the wrapper around the content, so a caller can make the body
 *   itself interactive (click-to-edit) while the toggle stays a sibling, never a
 *   nested control. `bodyExtra` renders inside that wrapper (e.g. an "Edit" pill).
 *
 * The HTML must already be sanitised by the server (`sanitize_html`). Module-level.
 */
export function ExpandableHtml({
  html,
  className,
  lines = 6,
  bodyProps,
  bodyExtra,
}: {
  html: string;
  /** Classes for the HTML element itself (e.g. `prose max-w-none`). */
  className?: string;
  lines?: number;
  bodyProps?: React.HTMLAttributes<HTMLDivElement>;
  bodyExtra?: React.ReactNode;
}) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const contentId = React.useId();
  const [expanded, setExpanded] = React.useState(false);
  const [overflowing, setOverflowing] = React.useState(false);

  React.useEffect(() => {
    const el = contentRef.current;
    if (!el || expanded) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("load", measure, true); // images change the height once loaded
    return () => {
      ro.disconnect();
      el.removeEventListener("load", measure, true);
    };
  }, [html, expanded, lines]);

  const collapse = () => {
    setExpanded(false);
    // A long body read to the end: bring its top back into view instead of leaving
    // the reader somewhere further down the page.
    const el = contentRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  };

  // `.prose` is text-sm / leading-relaxed (1.625), so `em` here is the body's font size.
  // The fallback allows each line its own paragraph margin (`.prose p` my-2), so a
  // one-line-per-<p> email isn't cut mid-line before the line clamp's "…".
  const clampStyle: React.CSSProperties | undefined = expanded
    ? undefined
    : {
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: lines,
        overflow: "hidden",
        maxHeight: `calc(${lines} * (1.625em + 0.5rem))`,
      };

  return (
    <div>
      <div {...bodyProps}>
        <div
          ref={contentRef}
          id={contentId}
          className={className}
          style={clampStyle}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {bodyExtra}
      </div>
      {expanded || overflowing ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => (expanded ? collapse() : setExpanded(true))}
          className="mt-1 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring print:hidden"
        >
          {expanded ? "Show less" : "Show more"}
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      ) : null}
    </div>
  );
}
