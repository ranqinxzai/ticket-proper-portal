"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Project } from "@/lib/itsm/types";
import { ALL_PROJECTS, maxToDate } from "./catalog";

/** Project + From–To date-range filters shared by the reports detail page.
 * Project is the primary, first-class filter (default "All projects"); the range
 * defaults to the current month and is capped at 6 months (enforced by the
 * caller via `rangeError`; the To input also offers a `max` hint to the picker). */
export function ReportFilters({
  projects,
  projectId,
  onProject,
  from,
  to,
  onFrom,
  onTo,
}: {
  projects: Project[];
  projectId: string;
  onProject: (v: string) => void;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={projectId} onValueChange={onProject}>
        <SelectTrigger className="w-[180px]" aria-label="Project">
          <SelectValue placeholder="All projects" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          aria-label="From date"
          value={from}
          max={to || undefined}
          onChange={(e) => onFrom(e.target.value)}
          className="w-[150px]"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="date"
          aria-label="To date"
          value={to}
          min={from || undefined}
          max={maxToDate(from) || undefined}
          onChange={(e) => onTo(e.target.value)}
          className="w-[150px]"
        />
      </div>
    </div>
  );
}
