/**
 * Icon registry — maps the seeded kebab-case lucide icon names stored on
 * `Helpdesk.icon` / `Project.icon` (e.g. "monitor", "users", "building-2",
 * "alert-triangle", "inbox") to real lucide-react components.
 *
 * The backend seeds (each app's seed.py) write lucide icon names; the frontend
 * resolves them here. A static registry keeps it tree-shakeable
 * (no dynamic import) and gives every unknown/blank value a sensible fallback.
 */

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Briefcase,
  Building2,
  ClipboardList,
  FolderKanban,
  Headset,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Monitor,
  Plane,
  ShieldAlert,
  Users,
  Wrench,
} from "lucide-react";

/** Seeded names + a few common extras for future helpdesks/projects. */
const REGISTRY: Record<string, LucideIcon> = {
  // seeded helpdesk icons
  monitor: Monitor,
  users: Users,
  "building-2": Building2,
  // seeded project icons
  "alert-triangle": AlertTriangle,
  inbox: Inbox,
  // common extras
  headset: Headset,
  briefcase: Briefcase,
  wrench: Wrench,
  plane: Plane,
  "life-buoy": LifeBuoy,
  "folder-kanban": FolderKanban,
  "shield-alert": ShieldAlert,
  "clipboard-list": ClipboardList,
  "layout-dashboard": LayoutDashboard,
};

/** All registered icon names, for the settings icon picker. */
export const ITSM_ICON_NAMES: string[] = Object.keys(REGISTRY);

/** Resolve a stored icon name to a lucide component, falling back when blank/unknown. */
export function resolveItsmIcon(
  name?: string | null,
  fallback: LucideIcon = LifeBuoy,
): LucideIcon {
  if (!name) return fallback;
  return REGISTRY[name.trim().toLowerCase()] ?? fallback;
}

/** Render a helpdesk/project icon by its stored name. Decorative by default. */
export function ItsmIcon({
  name,
  fallback,
  className,
}: {
  name?: string | null;
  fallback?: LucideIcon;
  className?: string;
}) {
  const Icon = resolveItsmIcon(name, fallback ?? LifeBuoy);
  return <Icon className={className} aria-hidden="true" />;
}
