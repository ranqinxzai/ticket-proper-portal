"use client";

import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { AssetBackLink } from "@/components/assets/asset-back-link";
import { AssetForm } from "@/components/assets/asset-form";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { useAssetPerms } from "@/lib/itsm/asset-perms";

export default function NewAssetPage() {
  const { org, helpdeskKey, helpdesk } = useWorkspace();
  const perms = useAssetPerms();
  const router = useRouter();
  const base = `/t/${org}/agent/w/${helpdeskKey}`;

  if (!perms.create) {
    return (
      <EmptyState
        icon={Lock}
        title="You can't add assets"
        description="Your role doesn't include Assets → Create. Ask an administrator if you need it."
      />
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumb={<AssetBackLink href={`${base}/assets/list`} label="Asset List" />}
        title="New asset"
        description={`Add an asset to ${helpdesk?.name ?? "this helpdesk"}. Fields marked * are required.`}
      />
      <AssetForm base={base} onSaved={(a) => router.push(`${base}/assets/list/${a.id}`)} />
    </div>
  );
}
