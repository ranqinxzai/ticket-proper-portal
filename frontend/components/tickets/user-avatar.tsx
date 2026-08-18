import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { UserRef } from "@/lib/itsm/types";

type Person = Pick<UserRef, "full_name" | "username" | "email">;

const SIZES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-11 w-11 text-sm",
} as const;

export type AvatarSize = keyof typeof SIZES;

/** Up-to-two-letter initials from a person's display name. */
export function initialsOf(user?: Person | null): string {
  const src = user?.full_name?.trim() || user?.username?.trim() || user?.email?.trim() || "";
  if (!src) return "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

/** Gradient-initials avatar (primary → chart-4 violet). Themed via tokens, so it
 *  reads on both light and dark grounds. Decorative — the name is the label. */
export function UserAvatar({
  user,
  size = "md",
  className,
}: {
  user?: Person | null;
  size?: AvatarSize;
  className?: string;
}) {
  const empty = !user;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none",
        SIZES[size],
        empty
          ? "border border-dashed border-border bg-muted text-muted-foreground"
          : "bg-gradient-to-br from-primary to-chart-4 text-white shadow-soft",
        className,
      )}
    >
      {empty ? "–" : initialsOf(user)}
    </span>
  );
}

/** Avatar + name (+ optional muted email) — the standard people chip used for
 *  requestors, assignees, comment authors and watchers. */
export function PersonChip({
  user,
  fallback = "Unassigned",
  size = "sm",
  showEmail = true,
  className,
}: {
  user?: UserRef | null;
  fallback?: ReactNode;
  size?: AvatarSize;
  showEmail?: boolean;
  className?: string;
}) {
  if (!user) {
    return (
      <span className={cn("inline-flex items-center gap-2 text-muted-foreground", className)}>
        <UserAvatar user={null} size={size} />
        <span className="text-sm">{fallback}</span>
      </span>
    );
  }
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <UserAvatar user={user} size={size} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium leading-tight">{user.full_name || user.username}</span>
        {showEmail && user.email ? (
          <span className="truncate text-xs leading-tight text-muted-foreground">{user.email}</span>
        ) : null}
      </span>
    </span>
  );
}
