"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Side = "top" | "right" | "bottom" | "left";
type Align = "start" | "center" | "end";

export interface HintProps {
  /** Tooltip text. Empty / null ⇒ the child renders unchanged (no tooltip). */
  label?: React.ReactNode;
  side?: Side;
  align?: Align;
  /** The trigger element. It must forward its ref and spread props (Button, `<button>`,
   *  `<a>`, `<span>` … all do). For a component that doesn't, pass `wrap`. */
  children: React.ReactElement;
  /** Wrap the child in an inline `<span>` and use that as the trigger — for display-only
   *  components (badges, bars) that don't forward a ref. Hover-only: not a tab stop. */
  wrap?: boolean;
  className?: string;
  contentClassName?: string;
  /** Keep the tooltip mounted but never open it (e.g. a rail item whose label is
   *  already visible). Unlike an empty `label`, this keeps the element tree stable,
   *  so a focused child is not remounted. */
  disabled?: boolean;
  /** Hover delay before opening, in ms (default: the provider's 150). A rich preview
   *  card uses a longer one so moving across rows doesn't flash cards. */
  delayDuration?: number;
}

/**
 * Passes the tooltip trigger's props (handlers, ref, aria-describedby) through to the
 * child EXCEPT `data-state`. Radix tooltip triggers stamp `data-state="closed|delayed-open"`,
 * and a Radix child (Switch, Checkbox, Select / Popover / DropdownMenu / Sheet / Tabs
 * trigger) spreads incoming props AFTER its own `data-state` — so without this a checked
 * Switch would render unchecked and an open popover trigger would lose its open styling.
 */
const KeepChildState = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement> & { children: React.ReactNode }>(
  ({ children, ...props }, ref) => {
    const rest: Record<string, unknown> = { ...props };
    delete rest["data-state"];
    return (
      <Slot ref={ref} {...rest}>
        {children}
      </Slot>
    );
  },
);
KeepChildState.displayName = "KeepChildState";

/**
 * Hover / focus help for one control — the app-wide tooltip primitive. See
 * docs/QA_CHECKLIST.md "Hover help / tooltips".
 *
 * A **disabled** child is wrapped in a focusable `<span>` that becomes the trigger:
 * disabled buttons fire no pointer events (`disabled:pointer-events-none` in ui/button,
 * native `disabled`), so a tooltip placed on them never opens — exactly when the user
 * most needs the "why is this disabled" text.
 *
 * Must stay module-level (React component-stability rule).
 */
export function Hint({
  label,
  side = "top",
  align,
  children,
  wrap,
  className,
  contentClassName,
  disabled: off,
  delayDuration,
}: HintProps) {
  if (label === null || label === undefined || label === "" || label === false) return children;
  const childProps = (React.isValidElement(children) ? children.props : {}) as { disabled?: boolean };
  const disabled = !!childProps.disabled;
  const trigger =
    disabled || wrap ? (
      <span
        tabIndex={disabled ? 0 : undefined}
        className={cn("inline-flex max-w-full", disabled && "cursor-not-allowed", className)}
      >
        {children}
      </span>
    ) : (
      children
    );
  return (
    <Tooltip open={off ? false : undefined} delayDuration={delayDuration}>
      <TooltipTrigger asChild>
        <KeepChildState>{trigger}</KeepChildState>
      </TooltipTrigger>
      <TooltipContent side={side} align={align} className={contentClassName}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
