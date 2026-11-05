"use client";

import { AssetSettingsPage } from "@/components/assets/asset-settings-gate";
import { AssetStatusesEditor } from "@/components/assets/asset-statuses-editor";

export default function AssetStatusesSettingsPage() {
  return (
    <AssetSettingsPage
      title="Asset Statuses"
      description="The statuses an asset can have. Each maps to a state type that drives filters, the dashboard and the expiry rules."
      shared
    >
      {(perms) => <AssetStatusesEditor perms={perms} />}
    </AssetSettingsPage>
  );
}
