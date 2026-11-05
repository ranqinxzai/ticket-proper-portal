"use client";

import { useMemo } from "react";

import { useItsmAuth } from "./auth";

/** RBAC module codes of Asset Management v1 (`backend/apps/itsm_assets/permissions.py`).
 *  `hasPerm` is exact-key, so each module is checked by its own code. */
export const ASSETS_MODULE = "itsm.assets";
export const ASSET_IMPORT_MODULE = "itsm.assets.import";
export const ASSET_CONFIG_MODULE = "itsm.assets.config";

export type AssetPerms = {
  /** See the Assets section (dashboard, list, report, asset detail). */
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  /** Run an Excel import (and download the template). */
  importRun: boolean;
  /** See import history and an import's failed records. */
  importHistory: boolean;
  /** Asset Configuration (categories, fields, statuses, vendors, locations, departments). */
  configRead: boolean;
  configCreate: boolean;
  configUpdate: boolean;
  configDelete: boolean;
};

/** The current user's asset permissions, memoised per user. */
export function useAssetPerms(): AssetPerms {
  const { hasPerm } = useItsmAuth();
  return useMemo(
    () => ({
      read: hasPerm(ASSETS_MODULE, "read"),
      create: hasPerm(ASSETS_MODULE, "create"),
      update: hasPerm(ASSETS_MODULE, "update"),
      delete: hasPerm(ASSETS_MODULE, "delete"),
      importRun: hasPerm(ASSET_IMPORT_MODULE, "create"),
      importHistory: hasPerm(ASSET_IMPORT_MODULE, "read"),
      configRead: hasPerm(ASSET_CONFIG_MODULE, "read"),
      configCreate: hasPerm(ASSET_CONFIG_MODULE, "create"),
      configUpdate: hasPerm(ASSET_CONFIG_MODULE, "update"),
      configDelete: hasPerm(ASSET_CONFIG_MODULE, "delete"),
    }),
    [hasPerm],
  );
}
