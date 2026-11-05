"use client";

import * as React from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";

export interface IconButtonProps extends Omit<ButtonProps, "aria-label"> {
  /** What the button does — becomes BOTH the accessible name and the hover tooltip. */
  label: string;
  /** Shown instead of `label` while the button is disabled ("why can't I click this?"). */
  disabledReason?: string;
  /** Extra tooltip text after the label (e.g. "Deletes immediately"). */
  detail?: string;
  side?: "top" | "right" | "bottom" | "left";
}

/**
 * An icon-only button that always explains itself on hover / focus. Use this instead of
 * `<Button size="icon" aria-label=…>` — an aria-label alone gives sighted users nothing.
 * Forwards its ref, so it works as a `PopoverTrigger` / `DropdownMenuTrigger` child.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, disabledReason, detail, side, variant = "ghost", size = "icon", type = "button", ...props }, ref) => {
    const tip = props.disabled && disabledReason ? disabledReason : detail ? `${label}\n${detail}` : label;
    return (
      <Hint label={tip} side={side}>
        <Button ref={ref} type={type} variant={variant} size={size} aria-label={label} {...props} />
      </Hint>
    );
  },
);
IconButton.displayName = "IconButton";
