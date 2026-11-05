import type { ReactNode } from "react";

import { InfoTip } from "@/components/ui/info-tip";
import { Label } from "@/components/ui/label";

/** Label + control + inline field error, the standard settings-form row.
 * Pass `error` from an ItsmApiError.fieldErrors[name]?.[0] to surface 400s inline.
 * `info` renders an ⓘ hover-help icon beside the label (`hint` is always-visible text). */
export function FieldRow({
  label,
  htmlFor,
  error,
  hint,
  info,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  hint?: ReactNode;
  info?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
        {info ? (
          <InfoTip label={`About ${label}`} className="ml-[-1px]">
            {info}
          </InfoTip>
        ) : null}
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
