import { cn } from "@/lib/utils";

/**
 * Placeholder shimmer for loading states. Compose several to build skeleton
 * rows/cards while data is in flight (queues, dashboards, detail panels).
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
