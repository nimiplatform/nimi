export const DESKTOP_ELECTRON_PRODUCT_CONTROL_CALLER_KIND = 'desktop-core';
export const DESKTOP_ELECTRON_PRODUCT_CONTROL_CALLER_ID = 'desktop.product-control';
export const DESKTOP_ELECTRON_PRODUCT_CONTROL_SURFACE_ID = 'desktop.product-control';

export type DesktopElectronCommandMatrixStatus =
  | 'standard-shell-covered'
  | 'electron-covered'
  | 'intentional-tauri-only'
  | 'electron-deferred'
  | 'electron-na';

export type DesktopElectronCommandMatrixEntry = {
  command: string;
  status: DesktopElectronCommandMatrixStatus;
  reason: string;
};

export const DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_METHOD_IDS = [
  '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord',
  '/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot',
  '/nimi.runtime.v1.RuntimeLocalService/EnsureProductControlRecordCreated',
  '/nimi.runtime.v1.RuntimeLocalService/SelectProductControlDataRoot',
  '/nimi.runtime.v1.RuntimeLocalService/SetProductControlFirstRunInstallLevel',
  '/nimi.runtime.v1.RuntimeLocalService/CompleteProductControlFirstRunDeviceEnvironmentScan',
  '/nimi.runtime.v1.RuntimeLocalService/ReconcileProductControlFirstRunSetupState',
] as const;

export const DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_COMMANDS = [
  'product_control_record_get',
  'product_control_selected_data_root_get',
  'product_control_record_ensure_created',
  'product_control_record_select_data_root',
  'product_control_record_complete_first_run_device_environment_scan',
  'product_control_record_set_first_run_install_level',
  'product_control_record_reconcile_first_run_setup_state',
] as const;

export const DESKTOP_ELECTRON_INTENTIONAL_TAURI_ONLY_COMMANDS = [
  'product_control_default_data_root_directory',
  'product_control_record_ensure_account_default_profile',
  'product_control_record_prepare_first_run_local_ai_ready',
  'product_control_record_admit_ready_for_use',
  'account_default_profile_for_scope_init',
  'built_in_ai_config_for_scope_init',
] as const;

const DESKTOP_ELECTRON_STANDARD_SHELL_COMMANDS = [
  'runtime_defaults',
  'open_external_url',
  'oauth_token_exchange',
  'oauth_listen_for_code',
  'runtime_bridge_unary',
  'runtime_bridge_stream_open',
  'runtime_bridge_stream_close',
  'runtime_bridge_status',
  'runtime_bridge_start',
  'runtime_bridge_stop',
  'runtime_bridge_restart',
  'runtime_bridge_config_get',
  'runtime_bridge_config_set',
  'log_renderer_event',
  'diagnostics_renderer_entry_probe',
  'data_path_resolve',
  'storage_read_json',
  'storage_write_json',
  'storage_remove_json',
  'ai_config_get',
  'ai_config_set',
  'confirm_dialog',
  'start_window_drag',
  'focus_main_window',
  'local_assets_resolve_url',
  'local_agent_identity',
  'local_agent_runtime_trusted_caller',
  'avatar_asset_resolve',
  'agent_center_avatar_asset_import',
  'agent_center_avatar_asset_validate',
  'agent_center_avatar_asset_resolve_preview',
  'agent_center_live2d_adapter_import',
  'agent_center_background_import',
  'agent_center_background_get',
  'agent_center_background_validate',
  'agent_center_background_remove',
  'agent_center_agent_resources_remove',
  'agent_center_account_resources_remove',
  'platform_projection_get',
  'file_dialog_open',
  'file_reveal_reveal',
  'export_save_file',
  'artifacts_write',
  'desktop_open_intent_open_intent',
] as const;

const DESKTOP_ELECTRON_NA_COMMANDS = [
  'desktop_release_info_get',
  'desktop_update_state_get',
  'desktop_update_check',
  'desktop_update_download',
  'desktop_update_install',
  'desktop_update_restart',
  'desktop_macos_smoke_context_get',
  'desktop_macos_smoke_report_write',
  'desktop_macos_smoke_ping',
  'menu_bar_sync_runtime_health',
  'menu_bar_complete_quit',
] as const;

const DESKTOP_ELECTRON_DEFERRED_COMMANDS = [
  'desktop_open_intent_set_ready',
  'account_profile_library_list',
  'account_profile_library_create',
  'account_profile_library_edit',
  'account_profile_library_import',
  'account_profile_library_export',
  'account_profile_library_delete',
  'nimi_data_cleanup_plan',
  'nimi_data_cleanup_execute',
  'desktop_logs_export',
  'get_system_resource_snapshot',
  'http_request',
  'desktop_avatar_launch_handoff',
  'desktop_avatar_close_handoff',
  'desktop_avatar_instance_registry_list',
  'chat_ai_list_threads',
  'chat_ai_get_thread_bundle',
  'chat_ai_create_thread',
  'chat_ai_update_thread_metadata',
  'chat_ai_create_message',
  'chat_ai_update_message',
  'chat_ai_get_draft',
  'chat_ai_put_draft',
  'chat_ai_delete_draft',
  'runtime_local_pick_asset_manifest_path',
] as const;

function entries(
  commands: readonly string[],
  status: DesktopElectronCommandMatrixStatus,
  reason: string,
): DesktopElectronCommandMatrixEntry[] {
  return commands.map((command) => ({ command, status, reason }));
}

export const DESKTOP_ELECTRON_COMMAND_MATRIX = [
  ...entries(
    DESKTOP_ELECTRON_STANDARD_SHELL_COMMANDS,
    'standard-shell-covered',
    'Covered by the shared Kit standard shell Electron host surface.',
  ),
  ...entries(
    DESKTOP_ELECTRON_RUNTIME_LOCAL_PRODUCT_CONTROL_COMMANDS,
    'electron-covered',
    'Covered by Desktop Electron RuntimeLocalService product-control gRPC bridge methods.',
  ),
  ...entries(
    DESKTOP_ELECTRON_INTENTIONAL_TAURI_ONLY_COMMANDS,
    'intentional-tauri-only',
    'Desktop first-run repair/admission command remains Tauri-only in this Tauri-first batch.',
  ),
  ...entries(
    DESKTOP_ELECTRON_NA_COMMANDS,
    'electron-na',
    'Tauri packaging, updater, menu-bar, or smoke instrumentation command; Electron uses a different native surface or no equivalent product command.',
  ),
  ...entries(
    DESKTOP_ELECTRON_DEFERRED_COMMANDS,
    'electron-deferred',
    'Known Desktop app-domain gap tracked for visibility only; no Electron handler is implemented in this batch.',
  ),
] as const satisfies readonly DesktopElectronCommandMatrixEntry[];
