mod catalog;

pub use catalog::{
    standard_shell_error, StandardShellCapability, StandardShellErrorEnvelope,
    StandardShellOperation, STANDARD_SHELL_CAPABILITIES, STANDARD_SHELL_CAPABILITY_IDS,
    STANDARD_SHELL_ERROR_CODES,
};

pub mod runtime {
    pub use crate::runtime_bridge::{
        bridge_error, build_unary_payload, build_unary_payload_with_metadata,
        channel_invalidation_count, current_daemon_status, current_daemon_status_async,
        decode_unary_result, generated, generated_method_ids, http_addr, invoke_unary_typed,
        invoke_unary_typed_with_metadata, is_allowlisted_method, is_stream_method,
        reset_channel_invalidation_count, restart_daemon_async, set_runtime_bridge_host_hooks,
        start_daemon_async, stop_daemon, stop_daemon_async, stream_event_name_with_namespace,
        RuntimeBridgeAppSession, RuntimeBridgeConfigSetPayload, RuntimeBridgeDaemonStatus,
        RuntimeBridgeHostHooks, RuntimeBridgeMetadata, RuntimeBridgeProtectedAccessToken,
        RuntimeBridgeStreamClosePayload, RuntimeBridgeStreamOpenPayload,
        RuntimeBridgeStreamOpenResult, RuntimeBridgeTrustedMetadata,
        RuntimeBridgeTrustedMetadataBridgeKind, RuntimeBridgeTrustedMetadataRequest,
        RuntimeBridgeUnaryPayload, RuntimeBridgeUnaryResult,
        RUNTIME_ACCOUNT_GET_ACCESS_TOKEN_METHOD_ID,
        RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID, RUNTIME_AGENT_GET_AGENT_METHOD_ID,
        RUNTIME_AGENT_GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD_ID,
        RUNTIME_AGENT_INITIALIZE_AGENT_METHOD_ID,
        RUNTIME_AGENT_LIST_AGENT_CONVERSATION_SUMMARIES_METHOD_ID,
        RUNTIME_AGENT_OPEN_CONVERSATION_ANCHOR_METHOD_ID,
        RUNTIME_AGENT_SET_AGENT_PRESENTATION_PROFILE_METHOD_ID,
        RUNTIME_APP_GET_ACCOUNT_APP_INVENTORY_METHOD_ID,
        RUNTIME_APP_GET_APP_PACKAGE_READINESS_METHOD_ID, RUNTIME_APP_GET_APP_STORAGE_METHOD_ID,
        RUNTIME_APP_LIST_APP_INSTALL_JOBS_METHOD_ID,
        RUNTIME_APP_LIST_LOCAL_APP_ADOPTIONS_METHOD_ID, RUNTIME_AUTH_REGISTER_APP_METHOD_ID,
        RUNTIME_LOCAL_ADMIT_PRODUCT_CONTROL_READY_FOR_USE_METHOD_ID,
        RUNTIME_LOCAL_COLLECT_DEVICE_PROFILE_METHOD_ID,
        RUNTIME_LOCAL_COMPLETE_PRODUCT_CONTROL_FIRST_RUN_DEVICE_ENVIRONMENT_SCAN_METHOD_ID,
        RUNTIME_LOCAL_ENSURE_PRODUCT_CONTROL_RECORD_CREATED_METHOD_ID,
        RUNTIME_LOCAL_GET_PRODUCT_CONTROL_RECORD_METHOD_ID,
        RUNTIME_LOCAL_GET_PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD_ID,
        RUNTIME_LOCAL_LIST_LOCAL_ENVIRONMENT_DEPENDENCY_JOBS_METHOD_ID,
        RUNTIME_LOCAL_MINT_FIRST_RUN_EXECUTION_EVIDENCE_METHOD_ID,
        RUNTIME_LOCAL_MINT_RUNTIME_BASELINE_READINESS_METHOD_ID,
        RUNTIME_LOCAL_RECONCILE_PRODUCT_CONTROL_FIRST_RUN_SETUP_STATE_METHOD_ID,
        RUNTIME_LOCAL_RECORD_PRODUCT_CONTROL_ACCOUNT_DEFAULT_PROFILE_EVIDENCE_METHOD_ID,
        RUNTIME_LOCAL_RECORD_PRODUCT_CONTROL_FIRST_RUN_LOCAL_AI_READY_EVIDENCE_METHOD_ID,
        RUNTIME_LOCAL_RESOLVE_FIRST_RUN_EXECUTION_EVIDENCE_METHOD_ID,
        RUNTIME_LOCAL_RESOLVE_LOCAL_ENVIRONMENT_PLAN_METHOD_ID,
        RUNTIME_LOCAL_RESOLVE_RUNTIME_BASELINE_READINESS_METHOD_ID,
        RUNTIME_LOCAL_SELECT_PRODUCT_CONTROL_DATA_ROOT_METHOD_ID,
        RUNTIME_LOCAL_SET_PRODUCT_CONTROL_FIRST_RUN_INSTALL_LEVEL_METHOD_ID,
    };

    #[tauri::command]
    pub async fn runtime_bridge_unary(
        payload: RuntimeBridgeUnaryPayload,
    ) -> Result<RuntimeBridgeUnaryResult, String> {
        crate::runtime_bridge::runtime_bridge_unary(payload).await
    }

    #[tauri::command]
    pub async fn runtime_bridge_stream_open(
        app: tauri::AppHandle,
        payload: RuntimeBridgeStreamOpenPayload,
    ) -> Result<RuntimeBridgeStreamOpenResult, String> {
        crate::runtime_bridge::runtime_bridge_stream_open(app, payload).await
    }

    #[tauri::command]
    pub fn runtime_bridge_stream_close(
        payload: RuntimeBridgeStreamClosePayload,
    ) -> Result<(), String> {
        crate::runtime_bridge::runtime_bridge_stream_close(payload)
    }

    #[tauri::command]
    pub async fn runtime_bridge_status(app: tauri::AppHandle) -> RuntimeBridgeDaemonStatus {
        crate::runtime_bridge::runtime_bridge_status(app).await
    }

    #[tauri::command]
    pub async fn runtime_bridge_start(
        app: tauri::AppHandle,
    ) -> Result<RuntimeBridgeDaemonStatus, String> {
        crate::runtime_bridge::runtime_bridge_start(app).await
    }

    #[tauri::command]
    pub async fn runtime_bridge_stop(
        app: tauri::AppHandle,
    ) -> Result<RuntimeBridgeDaemonStatus, String> {
        crate::runtime_bridge::runtime_bridge_stop(app).await
    }

    #[tauri::command]
    pub async fn runtime_bridge_restart(
        app: tauri::AppHandle,
    ) -> Result<RuntimeBridgeDaemonStatus, String> {
        crate::runtime_bridge::runtime_bridge_restart(app).await
    }

    #[tauri::command]
    pub async fn runtime_bridge_config_get() -> Result<serde_json::Value, String> {
        crate::runtime_bridge::runtime_bridge_config_get().await
    }

    #[tauri::command]
    pub async fn runtime_bridge_config_set(
        payload: RuntimeBridgeConfigSetPayload,
    ) -> Result<serde_json::Value, String> {
        crate::runtime_bridge::runtime_bridge_config_set(payload).await
    }
}

pub mod runtime_lifecycle {
    pub use crate::runtime_bridge::{
        runtime_bridge_config_get, runtime_bridge_config_set, runtime_bridge_restart,
        runtime_bridge_start, runtime_bridge_status, runtime_bridge_stop,
        RuntimeBridgeDaemonStatus,
    };
}

pub mod runtime_defaults {
    pub use crate::runtime_defaults::{RealmDefaults, RuntimeDefaults, RuntimeExecutionDefaults};

    #[tauri::command]
    pub fn runtime_defaults() -> RuntimeDefaults {
        crate::runtime_defaults::runtime_defaults()
    }
}

pub mod auth {
    pub use crate::auth_session_commands::{
        AuthSessionLoadResult, AuthSessionSavePayload, AuthSessionUser,
    };

    #[tauri::command]
    pub fn auth_session_load() -> Result<Option<AuthSessionLoadResult>, String> {
        crate::auth_session_commands::auth_session_load()
    }

    #[tauri::command]
    pub fn auth_session_save(payload: AuthSessionSavePayload) -> Result<(), String> {
        crate::auth_session_commands::auth_session_save(payload)
    }

    #[tauri::command]
    pub fn auth_session_clear() -> Result<(), String> {
        crate::auth_session_commands::auth_session_clear()
    }
}

pub mod oauth {
    pub use crate::oauth_commands::{
        OauthListenForCodePayload, OauthListenForCodeResult, OauthTokenExchangePayload,
        OauthTokenExchangeResult, OpenExternalUrlPayload, OpenExternalUrlResult,
    };

    #[tauri::command]
    pub fn open_external_url(
        payload: OpenExternalUrlPayload,
    ) -> Result<OpenExternalUrlResult, String> {
        crate::oauth_commands::open_external_url(payload)
    }

    #[tauri::command]
    pub async fn oauth_token_exchange(
        payload: OauthTokenExchangePayload,
    ) -> Result<OauthTokenExchangeResult, String> {
        crate::oauth_commands::oauth_token_exchange(payload).await
    }

    #[tauri::command]
    pub async fn oauth_listen_for_code(
        payload: OauthListenForCodePayload,
    ) -> Result<OauthListenForCodeResult, String> {
        crate::oauth_commands::oauth_listen_for_code(payload).await
    }
}

pub mod desktop_open {
    #[tauri::command]
    pub async fn desktop_open_intent_open_intent(
        app: tauri::AppHandle,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        crate::standard_desktop_open::desktop_open_intent_open_intent(app, payload).await
    }
}

pub mod diagnostics {
    pub use crate::renderer_entry_probe::{
        build_renderer_entry_probe_script, RendererEntryProbeScriptConfig,
    };
}

pub mod session_logging {
    pub use crate::session_logging::{
        install_panic_hook, log_boot_marker, set_app_session_prefix, RendererLogPayload,
    };

    #[tauri::command]
    pub fn log_renderer_event(payload: RendererLogPayload) {
        crate::session_logging::log_renderer_event(payload)
    }
}

pub mod data {
    pub use crate::desktop_paths::{resolve_nimi_data_dir, resolve_nimi_dir};
    pub use crate::nimi_data_directory::{
        enforce_data_root_layout, execute_directory_cleanup, first_level_directory_names,
        first_level_row, is_declared_first_level, measure_directory, plan_directory_cleanup,
        CleanupClass, CleanupOutcome, CleanupPlan, DirectoryOwner, DirectoryUsage,
        NimiDataDirectoryRow, DESTRUCTIVE_CLEANUP_CONFIRMATION, NIMI_DATA_DIRECTORY_MATRIX,
    };
    pub use crate::runtime_app_storage::{
        data_path_resolve_for_roots, parse_standard_storage_payload,
        require_bound_standard_storage_roots, resolve_standard_app_storage_roots,
        StandardAppStorageRootSlot, StandardAppStorageRoots, StandardDataRootBinding,
        StandardPathResolveResult, StandardStoragePathPayload,
    };

    #[tauri::command]
    pub fn data_path_resolve(
        slot: tauri::State<'_, StandardAppStorageRootSlot>,
        payload: serde_json::Value,
    ) -> Result<StandardPathResolveResult, String> {
        let roots = require_bound_standard_storage_roots(slot.inner(), "data_path_resolve")?;
        let payload = parse_standard_storage_payload::<StandardStoragePathPayload>(
            payload,
            "data_path_resolve",
        )?;
        data_path_resolve_for_roots(&roots, payload)
    }
}

pub mod storage {
    pub use crate::runtime_app_storage::{
        canonical_storage_root, parse_standard_storage_payload,
        require_bound_standard_storage_roots, scoped_storage_child, storage_read_json_for_roots,
        storage_remove_json_for_roots, storage_write_json_for_roots, StandardAppStorageRootSlot,
        StandardAppStorageRoots, StandardStorageJsonResult, StandardStoragePathPayload,
        StandardStorageRemoveJsonResult, StandardStorageWriteJsonPayload,
    };

    #[tauri::command]
    pub fn storage_read_json(
        slot: tauri::State<'_, StandardAppStorageRootSlot>,
        payload: serde_json::Value,
    ) -> Result<StandardStorageJsonResult, String> {
        let roots = require_bound_standard_storage_roots(slot.inner(), "storage_read_json")?;
        let payload = parse_standard_storage_payload::<StandardStoragePathPayload>(
            payload,
            "storage_read_json",
        )?;
        storage_read_json_for_roots(&roots, payload)
    }

    #[tauri::command]
    pub fn storage_write_json(
        slot: tauri::State<'_, StandardAppStorageRootSlot>,
        payload: serde_json::Value,
    ) -> Result<StandardStorageJsonResult, String> {
        let roots = require_bound_standard_storage_roots(slot.inner(), "storage_write_json")?;
        let payload = parse_standard_storage_payload::<StandardStorageWriteJsonPayload>(
            payload,
            "storage_write_json",
        )?;
        storage_write_json_for_roots(&roots, payload)
    }

    #[tauri::command]
    pub fn storage_remove_json(
        slot: tauri::State<'_, StandardAppStorageRootSlot>,
        payload: serde_json::Value,
    ) -> Result<StandardStorageRemoveJsonResult, String> {
        let roots = require_bound_standard_storage_roots(slot.inner(), "storage_remove_json")?;
        let payload = parse_standard_storage_payload::<StandardStoragePathPayload>(
            payload,
            "storage_remove_json",
        )?;
        storage_remove_json_for_roots(&roots, payload)
    }
}

pub mod shell_ui {
    use serde_json::json;
    use tauri::Manager;

    pub use crate::shell_ui_hooks::{
        set_standard_shell_ui_host_hooks, StandardConfirmDialogHook, StandardConfirmDialogPayload,
        StandardFocusMainWindowHook, StandardShellUiHostHooks, StandardStartWindowDragHook,
    };

    #[tauri::command]
    pub fn confirm_dialog(payload: serde_json::Value) -> Result<serde_json::Value, String> {
        crate::shell_ui_hooks::run_confirm_dialog(payload)
    }

    #[tauri::command]
    pub fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
        let hook_outcome =
            crate::shell_ui_hooks::start_window_drag_hook().map(|hook| hook(&window));
        match crate::shell_ui_hooks::interpret_start_window_drag_hook_outcome(hook_outcome)? {
            crate::shell_ui_hooks::StandardWindowDragDecision::HandledByHook => Ok(()),
            crate::shell_ui_hooks::StandardWindowDragDecision::FallbackToDefault => {
                window.start_dragging().map_err(|error| {
                    crate::capabilities::standard_shell_error(
                        "host-internal-error",
                        "tauri-standard-window-drag-failed",
                        "inspect_tauri_window_drag_support",
                        "tauri",
                        Some(json!({ "command": "start_window_drag", "cause": error.to_string() })),
                    )
                })
            }
        }
    }

    #[tauri::command]
    pub fn focus_main_window(app: tauri::AppHandle) -> Result<(), String> {
        if let Some(hook) = crate::shell_ui_hooks::focus_main_window_hook() {
            return hook(&app).map_err(|error| {
                crate::shell_ui_hooks::shell_ui_hook_error_to_standard_error(
                    error,
                    "focus_main_window",
                    "tauri-standard-focus-main-window-hook-failed",
                    "inspect_host_focus_main_window_hook",
                )
            });
        }
        let window = app
            .get_webview_window("main")
            .or_else(|| app.webview_windows().into_values().next())
            .ok_or_else(|| {
                crate::capabilities::standard_shell_error(
                    "capability-unavailable",
                    "tauri-standard-main-window-unavailable",
                    "create_main_webview_window_before_focus",
                    "tauri",
                    Some(json!({ "command": "focus_main_window" })),
                )
            })?;
        window.set_focus().map_err(|error| {
            crate::capabilities::standard_shell_error(
                "host-internal-error",
                "tauri-standard-main-window-focus-failed",
                "inspect_tauri_window_focus_support",
                "tauri",
                Some(json!({ "command": "focus_main_window", "cause": error.to_string() })),
            )
        })
    }
}

pub mod config {
    pub use crate::governed_config::{
        read_governed_config, write_governed_json_config, ConfigReadOutcome, ConfigRepairSeverity,
        GovernedConfigFile,
    };
}

pub mod local_assets {
    pub use crate::agent_center_avatar_asset::{
        agent_center_path_segment, nimi_avatar_resolve_agent_center_avatar_asset,
        nimi_avatar_resolve_local_avatar_asset, AgentCenterAvatarAssetResolvePayload,
        LocalAvatarAssetResolvePayload, ModelManifest,
    };
    pub use crate::runtime_local_assets::{
        canonical_asset_manifest_path, reveal_target_for_asset, runtime_models_dir,
        ASSET_MANIFEST_FILE_NAME,
    };
}

pub mod local_agent {
    pub use crate::runtime_account_caller::{
        local_developer_runtime_account_caller, local_first_party_runtime_account_caller,
    };
    pub use crate::runtime_local_agent_identity::{
        is_runtime_local_agent_ref, project_runtime_local_agent_identity, RuntimeLocalAgentIdentity,
    };
}

pub mod desktop_product_local_agent {
    pub use crate::runtime_account_caller::desktop_shell_runtime_account_caller;
}

pub mod ai_profile {
    pub use crate::platform_catalog::ai_profile_factory::{
        resolve_factory_ai_profile_alias, verify_first_run_factory_ai_profile,
        PlatformAIProfileFactoryRow, PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID,
        PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION, PLATFORM_AI_PROFILE_FACTORY_ROWS,
        PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
    };
}

pub mod ai_config;

pub mod avatar {
    pub use crate::agent_center_avatar_asset::{
        agent_center_path_segment, nimi_avatar_resolve_agent_center_avatar_asset,
        nimi_avatar_resolve_local_avatar_asset, AgentCenterAvatarAssetResolvePayload,
        LocalAvatarAssetResolvePayload, ModelManifest,
    };
}

pub mod platform_projection {
    pub use crate::platform_catalog::nimi_app_registry;
    pub use crate::platform_projection::{
        apps_bridge, apps_packages, apps_registry, factory_profile_index,
    };
}

pub mod file_dialog {
    pub use crate::standard_file_dialog::{
        StandardFileDialogFilter, StandardFileDialogOpenPayload, StandardFileDialogOpenResult,
    };

    #[tauri::command]
    pub fn file_dialog_open(
        payload: serde_json::Value,
    ) -> Result<StandardFileDialogOpenResult, String> {
        crate::standard_file_dialog::file_dialog_open(payload)
    }
}

pub mod file_reveal {
    pub use crate::standard_file_reveal::{StandardFileRevealPayload, StandardFileRevealResult};

    #[tauri::command]
    pub fn file_reveal_reveal(
        slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
        payload: serde_json::Value,
    ) -> Result<StandardFileRevealResult, String> {
        let roots = crate::runtime_app_storage::require_bound_standard_storage_roots(
            slot.inner(),
            "file_reveal_reveal",
        )?;
        crate::standard_file_reveal::file_reveal_reveal(&roots, payload)
    }
}

pub mod export {
    pub use crate::standard_export::{StandardExportSaveFilePayload, StandardExportSaveFileResult};

    #[tauri::command]
    pub fn export_save_file(
        payload: serde_json::Value,
    ) -> Result<StandardExportSaveFileResult, String> {
        crate::standard_export::export_save_file(payload)
    }
}

pub mod artifacts {
    pub use crate::standard_artifacts::{
        StandardArtifactsWritePayload, StandardArtifactsWriteResult,
    };

    #[tauri::command]
    pub fn artifacts_write(
        slot: tauri::State<'_, crate::runtime_app_storage::StandardAppStorageRootSlot>,
        payload: serde_json::Value,
    ) -> Result<StandardArtifactsWriteResult, String> {
        let roots = crate::runtime_app_storage::require_bound_standard_storage_roots(
            slot.inner(),
            "artifacts_write",
        )?;
        crate::standard_artifacts::artifacts_write(&roots, payload)
    }
}

pub mod floating_window {
    // Command functions live in `crate::standard_floating_window` because
    // `#[tauri::command]` generates sibling helper items that must be
    // referenced from their defining module by `tauri::generate_handler!`.
    // The standalone `nimi_shell_tauri_floating_window_commands!` macro and
    // `STANDARD_FLOATING_WINDOW_COMMANDS` point at that module directly. Here
    // we re-export the pure geometry helpers and wire result types for
    // consumers that want them without pulling in the command surface.
    pub use crate::standard_floating_window::{
        compute_constrained_window_position, compute_manual_drag_window_position,
        FloatingWindowConstrainResult, FloatingWindowManualDragOrigin,
    };
}
