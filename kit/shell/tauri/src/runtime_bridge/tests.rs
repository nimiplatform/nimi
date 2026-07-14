use std::sync::Arc;

use base64::Engine;
use prost::Message;

use super::{
    channel_invalidation_count, current_daemon_status, invoke_unary_typed_with_metadata,
    is_allowlisted_method, is_stream_method, reset_channel_invalidation_count,
    restart_daemon_async, runtime_account_session_status, runtime_bridge_unary, start_daemon_async,
    stream_event_name_with_namespace, with_runtime_bridge_host_hooks,
    with_runtime_bridge_host_hooks_async, RuntimeBridgeAppSession, RuntimeBridgeHostHooks,
    RuntimeBridgeMetadata, RuntimeBridgeProtectedAccessToken, RuntimeBridgeTrustedMetadata,
    RuntimeBridgeTrustedMetadataBridgeKind, RuntimeBridgeUnaryPayload, RuntimeBridgeUnaryResult,
    DEFAULT_EVENT_NAMESPACE, RUNTIME_APP_GET_APP_STORAGE_METHOD_ID,
};

#[tokio::test]
async fn protected_account_status_fails_closed_without_host_identity() {
    let error = with_runtime_bridge_host_hooks_async(RuntimeBridgeHostHooks::default(), || async {
        runtime_account_session_status().await
    })
    .await
    .expect_err("account status without native host identity must fail closed");
    assert!(error.contains("protected-carrier-required"));
}

#[test]
fn public_lifecycle_routes_do_not_delegate_to_legacy_daemon_manager() {
    let source = include_str!("mod.rs");
    let legacy_prefix = ["daemon_manager", "::"].concat();
    for operation in [
        "status()",
        "status_async().await",
        "start_async().await",
        "restart_async().await",
        "stop()",
        "stop_async().await",
    ] {
        assert!(
            !source.contains(&[legacy_prefix.as_str(), operation].concat()),
            "public Runtime lifecycle must use the protected-local service carrier, not {operation}",
        );
    }
}

#[test]
fn public_lifecycle_controls_fail_closed_without_a_verified_runtime() {
    reset_channel_invalidation_count();

    for result in [
        tauri::async_runtime::block_on(start_daemon_async()),
        tauri::async_runtime::block_on(restart_daemon_async()),
    ] {
        let error = result.expect_err("unbound protected carrier must fail closed");
        assert!(error.contains("RUNTIME_BRIDGE_DAEMON_UNAVAILABLE"));
        assert!(
            error.contains("protected-carrier-required")
                || error.contains("runtime-service-unavailable")
                || error.contains("runtime-service-untrusted")
        );
    }

    assert_eq!(channel_invalidation_count(), 0);
    let status = current_daemon_status();
    assert!(!status.running);
    assert!(!status.managed);
    assert_eq!(status.launch_mode, "INVALID");
    let last_error = status.last_error.as_deref().unwrap_or_default();
    assert!(
        last_error.contains("protected-carrier-required")
            || last_error.contains("runtime-service-unavailable")
            || last_error.contains("runtime-service-untrusted")
    );
}

#[test]
fn stream_event_name_uses_fixed_namespace() {
    assert_eq!(
        stream_event_name_with_namespace(DEFAULT_EVENT_NAMESPACE, "stream-1"),
        "runtime_bridge:stream:stream-1"
    );
}

#[test]
fn stream_event_name_uses_custom_namespace_when_provided() {
    assert_eq!(
        stream_event_name_with_namespace("custom_runtime", "stream-2"),
        "custom_runtime:stream:stream-2"
    );
}

#[test]
fn stream_methods_are_allowlisted() {
    let stream_method = "/nimi.runtime.v1.RuntimeAiService/StreamScenario";
    assert!(is_stream_method(stream_method));
    assert!(is_allowlisted_method(stream_method));
}

#[test]
fn custom_agent_anchor_methods_are_allowlisted() {
    let open_method = "/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor";
    let get_method = "/nimi.runtime.v1.RuntimeAgentService/GetConversationAnchorSnapshot";
    assert!(!is_stream_method(open_method));
    assert!(!is_stream_method(get_method));
    assert!(is_allowlisted_method(open_method));
    assert!(is_allowlisted_method(get_method));
}

#[test]
fn unknown_method_is_rejected() {
    let unknown = "/nimi.runtime.v1.RuntimeAiService/NotExists";
    assert!(!is_stream_method(unknown));
    assert!(!is_allowlisted_method(unknown));
}

#[test]
fn runtime_bridge_unary_applies_trusted_metadata_before_override() {
    let payload = RuntimeBridgeUnaryPayload {
        method_id: RUNTIME_APP_GET_APP_STORAGE_METHOD_ID.to_string(),
        request_bytes_base64: String::new(),
        metadata: Some(RuntimeBridgeMetadata {
            surface_id: Some("renderer.surface".to_string()),
            ..RuntimeBridgeMetadata::default()
        }),
        authorization: None,
        protected_access_token: None,
        app_session: None,
        timeout_ms: None,
    };
    let hooks = RuntimeBridgeHostHooks {
        trusted_metadata: Some(Arc::new(|request| {
            Box::pin(async move {
                assert_eq!(request.method_id, RUNTIME_APP_GET_APP_STORAGE_METHOD_ID);
                assert_eq!(
                    request.bridge_kind,
                    RuntimeBridgeTrustedMetadataBridgeKind::Unary
                );
                Ok(Some(RuntimeBridgeTrustedMetadata {
                    metadata: Some(RuntimeBridgeMetadata {
                        app_id: Some("nimi.parentos".to_string()),
                        participant_id: Some("nimi.parentos".to_string()),
                        caller_kind: Some("local-first-party-app".to_string()),
                        caller_id: Some("nimi.parentos.local-first-party".to_string()),
                        surface_id: Some("host.surface".to_string()),
                        ..RuntimeBridgeMetadata::default()
                    }),
                    authorization: Some("Bearer host-token".to_string()),
                    protected_access_token: Some(RuntimeBridgeProtectedAccessToken {
                        token_id: "host-token-id".to_string(),
                        secret: "host-token-secret".to_string(),
                    }),
                    app_session: Some(RuntimeBridgeAppSession {
                        session_id: "host-session-id".to_string(),
                        session_token: "host-session-token".to_string(),
                    }),
                }))
            })
        })),
        unary_override: Some(Arc::new(|payload| {
            let metadata = payload.metadata.as_ref().expect("trusted metadata");
            assert_eq!(metadata.app_id.as_deref(), Some("nimi.parentos"));
            assert_eq!(
                metadata.caller_id.as_deref(),
                Some("nimi.parentos.local-first-party")
            );
            assert_eq!(metadata.surface_id.as_deref(), Some("host.surface"));
            assert_eq!(payload.authorization.as_deref(), Some("Bearer host-token"));
            assert_eq!(
                payload
                    .protected_access_token
                    .as_ref()
                    .map(|token| token.token_id.as_str()),
                Some("host-token-id")
            );
            assert_eq!(
                payload
                    .app_session
                    .as_ref()
                    .map(|session| session.session_id.as_str()),
                Some("host-session-id")
            );
            Ok(Some(RuntimeBridgeUnaryResult {
                response_bytes_base64: String::new(),
                response_metadata: None,
            }))
        })),
        ..RuntimeBridgeHostHooks::default()
    };

    let result = with_runtime_bridge_host_hooks(hooks, || {
        tauri::async_runtime::block_on(runtime_bridge_unary(payload))
    })
    .expect("runtime bridge should return override result");

    assert_eq!(result.response_bytes_base64, "");
}

#[test]
fn host_typed_unary_metadata_bypasses_renderer_trusted_metadata_hook_before_override() {
    let response = super::generated::GetAppStorageResponse::default();
    let response_bytes_base64 =
        base64::engine::general_purpose::STANDARD.encode(response.encode_to_vec());
    let hooks = RuntimeBridgeHostHooks {
        trusted_metadata: Some(Arc::new(|_| {
            Box::pin(async {
                Err(
                    "renderer trusted metadata hook must not run for a Rust host-internal call"
                        .to_string(),
                )
            })
        })),
        unary_override: Some(Arc::new(move |payload| {
            let metadata = payload.metadata.as_ref().expect("host metadata");
            assert_eq!(metadata.app_id.as_deref(), Some("nimi.desktop"));
            assert_eq!(metadata.caller_kind.as_deref(), Some("desktop-shell"));
            Ok(Some(RuntimeBridgeUnaryResult {
                response_bytes_base64: response_bytes_base64.clone(),
                response_metadata: None,
            }))
        })),
        ..RuntimeBridgeHostHooks::default()
    };

    let result = with_runtime_bridge_host_hooks(hooks, || {
        tauri::async_runtime::block_on(invoke_unary_typed_with_metadata::<
            super::generated::GetAppStorageRequest,
            super::generated::GetAppStorageResponse,
        >(
            RUNTIME_APP_GET_APP_STORAGE_METHOD_ID,
            super::generated::GetAppStorageRequest::default(),
            RuntimeBridgeMetadata {
                app_id: Some("nimi.desktop".to_string()),
                caller_kind: Some("desktop-shell".to_string()),
                caller_id: Some("nimi.desktop.product-control".to_string()),
                ..RuntimeBridgeMetadata::default()
            },
            None,
        ))
    });

    assert!(result.is_ok(), "host typed call failed: {result:?}");
}

#[test]
fn first_run_ready_admission_resolve_methods_are_not_publicly_allowlisted() {
    // P-COLD-016 product ready admission steps 5 and 7 consume these two
    // RuntimeLocalService RPCs only through the protected desktop transport.
    // The ordinary Runtime bridge must never admit them.
    let baseline = "/nimi.runtime.v1.RuntimeLocalService/ResolveRuntimeBaselineReadiness";
    let execution = "/nimi.runtime.v1.RuntimeLocalService/ResolveFirstRunExecutionEvidence";
    assert!(!is_allowlisted_method(baseline));
    assert!(!is_allowlisted_method(execution));
    // Both are unary resolve calls, not streams.
    assert!(!is_stream_method(baseline));
    assert!(!is_stream_method(execution));
}

#[test]
fn account_presence_verification_is_not_exposed_through_generic_bridge() {
    let method = "/nimi.runtime.v1.RuntimeAccountService/RequestPresenceVerification";

    assert!(!is_allowlisted_method(method));
    assert!(!is_stream_method(method));
}

#[test]
fn immutable_package_positive_methods_are_not_exposed_through_generic_bridge() {
    for method in [
        "/nimi.runtime.v1.RuntimeAppService/PrepareAppLifecycleIntent",
        "/nimi.runtime.v1.RuntimeAppService/GetAppLifecycleIntentStatus",
        "/nimi.runtime.v1.RuntimeAppService/InstallApp",
        "/nimi.runtime.v1.RuntimeAppService/UninstallApp",
        "/nimi.runtime.v1.RuntimeAppService/GetAppInstallJob",
        "/nimi.runtime.v1.RuntimeAppService/ListAppInstallJobs",
        "/nimi.runtime.v1.RuntimeAppService/WatchAppInstallJobEvents",
        "/nimi.runtime.v1.RuntimeAppService/UpdateApp",
        "/nimi.runtime.v1.RuntimeAppService/HealthRepairApp",
    ] {
        assert!(
            !is_allowlisted_method(method),
            "{method} must remain unavailable before 0P"
        );
        assert!(
            !is_stream_method(method),
            "{method} must not expose a stream before 0P"
        );
    }

    assert!(
        is_allowlisted_method("/nimi.runtime.v1.RuntimeAppService/GetAppPackageReadiness"),
        "the frozen 0K readiness seam remains callable only for a typed unavailable response",
    );
}
