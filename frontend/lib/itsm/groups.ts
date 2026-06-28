import type { Group, Project } from "./types";

/** Filter the helpdesk's groups down to the ones assignable on `project`.
 *
 * An empty `project.allowed_group_ids` means **no restriction** — every group is
 * returned (the default). When a whitelist is set, only those groups are kept,
 * plus any ids in `keep` (e.g. the project default group, or the ticket's current
 * group) so an existing/landing assignment is never dropped from the picker. The
 * server enforces the same rule on write — this is a UX affordance. */
export function allowedGroupsForProject(
  groups: Group[],
  project: Pick<Project, "allowed_group_ids" | "default_group">,
  keep: (string | null | undefined)[] = [],
): Group[] {
  const ids = project.allowed_group_ids ?? [];
  if (ids.length === 0) return groups;
  const allow = new Set<string>(ids);
  for (const k of [project.default_group, ...keep]) if (k) allow.add(k);
  return groups.filter((g) => allow.has(g.id));
}
