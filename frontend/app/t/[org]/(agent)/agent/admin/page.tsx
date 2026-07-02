"use client";

import { Building2, KeyRound, Lock, ShieldCheck, UserCog } from "lucide-react";

import { useItsmAuth } from "@/lib/itsm/auth";
import { adminHelpdesks, adminRoles, adminSso, adminUsers } from "@/lib/itsm/nav";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { SettingsCategory, type SettingCardDef } from "@/components/settings/settings-card-grid";

/** Tenant Settings landing — what the Home gear opens. A card grid mirroring the
 *  left-rail nav; each card drills into an org-wide admin surface. */
export default function TenantSettingsHome() {
  const { org, hasPerm, isSupervisor } = useItsmAuth();
  const canRoles = isSupervisor || hasPerm("itsm.admin.roles", "read");
  const canSso = isSupervisor || hasPerm("itsm.admin.sso", "read");
  const canHelpdesks =
    isSupervisor ||
    hasPerm("itsm.admin.helpdesks", "read") ||
    hasPerm("itsm.admin.helpdesks", "update") ||
    hasPerm("itsm.admin.helpdesks", "create");

  const accessCards: SettingCardDef[] = [];
  if (canRoles) {
    accessCards.push({
      title: "Users",
      description: "Add people, set their role & helpdesks, reset passwords.",
      href: adminUsers(org),
      icon: UserCog,
    });
    accessCards.push({
      title: "Roles & Permissions",
      description: "Control what each role can do across the platform.",
      href: adminRoles(org),
      icon: ShieldCheck,
    });
  }
  if (canSso) {
    accessCards.push({
      title: "Authentication & SSO",
      description: "Let users sign in with Microsoft (Entra) using your own app.",
      href: adminSso(org),
      icon: KeyRound,
    });
  }
  const workspaceCards: SettingCardDef[] = [];
  if (canHelpdesks) {
    workspaceCards.push({
      title: "Helpdesks",
      description: "Create, enable and order your helpdesks.",
      href: adminHelpdesks(org),
      icon: Building2,
    });
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Tenant Settings"
        description="Organisation-wide configuration, shared across every helpdesk."
      />
      {accessCards.length ? <SettingsCategory title="Access Control" cards={accessCards} /> : null}
      {workspaceCards.length ? <SettingsCategory title="Workspaces" cards={workspaceCards} /> : null}
      {!accessCards.length && !workspaceCards.length ? (
        <EmptyState
          icon={Lock}
          title="No tenant settings available"
          description="You don't have access to any tenant settings."
        />
      ) : null}
    </div>
  );
}
