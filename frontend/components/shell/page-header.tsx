import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Consistent page header used across agent/admin/portal routes: optional
 * breadcrumb slot, a title + supporting description, and right-aligned actions.
 * Spacious by design to match the commercial (Zendesk/Intercom-style) look.
 */
interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
}

const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ title, description, breadcrumb, actions, className, ...props }, ref) => (
    <div ref={ref} className={cn("mb-6 flex flex-col gap-3", className)} {...props}>
      {breadcrumb ? <div className="min-h-5">{breadcrumb}</div> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  ),
);
PageHeader.displayName = "PageHeader";

export { PageHeader };
