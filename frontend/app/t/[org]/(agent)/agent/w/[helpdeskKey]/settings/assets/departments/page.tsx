"use client";

import { Building2 } from "lucide-react";

import { AssetMasterList, type MasterConfig } from "@/components/assets/asset-master-list";
import { AssetSettingsPage } from "@/components/assets/asset-settings-gate";
import { departmentsApi } from "@/lib/itsm/assets-api";
import type { Department } from "@/lib/itsm/assets-types";

// Module-level so its identity is stable (the edit sheet resets on config change).
const DEPARTMENT_CONFIG: MasterConfig<Department> = {
  noun: "department",
  icon: Building2,
  api: departmentsApi,
  fields: [{ key: "code", label: "Code", placeholder: "e.g. FIN", maxLength: 30 }],
  columns: [{ key: "code", label: "Code" }],
};

export default function AssetDepartmentsSettingsPage() {
  return (
    <AssetSettingsPage
      title="Departments"
      description="Departments an asset can be allotted to. Separate from the free-text Department user attribute."
      shared
    >
      {(perms) => <AssetMasterList config={DEPARTMENT_CONFIG} perms={perms} />}
    </AssetSettingsPage>
  );
}
