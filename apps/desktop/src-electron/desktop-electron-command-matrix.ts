export const DESKTOP_ELECTRON_PRODUCT_CONTROL_CALLER_KIND = 'desktop-core';
export const DESKTOP_ELECTRON_PRODUCT_CONTROL_CALLER_ID = 'desktop.product-control';
export const DESKTOP_ELECTRON_PRODUCT_CONTROL_SURFACE_ID = 'desktop.product-control';

export const DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS = [
  '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord',
  '/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot',
  '/nimi.runtime.v1.RuntimeLocalService/EnsureProductControlRecordCreated',
  '/nimi.runtime.v1.RuntimeLocalService/SelectProductControlDataRoot',
  '/nimi.runtime.v1.RuntimeLocalService/SetProductControlFirstRunInstallLevel',
  '/nimi.runtime.v1.RuntimeLocalService/CompleteProductControlFirstRunDeviceEnvironmentScan',
  '/nimi.runtime.v1.RuntimeLocalService/ReconcileProductControlFirstRunSetupState',
] as const;

export const DESKTOP_ELECTRON_INTENTIONAL_TAURI_ONLY_COMMANDS = [
  'product_control_pick_data_root_directory',
  'product_control_default_data_root_directory',
  'product_control_record_ensure_account_default_profile',
  'product_control_record_prepare_first_run_local_ai_ready',
  'product_control_record_admit_ready_for_use',
] as const;
