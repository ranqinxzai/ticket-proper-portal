"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { useUi } from "@/components/theme/density-provider";
import { InfoTip } from "@/components/ui/info-tip";
import { useMediaQuery } from "@/lib/itsm/use-media-query";
import { cn } from "@/lib/utils";
import { useHeaderSlot } from "./header-slot";

/**
 * Consistent page header used across agent/admin/portal routes: optional
 * breadcrumb slot, a title + supporting description, and right-aligned actions.
 * Spacious by design to match the commercial (Zendesk/Intercom-style) look; in the
 * agent app's Compact density it tightens (smaller title, less space below).
 *
 * Modern interface (2026-11-05, step B2): on desktop inside the agent app the title
 * and actions render INTO the top bar (`HeaderSlotProvider` outlets) — one bar, no
 * band above the content. The description becomes an ⓘ beside the title, or stays
 * as short text when `descriptionInline` is set (live status such as "Showing 1–25
 * of 120"). `breadcrumb` (back links) stays in the page. Classic, the portal, the
 * console and narrow screens keep the inline header below, unchanged.
 */
interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Modern top bar only: show the description as text beside the title instead of
   *  an ⓘ (for live status lines). No effect on the inline header. */
  descriptionInline?: boolean;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
}

const InlinePageHeader = React.forwardRef<HTMLDivElement, Omit<PageHeaderProps, "descriptionInline">>(
  ({ title, description, breadcrumb, actions, className, ...props }, ref) => (
    <div ref={ref} className={cn("mb-6 flex flex-col gap-3 compact:mb-4 compact:gap-2", className)} {...props}>
      {breadcrumb ? <div className="min-h-5">{breadcrumb}</div> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground compact:text-xl">{title}</h1>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  ),
);
InlinePageHeader.displayName = "InlinePageHeader";

function TeleportedPageHeader({
  titleEl,
  actionsEl,
  setTitle,
  title,
  description,
  descriptionInline,
  breadcrumb,
  actions,
}: {
  titleEl: HTMLElement;
  actionsEl: HTMLElement | null;
  setTitle: (has: boolean, text: string | null) => void;
} & Pick<PageHeaderProps, "title" | "description" | "descriptionInline" | "breadcrumb" | "actions">) {
  const titleText = typeof title === "string" ? title : null;
  React.useEffect(() => {
    setTitle(true, titleText);
    return () => setTitle(false, null);
  }, [setTitle, titleText]);

  return (
    <>
      {createPortal(
        <h1 className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold tracking-tight text-foreground">
          <span className="truncate">{title}</span>
          {description && !descriptionInline ? (
            <InfoTip label="About this page" side="bottom">
              {description}
            </InfoTip>
          ) : null}
          {description && descriptionInline ? (
            <span className="truncate text-xs font-normal text-muted-foreground">{description}</span>
          ) : null}
        </h1>,
        titleEl,
      )}
      {actions && actionsEl ? createPortal(<>{actions}</>, actionsEl) : null}
      {breadcrumb ? <div className="mb-3 min-h-5">{breadcrumb}</div> : null}
    </>
  );
}

const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ descriptionInline, ...props }, ref) => {
    const slot = useHeaderSlot();
    const { ui } = useUi();
    const desktop = useMediaQuery("(min-width: 1024px)");
    if (ui === "modern" && desktop && slot?.titleEl) {
      return (
        <TeleportedPageHeader
          titleEl={slot.titleEl}
          actionsEl={slot.actionsEl}
          setTitle={slot.setTitle}
          title={props.title}
          description={props.description}
          descriptionInline={descriptionInline}
          breadcrumb={props.breadcrumb}
          actions={props.actions}
        />
      );
    }
    return <InlinePageHeader ref={ref} {...props} />;
  },
);
PageHeader.displayName = "PageHeader";

export { PageHeader };
