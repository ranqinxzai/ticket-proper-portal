"use client";

/**
 * Who can see a canned response — as the composer picker groups it and the badge shows.
 * Derived from the model: `scope` (personal | workspace | project) + the label FKs
 * (`helpdesk`, `project`). A workspace note with no helpdesk is organisation-wide.
 */

import { Building2, FolderKanban, Globe2, User } from "lucide-react";

import type { CannedNote } from "@/lib/itsm/types";
import { Hint } from "@/components/ui/hint";
import { CANNED_SCOPE_HELP } from "@/lib/itsm/help/ticket";
import { cn } from "@/lib/utils";

export type CannedScopeGroup = "personal" | "project" | "helpdesk" | "organisation";

/** Picker group order: your own first, then the narrowest shared scope outwards. */
export const CANNED_SCOPE_ORDER: CannedScopeGroup[] = ["personal", "project", "helpdesk", "organisation"];

export const CANNED_SCOPE_TITLE: Record<CannedScopeGroup, string> = {
  personal: "Personal",
  project: "Project",
  helpdesk: "Helpdesk",
  organisation: "Organisation",
};

export function cannedScopeOf(note: CannedNote): CannedScopeGroup {
  if (note.scope === "personal" || !note.is_shared) return "personal";
  if (note.scope === "project") return "project";
  return note.helpdesk ? "helpdesk" : "organisation";
}

/** Badge text (specific name where the model has one) + hover explanation. */
export function cannedScopeInfo(note: CannedNote): { group: CannedScopeGroup; label: string; help: string } {
  const group = cannedScopeOf(note);
  switch (group) {
    case "personal":
      return { group, label: "Personal", help: CANNED_SCOPE_HELP.personal };
    case "project": {
      const name = note.project_name || "this";
      return { group, label: note.project_name || "Project", help: CANNED_SCOPE_HELP.project(name) };
    }
    case "helpdesk": {
      const name = note.helpdesk_name || "this";
      return { group, label: note.helpdesk_name || "Helpdesk", help: CANNED_SCOPE_HELP.helpdesk(name) };
    }
    default:
      return { group, label: "Organisation", help: CANNED_SCOPE_HELP.organisation };
  }
}

const ICONS: Record<CannedScopeGroup, typeof User> = {
  personal: User,
  project: FolderKanban,
  helpdesk: Building2,
  organisation: Globe2,
};

const TONES: Record<CannedScopeGroup, string> = {
  personal: "border-amber-300/60 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  project: "border-sky-300/60 bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300",
  helpdesk: "border-border bg-muted text-muted-foreground",
  organisation: "border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
};

/** Small scope chip with a hover explanation of who can see the response. */
export function CannedScopeBadge({ note, className }: { note: CannedNote; className?: string }) {
  const info = cannedScopeInfo(note);
  const Icon = ICONS[info.group];
  return (
    <Hint label={info.help} wrap>
      <span
        className={cn(
          "inline-flex max-w-[9rem] items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium",
          TONES[info.group],
          className,
        )}
      >
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{info.label}</span>
      </span>
    </Hint>
  );
}
