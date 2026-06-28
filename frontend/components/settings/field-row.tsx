import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";

/** Label + control + inline field error, the standard settings-form row.
 * Pass `error` from an ItsmApiError.fieldErrors[name]?.[0] to surface 400s inline. */
export function FieldRow({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

/** Pull the first error string for `name` from an ItsmApiError-style bag. */
export function fieldError(
  bag: Record<string, string[]> | undefined,
  name: string,
): string | undefined {
  return bag?.[name]?.[0];
}
