"use client";

import type { ReactNode } from "react";
import { Info, Lock } from "lucide-react";

import { ReadOnlyBanner } from "@/components/settings/read-only-banner";
import { SettingsSection } from "@/components/settings/settings-section";
import { EmptyState } from "@/components/shell/empty-state";
import { useAssetPerms } from "@/lib/itsm/asset-perms";

import type { ConfigPerms } from "./category-tree-editor";

/** Shell of an Asset Configuration settings page: the `itsm.assets.config` read gate,
 *  the read-only banner (no Update) and, for org-wide lists, the "shared" note. */
export function AssetSettingsPage({
  title,
  description,
  shared,
  children,
}: {
  title: string;
  description: string;
  /** Org-wide list (statuses, vendors, locations, departments). */
  shared?: boolean;
  children: (perms: ConfigPerms) => ReactNode;
}) {
  const p = useAssetPerms();
  if (!p.configRead) {
    return (
      <SettingsSection title={title} description={description}>
        <EmptyState
          icon={Lock}
          title="You don't have access to Asset Configuration"
          description="Your role doesn't include Asset Configuration → Read. Ask an administrator if you need it."
        />
      </SettingsSection>
    );
  }
  const perms: ConfigPerms = { create: p.configCreate, update: p.configUpdate, delete: p.configDelete };
  return (
    <SettingsSection title={title} description={description}>
      {!p.configUpdate ? <ReadOnlyBanner /> : null}
      {shared ? (
        <div className="flex items-start gap-2 rounded-lg border bg-primary/5 px-4 py-2.5 text-sm text-primary-ink">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium">Shared by all helpdesks.</span> Changes here show up in every
            helpdesk&apos;s asset forms, filters and imports.
          </span>
        </div>
      ) : null}
      {children(perms)}
    </SettingsSection>
  );
}
