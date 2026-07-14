use std::collections::HashMap;

use tonic::Request;

use super::{
    apply_metadata, resolve_trusted_runtime_bridge_metadata, RuntimeBridgeAppSession,
    RuntimeBridgeMetadata, RuntimeBridgeProtectedAccessToken, RuntimeBridgeTrustedMetadata,
};

fn read_metadata(request: &Request<Vec<u8>>, key: &str) -> Option<String> {
    request
        .metadata()
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
}

fn app_metadata(app_id: &str) -> RuntimeBridgeMetadata {
    RuntimeBridgeMetadata {
        app_id: Some(app_id.to_string()),
        ..RuntimeBridgeMetadata::default()
    }
}

fn protected_access_token() -> RuntimeBridgeProtectedAccessToken {
    RuntimeBridgeProtectedAccessToken {
        token_id: "host-protected-token-id".to_string(),
        secret: "host-protected-token-secret".to_string(),
    }
}

fn app_session() -> RuntimeBridgeAppSession {
    RuntimeBridgeAppSession {
        session_id: "host-session-id".to_string(),
        session_token: "host-session-token".to_string(),
    }
}

fn trusted_metadata(app_id: &str) -> RuntimeBridgeTrustedMetadata {
    RuntimeBridgeTrustedMetadata {
        metadata: Some(RuntimeBridgeMetadata {
            app_id: Some(app_id.to_string()),
            participant_id: Some(app_id.to_string()),
            caller_kind: Some("local-first-party-app".to_string()),
            caller_id: Some(format!("{app_id}.local-first-party")),
            surface_id: Some("host.surface".to_string()),
            ..RuntimeBridgeMetadata::default()
        }),
        authorization: Some("Bearer host-token".to_string()),
        protected_access_token: Some(protected_access_token()),
        app_session: Some(app_session()),
    }
}

#[test]
fn trusted_metadata_rejects_renderer_authorization() {
    let error = resolve_trusted_runtime_bridge_metadata(
        None,
        Some("Bearer renderer-token"),
        None,
        None,
        Some(trusted_metadata("nimi.parentos")),
    )
    .expect_err("renderer authorization should fail closed when trusted metadata is enabled");

    assert!(error.contains("RUNTIME_BRIDGE_RENDERER_HOST_OWNED_AUTH_METADATA_FORBIDDEN"));
    assert!(error.contains("authorization"));
}

#[test]
fn trusted_metadata_rejects_renderer_protected_access_and_app_session() {
    let error = resolve_trusted_runtime_bridge_metadata(
        None,
        None,
        Some(&RuntimeBridgeProtectedAccessToken {
            token_id: "renderer-token-id".to_string(),
            secret: "renderer-token-secret".to_string(),
        }),
        None,
        Some(trusted_metadata("nimi.parentos")),
    )
    .expect_err("renderer protected access should fail closed");

    assert!(error.contains("RUNTIME_BRIDGE_RENDERER_HOST_OWNED_AUTH_METADATA_FORBIDDEN"));
    assert!(error.contains("protectedAccessToken"));

    let error = resolve_trusted_runtime_bridge_metadata(
        None,
        None,
        None,
        Some(&RuntimeBridgeAppSession {
            session_id: "renderer-session-id".to_string(),
            session_token: "renderer-session-token".to_string(),
        }),
        Some(trusted_metadata("nimi.parentos")),
    )
    .expect_err("renderer app session should fail closed");

    assert!(error.contains("RUNTIME_BRIDGE_RENDERER_HOST_OWNED_AUTH_METADATA_FORBIDDEN"));
    assert!(error.contains("appSession"));
}

#[test]
fn trusted_metadata_rejects_renderer_identity_fields() {
    let renderer = RuntimeBridgeMetadata {
        app_id: Some("renderer.app".to_string()),
        participant_id: Some("renderer.participant".to_string()),
        caller_kind: Some("renderer-kind".to_string()),
        caller_id: Some("renderer-caller".to_string()),
        ..RuntimeBridgeMetadata::default()
    };

    let error = resolve_trusted_runtime_bridge_metadata(
        Some(&renderer),
        None,
        None,
        None,
        Some(trusted_metadata("nimi.parentos")),
    )
    .expect_err("renderer identity metadata should fail closed");

    assert!(error.contains("RUNTIME_BRIDGE_RENDERER_HOST_OWNED_IDENTITY_METADATA_FORBIDDEN"));
    assert!(error.contains("appId"));
}

#[test]
fn trusted_metadata_merges_host_identity_and_auth_with_renderer_call_metadata() {
    let mut renderer_extra = HashMap::new();
    renderer_extra.insert("x-nimi-renderer-extra".to_string(), "renderer".to_string());
    let renderer = RuntimeBridgeMetadata {
        domain: Some("runtime.renderer".to_string()),
        trace_id: Some("trace-renderer".to_string()),
        idempotency_key: Some("idem-renderer".to_string()),
        surface_id: Some("renderer.surface".to_string()),
        key_source: Some("renderer-key-source".to_string()),
        provider_endpoint: Some("https://runtime.example.test".to_string()),
        extra: Some(renderer_extra),
        ..RuntimeBridgeMetadata::default()
    };
    let mut trusted = trusted_metadata("nimi.parentos");
    if let Some(metadata) = trusted.metadata.as_mut() {
        let mut trusted_extra = HashMap::new();
        trusted_extra.insert("x-nimi-host-extra".to_string(), "host".to_string());
        metadata.domain = Some("runtime.host".to_string());
        metadata.extra = Some(trusted_extra);
    }

    let resolved =
        resolve_trusted_runtime_bridge_metadata(Some(&renderer), None, None, None, Some(trusted))
            .expect("trusted metadata should merge");
    let mut request = Request::new(Vec::<u8>::new());
    apply_metadata(
        &mut request,
        resolved.metadata.as_ref(),
        resolved.authorization.as_deref(),
        resolved.protected_access_token.as_ref(),
        resolved.app_session.as_ref(),
        "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
    )
    .expect("merged metadata should apply");

    assert_eq!(
        read_metadata(&request, "x-nimi-app-id").as_deref(),
        Some("nimi.parentos")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-participant-id").as_deref(),
        Some("nimi.parentos")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-caller-kind").as_deref(),
        Some("local-first-party-app")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-caller-id").as_deref(),
        Some("nimi.parentos.local-first-party")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-domain").as_deref(),
        Some("runtime.renderer")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-surface-id").as_deref(),
        Some("host.surface")
    );
    assert_eq!(
        read_metadata(&request, "authorization").as_deref(),
        Some("Bearer host-token")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-access-token-id").as_deref(),
        Some("host-protected-token-id")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-session-id").as_deref(),
        Some("host-session-id")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-renderer-extra").as_deref(),
        Some("renderer")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-host-extra").as_deref(),
        Some("host")
    );
}

#[test]
fn apply_metadata_requires_explicit_app_identity() {
    let mut request = Request::new(Vec::<u8>::new());
    let error = apply_metadata(
        &mut request,
        None,
        None,
        None,
        None,
        "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
    )
    .expect_err("missing app identity should fail closed");

    assert!(error.contains("RUNTIME_BRIDGE_METADATA_APP_ID_REQUIRED"));
    assert!(read_metadata(&request, "x-nimi-app-id").is_none());
    assert!(read_metadata(&request, "x-nimi-participant-id").is_none());
    assert!(read_metadata(&request, "x-nimi-caller-id").is_none());
}

#[test]
fn apply_metadata_populates_protocol_defaults_from_explicit_app_identity() {
    let mut request = Request::new(Vec::<u8>::new());
    let metadata = app_metadata("app.example");
    apply_metadata(
        &mut request,
        Some(&metadata),
        None,
        None,
        None,
        "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
    )
    .expect("apply metadata defaults");

    assert_eq!(
        read_metadata(&request, "x-nimi-protocol-version").as_deref(),
        Some("1.0.0")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-participant-protocol-version").as_deref(),
        Some("1.0.0")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-domain").as_deref(),
        Some("runtime.rpc")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-caller-kind").as_deref(),
        Some("third-party-app")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-app-id").as_deref(),
        Some("app.example")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-participant-id").as_deref(),
        Some("app.example")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-caller-id").as_deref(),
        Some("app.example")
    );

    let idempotency_key = read_metadata(&request, "x-nimi-idempotency-key")
        .expect("idempotency key should be generated");
    assert!(idempotency_key.starts_with("bridge-"));
}

#[test]
fn apply_metadata_respects_explicit_fields_and_extra_whitelist() {
    let mut extra = HashMap::new();
    extra.insert("x-nimi-extra".to_string(), "allow".to_string());
    extra.insert("authorization".to_string(), "deny".to_string());

    let metadata = RuntimeBridgeMetadata {
        protocol_version: Some("1.0.0".to_string()),
        participant_protocol_version: Some("1.0.0".to_string()),
        participant_id: Some("desktop-core".to_string()),
        domain: Some("runtime.test".to_string()),
        app_id: Some("nimi.desktop".to_string()),
        trace_id: Some("trace-1".to_string()),
        idempotency_key: Some("idem-1".to_string()),
        caller_kind: Some("desktop-core".to_string()),
        caller_id: Some("renderer".to_string()),
        surface_id: Some("settings".to_string()),
        key_source: Some("inline".to_string()),
        provider_endpoint: Some("https://api.example.com/v1".to_string()),
        provider_api_key: Some("secret-token".to_string()),
        extra: Some(extra),
    };

    let mut request = Request::new(Vec::<u8>::new());
    apply_metadata(
        &mut request,
        Some(&metadata),
        Some("Bearer top-level-token"),
        None,
        None,
        "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
    )
    .expect("apply metadata with explicit values");

    assert_eq!(
        read_metadata(&request, "x-nimi-protocol-version").as_deref(),
        Some("1.0.0")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-participant-protocol-version").as_deref(),
        Some("1.0.0")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-participant-id").as_deref(),
        Some("desktop-core")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-domain").as_deref(),
        Some("runtime.test")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-app-id").as_deref(),
        Some("nimi.desktop")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-trace-id").as_deref(),
        Some("trace-1")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-idempotency-key").as_deref(),
        Some("idem-1")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-caller-kind").as_deref(),
        Some("desktop-core")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-caller-id").as_deref(),
        Some("renderer")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-surface-id").as_deref(),
        Some("settings")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-key-source").as_deref(),
        Some("inline")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-provider-endpoint").as_deref(),
        Some("https://api.example.com/v1")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-provider-api-key").as_deref(),
        Some("secret-token")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-extra").as_deref(),
        Some("allow")
    );
    assert_eq!(
        read_metadata(&request, "authorization").as_deref(),
        Some("Bearer top-level-token")
    );
}

#[test]
fn apply_metadata_rejects_unsupported_protocol_version() {
    let metadata = RuntimeBridgeMetadata {
        protocol_version: Some("2.0.0".to_string()),
        ..RuntimeBridgeMetadata::default()
    };

    let mut request = Request::new(Vec::<u8>::new());
    let error = apply_metadata(
        &mut request,
        Some(&metadata),
        None,
        None,
        None,
        "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
    )
    .expect_err("unsupported protocol version should fail");

    assert!(error.contains("RUNTIME_BRIDGE_PROTOCOL_VERSION_UNSUPPORTED"));
}

#[test]
fn apply_metadata_rejects_invalid_extra_value() {
    let mut extra = HashMap::new();
    extra.insert("x-nimi-bad".to_string(), "line1\r\nline2".to_string());

    let metadata = RuntimeBridgeMetadata {
        extra: Some(extra),
        ..app_metadata("app.example")
    };

    let mut request = Request::new(Vec::<u8>::new());
    let error = apply_metadata(
        &mut request,
        Some(&metadata),
        None,
        None,
        None,
        "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
    )
    .expect_err("metadata with invalid header value should fail");

    assert!(error.contains("RUNTIME_BRIDGE_METADATA_INVALID"));
}

#[test]
fn apply_metadata_rejects_reserved_extra_key_override() {
    let mut extra = HashMap::new();
    extra.insert("x-nimi-protocol-version".to_string(), "9.9.9".to_string());

    let metadata = RuntimeBridgeMetadata {
        extra: Some(extra),
        ..app_metadata("app.example")
    };

    let mut request = Request::new(Vec::<u8>::new());
    let error = apply_metadata(
        &mut request,
        Some(&metadata),
        None,
        None,
        None,
        "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
    )
    .expect_err("reserved metadata key override should fail");

    assert!(error.contains("RUNTIME_BRIDGE_METADATA_RESERVED_KEY"));
}

#[test]
fn runtime_bridge_metadata_debug_redacts_provider_api_key() {
    let mut extra = HashMap::new();
    extra.insert(
        "x-nimi-provider-api-key".to_string(),
        "top-secret-value".to_string(),
    );

    let metadata = RuntimeBridgeMetadata {
        provider_api_key: Some("top-secret-value".to_string()),
        extra: Some(extra),
        ..RuntimeBridgeMetadata::default()
    };

    let debug = format!("{:?}", metadata);
    assert!(!debug.contains("top-secret-value"));
    assert!(debug.contains("***REDACTED***"));
}

#[test]
fn apply_metadata_includes_protected_access_token_headers() {
    let mut request = Request::new(Vec::<u8>::new());
    let metadata = app_metadata("app.example");
    let protected_access_token = RuntimeBridgeProtectedAccessToken {
        token_id: "protected-token-id".to_string(),
        secret: "protected-token-secret".to_string(),
    };

    apply_metadata(
        &mut request,
        Some(&metadata),
        None,
        Some(&protected_access_token),
        None,
        "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
    )
    .expect("apply metadata with protected access token");

    assert_eq!(
        read_metadata(&request, "x-nimi-access-token-id").as_deref(),
        Some("protected-token-id")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-access-token-secret").as_deref(),
        Some("protected-token-secret")
    );
}

#[test]
fn apply_metadata_includes_runtime_app_session_headers() {
    let mut request = Request::new(Vec::<u8>::new());
    let metadata = app_metadata("app.example");
    let app_session = RuntimeBridgeAppSession {
        session_id: "runtime-session-id".to_string(),
        session_token: "runtime-session-token".to_string(),
    };

    apply_metadata(
        &mut request,
        Some(&metadata),
        None,
        None,
        Some(&app_session),
        "//nimi.runtime.v1.RuntimeAppService/SendAppMessage",
    )
    .expect("apply metadata with runtime app session");

    assert_eq!(
        read_metadata(&request, "x-nimi-session-id").as_deref(),
        Some("runtime-session-id")
    );
    assert_eq!(
        read_metadata(&request, "x-nimi-session-token").as_deref(),
        Some("runtime-session-token")
    );
}
