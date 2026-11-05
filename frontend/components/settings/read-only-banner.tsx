import { Eye } from "lucide-react";

import { cn } from "@/lib/utils";

/** Shown atop a settings sub-page when the user lacks the write permission for it.
 * The backend enforces independently — this is a UX affordance only. */
export function ReadOnlyBanner({ message, className }: { message?: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground",
        className,
      )}
    >
      <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message ?? "You have view-only access to this section."}</span>
    </div>
  );
}
