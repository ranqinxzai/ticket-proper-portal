/**
 * Path-based multi-tenancy URL builders.
 *
 * Every org (tenant) lives under a `/t/<org>` path segment. These pure helpers
 * keep the prefix in one place so in-app links stay within the current org.
 */

import type { ItsmUser } from "./types";

/** A user belongs in the agent app if they are a superuser, a member of any
 * helpdesk, or hold a non-requestor ITSM role. Pure requestors go to the portal. */
export function isAgentUser(user: ItsmUser | null): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  if (user.role?.code === "requestor") return false;
  if ((user.helpdesks?.length ?? 0) > 0) return true;
  return Boolean(user.role);
}

/** True if the user can actually enter a helpdesk workspace: a superuser (sees all
 * helpdesks) or a member of at least one. A roled agent/lead/admin with zero helpdesk
 * memberships is NOT granted access — the agent app shows a "contact admin" screen
 * instead of the menu/workspace. Distinct from `isAgentUser` (which only decides
 * agent-vs-portal routing); this is the membership gate inside the agent app. */
export function hasHelpdeskAccess(user: ItsmUser | null): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  return (user.helpdesks?.length ?? 0) > 0;
}

/** Root of an org's app. */
export const orgRoot = (org: string) => `/t/${org}`;

/** Org sign-in page. */
export const orgLogin = (org: string) => `/t/${org}/login`;

/** Agent app home (helpdesk selector). */
export const agentHome = (org: string) => `/t/${org}/agent`;

/** End-user service portal home. */
export const portalHome = (org: string) => `/t/${org}/portal`;

/** Base path of a helpdesk workspace. */
export const workspaceBase = (org: string, helpdeskKey: string) =>
  `/t/${org}/agent/w/${helpdeskKey}`;

/** Tenant Settings hub (org-wide admin: users, roles, helpdesks). */
export const adminHome = (org: string) => `/t/${org}/agent/admin`;

/** Central helpdesk administration. */
export const adminHelpdesks = (org: string) => `/t/${org}/agent/admin/helpdesks`;

/** Org-wide user management (admin). */
export const adminUsers = (org: string) => `/t/${org}/agent/admin/users`;

/** Org-wide roles & permissions (admin). */
export const adminRoles = (org: string) => `/t/${org}/agent/admin/roles`;

/** Org-wide authentication & SSO settings (admin). */
export const adminSso = (org: string) => `/t/${org}/agent/admin/sso`;

/** Pending-approvals inbox (agent app). */
export const agentApprovals = (org: string) => `/t/${org}/agent/approvals`;

/** Knowledge Base management — workspace index. */
export const agentKb = (org: string) => `/t/${org}/agent/kb`;

/** Sentinel `[helpdeskKey]` for organisation-wide (no-helpdesk) KB content. */
export const KB_ORG_KEY = "_org";

/** Knowledge Base management for one workspace (or `KB_ORG_KEY` for org-wide). */
export const agentKbWorkspace = (org: string, helpdeskKey: string) =>
  `/t/${org}/agent/kb/${helpdeskKey}`;

/** Where this user should land after login, within their org. */
export function homePathFor(user: ItsmUser | null, org: string): string {
  return isAgentUser(user) ? agentHome(org) : portalHome(org);
}
