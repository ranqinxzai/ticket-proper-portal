"use client";

import { useWorkspace } from "@/components/agent/workspace/workspace-provider";
import { AssetSettingsPage } from "@/components/assets/asset-settings-gate";
import { CategoryTreeEditor } from "@/components/assets/category-tree-editor";

export default function AssetCategoriesSettingsPage() {
  const { helpdesk } = useWorkspace();
  return (
    <AssetSettingsPage
      title="Categories & Fields"
      description={`Asset categories of ${helpdesk?.name ?? "this helpdesk"} (two levels) and the detail fields each one adds to the asset form.`}
    >
      {(perms) => (helpdesk ? <CategoryTreeEditor helpdeskId={helpdesk.id} perms={perms} /> : null)}
    </AssetSettingsPage>
  );
}
