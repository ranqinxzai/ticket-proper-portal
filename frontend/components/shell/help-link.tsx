"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { CircleHelp } from "lucide-react";

import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/hint";
import { helpHome } from "@/lib/itsm/nav";

/** Header "?" button → the agent Help Center. The account menu carries the same
 * link, so headers short on room (mobile workspace bar) can hide this one. */
export function HelpLink({ className }: { className?: string }) {
  const { org = "" } = useParams<{ org: string }>();
  const pathname = usePathname();
  const href = helpHome(org);
  return (
    <Hint label="Help Center — guides and FAQ" side="bottom">
      <Link
        href={href}
        aria-label="Help Center"
        aria-current={pathname.startsWith(href) ? "page" : undefined}
        className={cn(
          "grid h-[var(--ctl-h)] w-[var(--ctl-h)] place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground",
          className,
        )}
      >
        <CircleHelp className="h-5 w-5" aria-hidden="true" />
      </Link>
    </Hint>
  );
}
