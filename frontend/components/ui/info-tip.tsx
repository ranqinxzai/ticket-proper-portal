"use client";

import * as React from "react";
import { Info } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface InfoTipProps {
  /** The explanation. Empty ⇒ renders nothing. */
  children?: React.ReactNode;
  /** Accessible name, e.g. `What does Impact mean?`. */
  label?: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

/**
 * The ⓘ "what does this mean?" help icon placed beside a label, heading, KPI or column
 * header. Opens on hover / keyboard focus, and on click / tap (Radix tooltips otherwise
 * never open on touch; a tap outside or Esc closes it). Clicks and Enter/Space are
 * swallowed so an InfoTip
 * inside a clickable tile, sortable header or `<label>` never triggers its parent.
 *
 * Replaces the five hand-rolled copies that used to live in the create form, ticket
 * detail, portal field display, email-notification form and role-permissions editor.
 */
export function InfoTip({ children, label = "More information", side = "top", className }: InfoTipProps) {
  const [open, setOpen] = React.useState(false);
  if (children === null || children === undefined || children === "" || children === false) return null;
  const swallow = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            // 14px icon + 5px padding = a 24px hit target (WCAG 2.5.8); the matching
            // negative margin keeps the visual footprint at 14px.
            "-m-[5px] inline-flex shrink-0 cursor-help items-center rounded-sm p-[5px] align-middle text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
          onClick={(e) => {
            swallow(e);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              swallow(e);
              setOpen(true);
            }
          }}
          // preventDefault skips Radix's "close on pointerdown", so a tap opens it.
          onPointerDown={swallow}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>{children}</TooltipContent>
    </Tooltip>
  );
}
