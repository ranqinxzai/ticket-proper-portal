import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/** A search box never gets spell-check underlines (search terms, ticket numbers);
 *  callers mark prose fields with `spellCheck` themselves (2026-11-05c). */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, spellCheck, ...props }, ref) => (
    <input
      type={type}
      spellCheck={spellCheck ?? (type === "search" ? false : undefined)}
      className={cn(
        "flex h-[var(--ctl-h)] w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
