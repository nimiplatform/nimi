use serde::Serialize;
use serde_json::Value;

pub const STANDARD_SHELL_CAPABILITY_IDS: &[&str] = &[
    "runtime",
    "runtime-lifecycle",
    "runtime-defaults",
    "auth",
    "oauth",
    "shell-ui",
    "diagnostics",
    "data",
    "storage",
    "config",
    "local-assets",
    "local-agent",
    "ai-profile",
    "ai-config",
    "avatar",
    "platform-projection",
];

pub const STANDARD_SHELL_ERROR_CODES: &[&str] = &[
    "capability-unavailable",
    "external-daemon-required",
    "runtime-permission-denied",
    "runtime-unauthenticated",
    "forbidden-renderer-access",
    "invalid-path",
    "not-found",
    "invalid-payload",
    "host-internal-error",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StandardShellOperation {
    pub id: &'static str,
    pub command: &'static str,
    pub negative_states: &'static [&'static str],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StandardShellCapability {
    pub id: &'static str,
    pub operations: &'static [StandardShellOperation],
}

pub const STANDARD_SHELL_CAPABILITIES: &[StandardShellCapability] = &[
    StandardShellCapability {
        id: "runtime",
        operations: &[
            StandardShellOperation {
                id: "unary",
                command: "nimi.shell.runtime.unary",
                negative_states: &[
                    "capability-unavailable",
                    "external-daemon-required",
                    "runtime-permission-denied",
                    "runtime-unauthenticated",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
            StandardShellOperation {
                id: "streamOpen",
                command: "nimi.shell.runtime.stream.open",
                negative_states: &[
                    "capability-unavailable",
                    "external-daemon-required",
                    "runtime-permission-denied",
                    "runtime-unauthenticated",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
            StandardShellOperation {
                id: "streamClose",
                command: "nimi.shell.runtime.stream.close",
                negative_states: &[
                    "capability-unavailable",
                    "not-found",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
        ],
    },
    StandardShellCapability {
        id: "runtime-lifecycle",
        operations: &[
            StandardShellOperation {
                id: "status",
                command: "nimi.shell.runtimeLifecycle.status",
                negative_states: &[
                    "capability-unavailable",
                    "external-daemon-required",
                    "runtime-permission-denied",
                    "runtime-unauthenticated",
                ],
            },
            StandardShellOperation {
                id: "start",
                command: "nimi.shell.runtimeLifecycle.start",
                negative_states: &["external-daemon-required"],
            },
            StandardShellOperation {
                id: "stop",
                command: "nimi.shell.runtimeLifecycle.stop",
                negative_states: &["external-daemon-required"],
            },
            StandardShellOperation {
                id: "restart",
                command: "nimi.shell.runtimeLifecycle.restart",
                negative_states: &["external-daemon-required"],
            },
        ],
    },
    StandardShellCapability {
        id: "runtime-defaults",
        operations: &[StandardShellOperation {
            id: "get",
            command: "nimi.shell.runtimeDefaults.get",
            negative_states: &["capability-unavailable", "invalid-payload"],
        }],
    },
    StandardShellCapability {
        id: "auth",
        operations: &[
            StandardShellOperation {
                id: "sessionLoad",
                command: "nimi.shell.auth.session.load",
                negative_states: &["external-daemon-required", "capability-unavailable"],
            },
            StandardShellOperation {
                id: "sessionSave",
                command: "nimi.shell.auth.session.save",
                negative_states: &[
                    "external-daemon-required",
                    "capability-unavailable",
                    "invalid-payload",
                ],
            },
            StandardShellOperation {
                id: "sessionClear",
                command: "nimi.shell.auth.session.clear",
                negative_states: &["external-daemon-required", "capability-unavailable"],
            },
        ],
    },
    StandardShellCapability {
        id: "oauth",
        operations: &[
            StandardShellOperation {
                id: "openExternalUrl",
                command: "nimi.shell.oauth.openExternalUrl",
                negative_states: &[
                    "capability-unavailable",
                    "forbidden-renderer-access",
                    "invalid-payload",
                ],
            },
            StandardShellOperation {
                id: "tokenExchange",
                command: "nimi.shell.oauth.tokenExchange",
                negative_states: &[
                    "capability-unavailable",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
            StandardShellOperation {
                id: "listenForCode",
                command: "nimi.shell.oauth.listenForCode",
                negative_states: &[
                    "capability-unavailable",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
        ],
    },
    StandardShellCapability {
        id: "shell-ui",
        operations: &[
            StandardShellOperation {
                id: "confirmDialog",
                command: "nimi.shell.ui.confirmDialog",
                negative_states: &[
                    "capability-unavailable",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
            StandardShellOperation {
                id: "startWindowDrag",
                command: "nimi.shell.ui.startWindowDrag",
                negative_states: &["capability-unavailable", "host-internal-error"],
            },
            StandardShellOperation {
                id: "focusMainWindow",
                command: "nimi.shell.ui.focusMainWindow",
                negative_states: &["capability-unavailable", "host-internal-error"],
            },
        ],
    },
    StandardShellCapability {
        id: "diagnostics",
        operations: &[StandardShellOperation {
            id: "rendererEntryProbe",
            command: "nimi.shell.diagnostics.rendererEntryProbe",
            negative_states: &["capability-unavailable", "invalid-payload"],
        }],
    },
    StandardShellCapability {
        id: "data",
        operations: &[StandardShellOperation {
            id: "pathResolve",
            command: "nimi.shell.data.pathResolve",
            negative_states: &["capability-unavailable", "invalid-path"],
        }],
    },
    StandardShellCapability {
        id: "storage",
        operations: &[
            StandardShellOperation {
                id: "readJson",
                command: "nimi.shell.storage.readJson",
                negative_states: &["capability-unavailable", "invalid-path", "not-found"],
            },
            StandardShellOperation {
                id: "writeJson",
                command: "nimi.shell.storage.writeJson",
                negative_states: &["capability-unavailable", "invalid-path", "invalid-payload"],
            },
        ],
    },
    StandardShellCapability {
        id: "config",
        operations: &[
            StandardShellOperation {
                id: "get",
                command: "nimi.shell.config.get",
                negative_states: &["capability-unavailable", "not-found"],
            },
            StandardShellOperation {
                id: "set",
                command: "nimi.shell.config.set",
                negative_states: &[
                    "external-daemon-required",
                    "capability-unavailable",
                    "invalid-payload",
                ],
            },
        ],
    },
    StandardShellCapability {
        id: "local-assets",
        operations: &[StandardShellOperation {
            id: "resolveUrl",
            command: "nimi.shell.localAssets.resolveUrl",
            negative_states: &["capability-unavailable", "invalid-path", "not-found"],
        }],
    },
    StandardShellCapability {
        id: "local-agent",
        operations: &[
            StandardShellOperation {
                id: "identity",
                command: "nimi.shell.localAgent.identity",
                negative_states: &["capability-unavailable"],
            },
            StandardShellOperation {
                id: "runtimeTrustedCaller",
                command: "nimi.shell.localAgent.runtimeTrustedCaller",
                negative_states: &["capability-unavailable", "forbidden-renderer-access"],
            },
        ],
    },
    StandardShellCapability {
        id: "ai-profile",
        operations: &[StandardShellOperation {
            id: "get",
            command: "nimi.shell.aiProfile.get",
            negative_states: &["capability-unavailable", "not-found"],
        }],
    },
    StandardShellCapability {
        id: "ai-config",
        operations: &[
            StandardShellOperation {
                id: "get",
                command: "nimi.shell.aiConfig.get",
                negative_states: &["capability-unavailable", "not-found"],
            },
            StandardShellOperation {
                id: "set",
                command: "nimi.shell.aiConfig.set",
                negative_states: &["capability-unavailable", "invalid-payload"],
            },
        ],
    },
    StandardShellCapability {
        id: "avatar",
        operations: &[StandardShellOperation {
            id: "assetResolve",
            command: "nimi.shell.avatar.assetResolve",
            negative_states: &["capability-unavailable", "invalid-path", "not-found"],
        }],
    },
    StandardShellCapability {
        id: "platform-projection",
        operations: &[StandardShellOperation {
            id: "get",
            command: "nimi.shell.platformProjection.get",
            negative_states: &["capability-unavailable", "not-found"],
        }],
    },
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardShellErrorEnvelope {
    pub code: String,
    pub reason_code: String,
    pub action_hint: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

pub fn standard_shell_error(
    code: &str,
    reason_code: &str,
    action_hint: &str,
    source: &str,
    details: Option<Value>,
) -> String {
    let envelope = StandardShellErrorEnvelope {
        code: code.trim().to_string(),
        reason_code: reason_code.trim().to_string(),
        action_hint: action_hint.trim().to_string(),
        source: source.trim().to_string(),
        details,
    };
    serde_json::to_string(&envelope).unwrap_or_else(|_| {
        "{\"code\":\"host-internal-error\",\"reasonCode\":\"standard-shell-error-serialization-failed\",\"actionHint\":\"Check host logs.\",\"source\":\"tauri\"}".to_string()
    })
}

pub mod runtime {
    pub use crate::runtime_bridge::{
        bridge_error, build_unary_payload, build_unary_payload_with_metadata,
        channel_invalidation_count, current_daemon_status, current_daemon_status_async,
        decode_unary_result, generated, generated_method_ids, http_addr, invoke_unary_typed,
        invoke_unary_typed_with_metadata, is_allowlisted_method, is_stream_method,
        reset_channel_invalidation_count, restart_daemon_async, set_runtime_bridge_host_hooks,
        start_daemon_async, stop_daemon, stop_daemon_async, stream_event_name_with_namespace,
        RuntimeBridgeConfigSetPayload, RuntimeBridgeDaemonStatus, RuntimeBridgeHostHooks,
        RuntimeBridgeMetadata, RuntimeBridgeStreamClosePayload, RuntimeBridgeStreamOpenPayload,
        RuntimeBridgeStreamOpenResult, RuntimeBridgeUnaryPayload, RuntimeBridgeUnaryResult,
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
}

pub mod storage {
    pub use crate::runtime_app_storage::{canonical_storage_root, scoped_storage_child};
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

pub mod ai_config {
    pub use crate::runtime_ai_config_projection::{
        project_first_run_execution_evidence_to_ai_config_bindings,
        RuntimeAiConfigCapabilityBinding,
    };
}

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

#[cfg(test)]
mod tests {
    use super::{
        standard_shell_error, STANDARD_SHELL_CAPABILITIES, STANDARD_SHELL_CAPABILITY_IDS,
        STANDARD_SHELL_ERROR_CODES,
    };
    use serde_json::Value;

    #[test]
    fn catalog_contains_all_standard_capability_ids() {
        let ids = STANDARD_SHELL_CAPABILITIES
            .iter()
            .map(|capability| capability.id)
            .collect::<Vec<_>>();
        assert_eq!(ids, STANDARD_SHELL_CAPABILITY_IDS);
        assert!(STANDARD_SHELL_ERROR_CODES.contains(&"external-daemon-required"));
    }

    #[test]
    fn runtime_unary_and_stream_have_unavailable_negative_states() {
        let runtime = STANDARD_SHELL_CAPABILITIES
            .iter()
            .find(|capability| capability.id == "runtime")
            .expect("runtime capability");
        for operation_id in ["unary", "streamOpen"] {
            let operation = runtime
                .operations
                .iter()
                .find(|operation| operation.id == operation_id)
                .expect("runtime operation");
            assert!(operation
                .negative_states
                .contains(&"external-daemon-required"));
        }
    }

    #[test]
    fn standard_error_uses_required_envelope_shape() {
        let payload = standard_shell_error(
            "capability-unavailable",
            "host-missing-standard-capability",
            "Install or enable a standard shell host.",
            "tauri",
            None,
        );
        let parsed: Value = serde_json::from_str(payload.as_str()).expect("json");
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("capability-unavailable")
        );
        assert_eq!(
            parsed.get("reasonCode").and_then(Value::as_str),
            Some("host-missing-standard-capability")
        );
        assert_eq!(parsed.get("source").and_then(Value::as_str), Some("tauri"));
    }
}
