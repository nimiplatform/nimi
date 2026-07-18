mod catalog;

pub use catalog::{
    standard_shell_error, StandardShellCapability, StandardShellErrorEnvelope,
    StandardShellOperation, STANDARD_SHELL_CAPABILITIES, STANDARD_SHELL_CAPABILITY_IDS,
    STANDARD_SHELL_ERROR_CODES,
};

pub mod runtime {
    pub use crate::runtime_bridge::{
        begin_desktop_account_login, bridge_error, build_unary_payload,
        build_unary_payload_with_metadata, channel_invalidation_count,
        complete_desktop_account_login, current_daemon_status, current_daemon_status_async,
        decide_local_development_project, decode_unary_result, end_local_development_run,
        evaluate_local_development_project, generated, generated_method_ids,
        get_developer_mode_status, get_local_development_authority_summary, http_addr,
        invoke_desktop_account_realm_unary, invoke_unary_typed, invoke_unary_typed_with_metadata,
        is_allowlisted_method, is_stream_method, launch_local_development_host,
        list_local_development_authorizations, local_development_host_running,
        logout_desktop_account, reactivate_local_development_project,
        reset_channel_invalidation_count, restart_daemon_async,
        revoke_local_development_authorization, set_developer_mode, set_runtime_bridge_host_hooks,
        start_daemon_async, stream_event_name_with_namespace, switch_desktop_account,
        terminate_local_development_host, DesktopAccountSessionStatusRequest, DeveloperModeState,
        DeveloperModeStatus, LocalDevelopmentAuthoritySummary, LocalDevelopmentAuthorization,
        LocalDevelopmentAuthorizationState, LocalDevelopmentDecision,
        LocalDevelopmentDecisionRequest, LocalDevelopmentDeveloperModeSummary,
        LocalDevelopmentEndRunRequest, LocalDevelopmentEvaluation,
        LocalDevelopmentEvaluationRequest, LocalDevelopmentLaunchOutcome,
        LocalDevelopmentLaunchRequest, LocalDevelopmentProject,
        LocalDevelopmentProjectAuthorizationSummary, LocalDevelopmentReactivationRequest,
        LocalDevelopmentShellKind, LocalDevelopmentSummaryAvailability, NimiHostError,
        NimiHostErrorReasonCode, RuntimeBridgeAppSession, RuntimeBridgeDaemonStatus,
        RuntimeBridgeDesktopAccountActionRequest, RuntimeBridgeDesktopAccountBeginLoginRequest,
        RuntimeBridgeDesktopAccountBeginLoginResponse,
        RuntimeBridgeDesktopAccountCompleteLoginRequest,
        RuntimeBridgeDesktopAccountMutationResponse, RuntimeBridgeDesktopAccountProjection,
        RuntimeBridgeDesktopAccountRealmUnaryRequest,
        RuntimeBridgeDesktopAccountRealmUnaryResponse, RuntimeBridgeDesktopAccountSessionStatus,
        RuntimeBridgeHostAppSessionConfig, RuntimeBridgeHostAppSessionProvider,
        RuntimeBridgeHostHooks, RuntimeBridgeLocalAppHost, RuntimeBridgeMetadata,
        RuntimeBridgeProtectedAccessToken, RuntimeBridgeStreamClosePayload,
        RuntimeBridgeStreamOpenPayload, RuntimeBridgeStreamOpenResult,
        RuntimeBridgeTrustedMetadata, RuntimeBridgeTrustedMetadataBridgeKind,
        RuntimeBridgeTrustedMetadataRequest, RuntimeBridgeUnaryPayload, RuntimeBridgeUnaryResult,
        RUNTIME_ACCOUNT_GET_ACCOUNT_SESSION_STATUS_METHOD_ID, RUNTIME_AGENT_GET_AGENT_METHOD_ID,
        RUNTIME_AGENT_GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD_ID,
        RUNTIME_AGENT_INITIALIZE_AGENT_METHOD_ID,
        RUNTIME_AGENT_LIST_AGENT_CONVERSATION_SUMMARIES_METHOD_ID,
        RUNTIME_AGENT_OPEN_CONVERSATION_ANCHOR_METHOD_ID,
        RUNTIME_AGENT_SET_AGENT_PRESENTATION_PROFILE_METHOD_ID,
        RUNTIME_APP_GET_ACCOUNT_APP_INVENTORY_METHOD_ID,
        RUNTIME_APP_GET_APP_PACKAGE_READINESS_METHOD_ID, RUNTIME_APP_GET_APP_STORAGE_METHOD_ID,
        RUNTIME_AUTH_REGISTER_APP_METHOD_ID, RUNTIME_BRIDGE_TAURI_STANDARD_SHELL_SOURCE_HOST,
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
    pub async fn runtime_account_session_status(
    ) -> Result<RuntimeBridgeDesktopAccountSessionStatus, String> {
        crate::runtime_bridge::runtime_account_session_status().await
    }

    #[tauri::command]
    pub async fn runtime_account_begin_login(
        payload: RuntimeBridgeDesktopAccountBeginLoginRequest,
    ) -> Result<RuntimeBridgeDesktopAccountBeginLoginResponse, String> {
        crate::runtime_bridge::begin_desktop_account_login(payload).await
    }

    #[tauri::command]
    pub async fn runtime_account_complete_login(
        payload: RuntimeBridgeDesktopAccountCompleteLoginRequest,
    ) -> Result<RuntimeBridgeDesktopAccountMutationResponse, String> {
        crate::runtime_bridge::complete_desktop_account_login(payload).await
    }

    #[tauri::command]
    pub async fn runtime_account_invoke_realm_unary(
        payload: RuntimeBridgeDesktopAccountRealmUnaryRequest,
    ) -> Result<RuntimeBridgeDesktopAccountRealmUnaryResponse, String> {
        crate::runtime_bridge::invoke_desktop_account_realm_unary(payload).await
    }

    #[tauri::command]
    pub async fn runtime_account_logout(
        payload: RuntimeBridgeDesktopAccountActionRequest,
    ) -> Result<RuntimeBridgeDesktopAccountMutationResponse, String> {
        crate::runtime_bridge::logout_desktop_account(payload).await
    }

    #[tauri::command]
    pub async fn runtime_account_switch_account(
        payload: RuntimeBridgeDesktopAccountActionRequest,
    ) -> Result<RuntimeBridgeDesktopAccountMutationResponse, String> {
        crate::runtime_bridge::switch_desktop_account(payload).await
    }

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
    pub async fn runtime_bridge_restart(
        app: tauri::AppHandle,
    ) -> Result<RuntimeBridgeDaemonStatus, String> {
        crate::runtime_bridge::runtime_bridge_restart(app).await
    }
}

pub mod runtime_lifecycle {
    pub use crate::runtime_bridge::{
        runtime_bridge_restart, runtime_bridge_start, runtime_bridge_status,
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

pub mod oauth {
    pub use crate::oauth_commands::{
        OauthListenForCodePayload, OauthListenForCodeResult, OpenExternalUrlPayload,
        OpenExternalUrlResult,
    };

    #[tauri::command]
    pub fn open_external_url(
        payload: OpenExternalUrlPayload,
    ) -> Result<OpenExternalUrlResult, String> {
        crate::oauth_commands::open_external_url(payload)
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

    #[tauri::command]
    pub fn diagnostics_renderer_entry_probe(
        payload: Option<serde_json::Value>,
        stage: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let payload = payload.unwrap_or_else(|| serde_json::json!({ "stage": stage }));
        let stage = payload
            .as_object()
            .ok_or_else(|| {
                crate::capabilities::standard_shell_error(
                    "invalid-payload",
                    "tauri-diagnostics-renderer-entry-probe-payload-not-object",
                    "send_structured_renderer_entry_probe_payload",
                    "tauri",
                    Some(serde_json::json!({ "command": "diagnostics_renderer_entry_probe" })),
                )
            })?
            .get("stage")
            .map(|value| {
                String::from(value.as_str().unwrap_or_default())
                    .trim()
                    .to_string()
            })
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "renderer-entry-probe".to_string());
        Ok(serde_json::json!({
            "ok": true,
            "source": "tauri",
            "stage": stage,
            "hasInvoke": true,
        }))
    }
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
    use tauri::Manager;

    pub use crate::runtime_app_storage::{
        canonical_storage_root, parse_standard_storage_payload,
        require_bound_standard_storage_roots, scoped_storage_child, storage_read_json_for_roots,
        storage_remove_json_for_roots, storage_write_json_for_roots, StandardAppStorageRootSlot,
        StandardAppStorageRoots, StandardStorageJsonResult, StandardStoragePathPayload,
        StandardStorageRemoveJsonResult, StandardStorageWriteJsonPayload,
    };

    #[tauri::command]
    pub async fn storage_read_json(
        app: tauri::AppHandle,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        if let Some(host) = app.try_state::<crate::runtime_bridge::RuntimeBridgeLocalAppHost>() {
            return crate::standard_local_app::storage_read_json_for_host(host.inner(), payload)
                .await;
        }
        let slot = require_standard_storage_slot(&app)?;
        let roots = require_bound_standard_storage_roots(slot.inner(), "storage_read_json")?;
        let payload = parse_standard_storage_payload::<StandardStoragePathPayload>(
            payload,
            "storage_read_json",
        )?;
        project_standard_storage_result(storage_read_json_for_roots(&roots, payload)?)
    }

    #[tauri::command]
    pub async fn storage_write_json(
        app: tauri::AppHandle,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        if let Some(host) = app.try_state::<crate::runtime_bridge::RuntimeBridgeLocalAppHost>() {
            return crate::standard_local_app::storage_write_json_for_host(host.inner(), payload)
                .await;
        }
        let slot = require_standard_storage_slot(&app)?;
        let roots = require_bound_standard_storage_roots(slot.inner(), "storage_write_json")?;
        let payload = parse_standard_storage_payload::<StandardStorageWriteJsonPayload>(
            payload,
            "storage_write_json",
        )?;
        project_standard_storage_result(storage_write_json_for_roots(&roots, payload)?)
    }

    #[tauri::command]
    pub async fn storage_remove_json(
        app: tauri::AppHandle,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        if let Some(host) = app.try_state::<crate::runtime_bridge::RuntimeBridgeLocalAppHost>() {
            return crate::standard_local_app::storage_remove_json_for_host(host.inner(), payload)
                .await;
        }
        let slot = require_standard_storage_slot(&app)?;
        let roots = require_bound_standard_storage_roots(slot.inner(), "storage_remove_json")?;
        let payload = parse_standard_storage_payload::<StandardStoragePathPayload>(
            payload,
            "storage_remove_json",
        )?;
        project_standard_storage_result(storage_remove_json_for_roots(&roots, payload)?)
    }

    fn require_standard_storage_slot(
        app: &tauri::AppHandle,
    ) -> Result<tauri::State<'_, StandardAppStorageRootSlot>, String> {
        app.try_state::<StandardAppStorageRootSlot>()
            .ok_or_else(|| {
                crate::capabilities::standard_shell_error(
                    "capability-unavailable",
                    "tauri-standard-storage-binding-missing",
                    "manage_standard_app_storage_root_from_runtime_binding",
                    "tauri",
                    None,
                )
            })
    }

    fn project_standard_storage_result(
        value: impl serde::Serialize,
    ) -> Result<serde_json::Value, String> {
        serde_json::to_value(value).map_err(|_| {
            crate::capabilities::standard_shell_error(
                "host-internal-error",
                "tauri-standard-storage-projection-failed",
                "repair_standard_storage_host",
                "tauri",
                None,
            )
        })
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
        AgentCenterAvatarAssetResolvePayload, ModelManifest,
    };
    pub use crate::runtime_local_assets::{
        canonical_asset_manifest_path, reveal_target_for_asset, runtime_models_dir,
        ASSET_MANIFEST_FILE_NAME,
    };
    pub use crate::standard_local_assets::{
        set_standard_local_assets_host_hooks, StandardLocalAssetRootsHook,
        StandardLocalAssetUrlPayload, StandardLocalAssetUrlResult, StandardLocalAssetsHostHooks,
    };

    #[tauri::command]
    pub fn local_assets_resolve_url(
        app: tauri::AppHandle,
        payload: serde_json::Value,
    ) -> Result<StandardLocalAssetUrlResult, String> {
        crate::standard_local_assets::resolve_standard_local_asset_url(
            &app,
            payload,
            "local_assets_resolve_url",
        )
    }
}

pub mod local_agent {
    pub use crate::runtime_account_caller::local_first_party_runtime_account_caller;
    pub use crate::runtime_local_agent_identity::{
        is_runtime_local_agent_ref, project_runtime_local_agent_identity, RuntimeLocalAgentIdentity,
    };
    pub use crate::standard_local_agent::{
        set_standard_local_agent_host_hooks, StandardLocalAgentHostHooks,
        StandardLocalAgentIdentityHook, StandardRuntimeTrustedCaller,
        StandardRuntimeTrustedCallerHook,
    };

    #[tauri::command]
    pub fn local_agent_identity() -> Result<RuntimeLocalAgentIdentity, String> {
        crate::standard_local_agent::local_agent_identity("local_agent_identity")
    }

    #[tauri::command]
    pub fn local_agent_runtime_trusted_caller(
        payload: serde_json::Value,
    ) -> Result<StandardRuntimeTrustedCaller, String> {
        crate::standard_local_agent::runtime_trusted_caller(
            payload,
            "local_agent_runtime_trusted_caller",
        )
    }
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
        AgentCenterAvatarAssetResolvePayload, ModelManifest,
    };
    pub use crate::standard_local_assets::{
        StandardLocalAssetUrlPayload, StandardLocalAssetUrlResult,
    };

    #[tauri::command]
    pub fn avatar_asset_resolve(
        app: tauri::AppHandle,
        payload: serde_json::Value,
    ) -> Result<StandardLocalAssetUrlResult, String> {
        crate::standard_local_assets::resolve_standard_local_asset_url(
            &app,
            payload,
            "avatar_asset_resolve",
        )
    }
}

pub mod agent_center;
pub mod platform_projection {
    pub use crate::platform_catalog::nimi_app_registry;
    pub use crate::platform_projection::{
        apps_bridge, apps_packages, apps_registry, factory_profile_index,
    };
    pub use crate::standard_platform_projection::{
        StandardPlatformProjectionPayload, StandardPlatformProjectionResult,
    };

    #[tauri::command]
    pub async fn platform_projection_get(
        payload: serde_json::Value,
    ) -> Result<StandardPlatformProjectionResult, String> {
        tauri::async_runtime::spawn_blocking(move || {
            crate::standard_platform_projection::platform_projection_get(payload)
        })
        .await
        .map_err(|error| {
            crate::capabilities::standard_shell_error(
                "host-internal-error",
                "tauri-platform-projection-task-failed",
                "inspect_platform_projection_blocking_task",
                "tauri",
                Some(serde_json::json!({ "command": "platform_projection_get", "cause": error.to_string() })),
            )
        })?
    }
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

pub mod local_app {
    #[tauri::command]
    pub async fn local_app_session_status(
        host: tauri::State<'_, crate::runtime_bridge::RuntimeBridgeLocalAppHost>,
    ) -> Result<serde_json::Value, String> {
        crate::standard_local_app::session_status_for_host(host.inner()).await
    }

    #[tauri::command]
    pub async fn local_app_permission_status(
        host: tauri::State<'_, crate::runtime_bridge::RuntimeBridgeLocalAppHost>,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        crate::standard_local_app::permission_status_for_host(host.inner(), payload).await
    }

    #[tauri::command]
    pub async fn local_app_permission_request(
        host: tauri::State<'_, crate::runtime_bridge::RuntimeBridgeLocalAppHost>,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        crate::standard_local_app::permission_request_for_host(host.inner(), payload).await
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
