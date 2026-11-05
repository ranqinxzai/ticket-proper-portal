"use client";

import { Store } from "lucide-react";

import { AssetMasterList, type MasterConfig } from "@/components/assets/asset-master-list";
import { AssetSettingsPage } from "@/components/assets/asset-settings-gate";
import { vendorsApi } from "@/lib/itsm/assets-api";
import type { Vendor } from "@/lib/itsm/assets-types";

// Module-level so its identity is stable (the edit sheet resets on config change).
const VENDOR_CONFIG: MasterConfig<Vendor> = {
  noun: "vendor",
  icon: Store,
  api: vendorsApi,
  fields: [
    { key: "contact_person", label: "Contact person", maxLength: 150 },
    { key: "email", label: "Email", kind: "email", maxLength: 254 },
    { key: "phone", label: "Phone", kind: "tel", maxLength: 40 },
    { key: "website", label: "Website", placeholder: "https://", maxLength: 200 },
    { key: "address", label: "Address", kind: "textarea" },
    { key: "notes", label: "Notes", kind: "textarea" },
  ],
  columns: [
    { key: "contact_person", label: "Contact" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
  ],
};

export default function AssetVendorsSettingsPage() {
  return (
    <AssetSettingsPage title="Vendors" description="Who supplies your assets." shared>
      {(perms) => <AssetMasterList config={VENDOR_CONFIG} perms={perms} />}
    </AssetSettingsPage>
  );
}
