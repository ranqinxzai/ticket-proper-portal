"use client";

import { MapPin } from "lucide-react";

import { AssetMasterList, type MasterConfig } from "@/components/assets/asset-master-list";
import { AssetSettingsPage } from "@/components/assets/asset-settings-gate";
import { locationsApi } from "@/lib/itsm/assets-api";
import type { Location } from "@/lib/itsm/assets-types";

// Module-level so its identity is stable (the edit sheet resets on config change).
const LOCATION_CONFIG: MasterConfig<Location> = {
  noun: "location",
  icon: MapPin,
  api: locationsApi,
  fields: [
    { key: "code", label: "Code", placeholder: "e.g. BLR-HQ", maxLength: 30 },
    { key: "address", label: "Address", kind: "textarea" },
  ],
  columns: [
    { key: "code", label: "Code" },
    { key: "address", label: "Address" },
  ],
};

export default function AssetLocationsSettingsPage() {
  return (
    <AssetSettingsPage title="Locations" description="Where your assets are: offices, sites, rooms." shared>
      {(perms) => <AssetMasterList config={LOCATION_CONFIG} perms={perms} />}
    </AssetSettingsPage>
  );
}
