use super::app_bootstrap::{
    install_standard_local_agent_host_hooks, resolve_desktop_runtime_trusted_metadata,
};
use super::env_http::load_dotenv_file_preserve_env;
use super::{
    allow_http_request_origin_with_history, allowed_http_origins,
    is_authorized_http_origin_allowed, is_connector_auth_acquisition_request_allowed,
    normalize_http_method, normalize_origin, runtime_defaults, HTTP_REQUEST_RATE_LIMIT_BURST,
    HTTP_REQUEST_RATE_LIMIT_WINDOW,
};
use crate::test_support::with_env;
use reqwest::Url;
use serde_json::Value;
use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

fn run_async<F: std::future::Future<Output = ()>>(future: F) {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("build test runtime")
        .block_on(future);
}

#[test]
fn normalize_origin_keeps_scheme_host_and_default_port() {
    let parsed = Url::parse("https://api.example.com/v1/chat").expect("valid url");
    let origin = normalize_origin(&parsed).expect("origin");
    assert_eq!(origin, "https://api.example.com:443");
}

#[test]
fn normalize_origin_rejects_non_http_scheme() {
    let parsed = Url::parse("file:///tmp/data.txt").expect("valid url");
    let result = normalize_origin(&parsed);
    assert!(result.is_err());
}

#[test]
fn allowed_http_origins_does_not_admit_retired_local_provider_env() {
    with_env(
        &[
            ("NIMI_REALM_URL", Some("https://gateway.nimi.ai/v1")),
            ("NIMI_E2E_FIXTURE_PATH", None),
            (
                "NIMI_LOCAL_PROVIDER_ENDPOINT",
                Some("http://127.0.0.1:1234/v1"),
            ),
            (
                "NIMI_LOCAL_OPENAI_ENDPOINT",
                Some("http://localhost:1234/v1"),
            ),
        ],
        || {
            let origins = allowed_http_origins();
            assert!(origins.contains("https://gateway.nimi.ai:443"));
            assert!(!origins.contains("http://127.0.0.1:1234"));
            assert!(!origins.contains("http://localhost:1234"));
        },
    );
}

#[test]
fn allowed_http_origins_contains_e2e_fixture_runtime_defaults() {
    let fixture_path = std::env::temp_dir().join(format!(
        "nimi-desktop-test-e2e-runtime-defaults-{}.json",
        std::process::id()
    ));
    fs::write(
        &fixture_path,
        r#"{
          "tauriFixture": {
            "runtimeDefaults": {
              "realm": {
                "realmBaseUrl": "http://127.0.0.1:45115",
                "realtimeUrl": "http://127.0.0.1:45115",
                "accessToken": "fixture-token",
                "jwksUrl": "http://127.0.0.1:45115/api/auth/jwks",
                "revocationUrl": "http://127.0.0.1:45115/api/auth/sessions/introspect",
                "jwtIssuer": "http://127.0.0.1:45115",
                "jwtAudience": "nimi-runtime"
              },
              "runtime": {
                "targetType": "",
                "targetAccountId": "",
                "agentId": "agent-e2e-alpha",
                "worldId": "world-e2e-1",
                "userConfirmedUpload": false
              }
            }
          }
        }"#,
    )
    .expect("write fixture manifest");

    let fixture_path_text = fixture_path.to_string_lossy().to_string();
    with_env(
        &[
            ("NIMI_E2E_FIXTURE_PATH", Some(fixture_path_text.as_str())),
            ("NIMI_REALM_URL", Some("http://localhost:3002")),
        ],
        || {
            let origins = allowed_http_origins();
            assert!(origins.contains("http://127.0.0.1:45115"));
            assert!(origins.contains("http://localhost:45115"));
        },
    );

    fs::remove_file(&fixture_path).expect("remove fixture manifest");
}

#[test]
fn runtime_defaults_normalizes_loopback_realm_jwt_fields() {
    with_env(
        &[
            ("NIMI_REALM_URL", Some("http://localhost")),
            ("NIMI_REALM_JWKS_URL", None),
            ("NIMI_REALM_REVOCATION_URL", None),
            ("NIMI_REALM_JWT_ISSUER", None),
        ],
        || {
            let defaults = runtime_defaults().expect("runtime defaults");
            assert_eq!(defaults.realm.realm_base_url, "http://localhost:3002");
            assert_eq!(
                defaults.realm.jwks_url,
                "http://localhost:3002/api/auth/jwks"
            );
            assert_eq!(
                defaults.realm.revocation_url,
                "http://localhost:3002/api/auth/sessions/introspect"
            );
            assert_eq!(defaults.realm.jwt_issuer, "http://localhost:3002");
        },
    );
}

#[test]
fn runtime_defaults_normalizes_explicit_loopback_jwt_overrides() {
    with_env(
        &[
            ("NIMI_REALM_URL", Some("http://localhost")),
            (
                "NIMI_REALM_JWKS_URL",
                Some("http://localhost/api/auth/jwks"),
            ),
            (
                "NIMI_REALM_REVOCATION_URL",
                Some("http://localhost/api/auth/sessions/introspect"),
            ),
            ("NIMI_REALM_JWT_ISSUER", Some("http://localhost")),
        ],
        || {
            let defaults = runtime_defaults().expect("runtime defaults");
            assert_eq!(
                defaults.realm.jwks_url,
                "http://localhost:3002/api/auth/jwks"
            );
            assert_eq!(
                defaults.realm.revocation_url,
                "http://localhost:3002/api/auth/sessions/introspect"
            );
            assert_eq!(defaults.realm.jwt_issuer, "http://localhost:3002");
        },
    );
}

#[test]
fn shared_bridge_ipc_handler_uses_kit_owned_scaffold_macro() {
    let bootstrap_source = include_str!("app_bootstrap.rs");

    assert!(
        bootstrap_source
            .contains("nimi_shell_tauri::nimi_shell_tauri_oauth_runtime_bridge_handler!"),
        "Desktop must consume the Kit-owned scaffold macro for shared shell commands"
    );
    assert!(
        bootstrap_source.contains(
            "@with_runtime_defaults super::defaults_and_commands::runtime_defaults;"
        ),
        "Desktop may pass its E2E-aware runtime defaults wrapper, but command registration stays Kit-owned"
    );

    for hand_registered_shared_command in [
        "crate::oauth_commands::open_external_url",
        "crate::oauth_commands::oauth_token_exchange",
        "crate::oauth_commands::oauth_listen_for_code",
        "crate::session_logging::log_renderer_event",
        "runtime_bridge::runtime_bridge_unary",
        "runtime_bridge::runtime_bridge_stream_open",
        "runtime_bridge::runtime_bridge_stream_close",
        "runtime_bridge::runtime_bridge_status",
        "runtime_bridge::runtime_bridge_start",
        "runtime_bridge::runtime_bridge_stop",
        "runtime_bridge::runtime_bridge_restart",
        "runtime_bridge::runtime_bridge_config_get",
        "runtime_bridge::runtime_bridge_config_set",
        "super::defaults_and_commands::open_external_url",
        "super::defaults_and_commands::oauth_token_exchange",
        "super::defaults_and_commands::oauth_listen_for_code",
        "super::defaults_and_commands::window_and_logs::log_renderer_event",
    ] {
        assert!(
            !bootstrap_source.contains(hand_registered_shared_command),
            "shared bridge IPC command must be registered through Kit scaffold macro: {hand_registered_shared_command}"
        );
    }
}

#[test]
fn standard_local_agent_hooks_project_desktop_runtime_trusted_caller_without_identity() {
    install_standard_local_agent_host_hooks();

    let caller = nimi_shell_tauri::capabilities::local_agent::local_agent_runtime_trusted_caller(
        serde_json::json!({}),
    )
    .expect("runtime trusted caller");

    assert_eq!(caller.app_id, "nimi.desktop");
    assert_eq!(caller.app_instance_id, "nimi.desktop.local-first-party");
    assert_eq!(caller.device_id, "desktop-shell");
    assert_eq!(caller.mode, 2);
    assert!(
        nimi_shell_tauri::capabilities::local_agent::local_agent_identity().is_err(),
        "Desktop Tauri must not fabricate local-agent identity when Electron keeps it unbound"
    );
}

#[test]
fn desktop_tauri_stamps_host_identity_on_runtime_registration_before_account_bootstrap() {
    let caller = nimi_shell_tauri::capabilities::desktop_product_local_agent::desktop_shell_runtime_account_caller(
        "nimi.desktop",
    )
    .expect("desktop caller");
    let session = nimi_shell_tauri::capabilities::runtime::RuntimeBridgeHostAppSessionProvider::new(
        nimi_shell_tauri::capabilities::runtime::RuntimeBridgeHostAppSessionConfig::desktop_shell(
            &caller.app_id,
            &caller.app_instance_id,
            &caller.device_id,
            Vec::new(),
        )
        .expect("desktop session config"),
    )
    .expect("desktop session provider");

    run_async(async move {
        let trusted = resolve_desktop_runtime_trusted_metadata(
            nimi_shell_tauri::capabilities::runtime::RuntimeBridgeTrustedMetadataRequest {
                method_id: nimi_shell_tauri::capabilities::runtime::RUNTIME_AUTH_REGISTER_APP_METHOD_ID
                    .to_string(),
                bridge_kind: nimi_shell_tauri::capabilities::runtime::RuntimeBridgeTrustedMetadataBridgeKind::Unary,
            },
            caller.clone(),
            session,
        )
        .await
        .expect("trusted metadata")
        .expect("desktop host identity");

        let metadata = trusted.metadata.expect("desktop metadata");
        assert_eq!(metadata.app_id.as_deref(), Some("nimi.desktop"));
        assert_eq!(metadata.participant_id.as_deref(), Some("nimi.desktop"));
        assert_eq!(metadata.caller_kind.as_deref(), Some("desktop-shell"));
        assert_eq!(
            metadata.caller_id.as_deref(),
            Some(caller.app_instance_id.as_str())
        );
        assert!(
            trusted.app_session.is_none(),
            "Runtime registration must receive host identity before an app session exists"
        );
    });
}

#[test]
fn renderer_page_load_probe_is_kit_owned_scaffold() {
    let bootstrap_source = include_str!("app_bootstrap.rs");

    assert!(
        bootstrap_source.contains("build_renderer_entry_probe_script"),
        "Desktop must consume the Kit-owned renderer entry probe builder"
    );
    assert!(
        bootstrap_source.contains("RendererEntryProbeScriptConfig"),
        "Desktop may configure smoke command names, but the probe script shape stays Kit-owned"
    );
    assert!(
        bootstrap_source.contains("desktop_macos_smoke_ping"),
        "Desktop keeps product-specific macOS smoke command wiring"
    );
    assert!(
        !bootstrap_source.contains("globalRecord.__TAURI__?.core?.invoke"),
        "Desktop must not handwrite Tauri global probe script internals"
    );
    assert!(
        !bootstrap_source.contains("return import(scriptSrc);"),
        "Desktop must not own renderer dynamic-import probe orchestration"
    );
}

#[test]
fn http_request_rate_limit_enforces_burst_and_prunes_old_entries() {
    let mut history = VecDeque::new();
    for i in 0..HTTP_REQUEST_RATE_LIMIT_BURST {
        assert!(allow_http_request_origin_with_history(
            &mut history,
            Duration::from_millis(i as u64),
        ));
    }
    assert!(!allow_http_request_origin_with_history(
        &mut history,
        Duration::from_secs(1),
    ));
    assert!(allow_http_request_origin_with_history(
        &mut history,
        HTTP_REQUEST_RATE_LIMIT_WINDOW + Duration::from_secs(1),
    ));
}

#[test]
fn connector_auth_acquisition_policy_only_allows_exact_profile_endpoints() {
    let device_authorization =
        Url::parse("https://auth.openai.com/api/accounts/deviceauth/usercode").expect("valid url");
    let device_token =
        Url::parse("https://auth.openai.com/api/accounts/deviceauth/token").expect("valid url");
    let foreign = Url::parse("https://api.openai.com/v1/models").expect("valid url");

    assert!(is_connector_auth_acquisition_request_allowed(
        Some("openai_codex"),
        Some("device_authorization"),
        &device_authorization,
        &reqwest::Method::POST,
    ));
    assert!(is_connector_auth_acquisition_request_allowed(
        Some("openai_codex"),
        Some("device_token"),
        &device_token,
        &reqwest::Method::POST,
    ));
    assert!(!is_connector_auth_acquisition_request_allowed(
        Some("openai_codex"),
        Some("device_authorization"),
        &device_authorization,
        &reqwest::Method::GET,
    ));
    assert!(!is_connector_auth_acquisition_request_allowed(
        Some("openai_codex"),
        Some("device_token"),
        &device_authorization,
        &reqwest::Method::POST,
    ));
    assert!(!is_connector_auth_acquisition_request_allowed(
        Some("openai_codex"),
        Some("device_authorization"),
        &foreign,
        &reqwest::Method::POST,
    ));
}

#[test]
fn http_authorization_origin_policy_only_allows_configured_origins() {
    let allowed = allowed_http_origins();
    assert!(is_authorized_http_origin_allowed(
        "http://localhost:3002",
        &allowed
    ));
    assert!(!is_authorized_http_origin_allowed(
        "https://api.openai.com:443",
        &allowed
    ));
    assert!(!is_authorized_http_origin_allowed(
        "http://192.168.31.175:80",
        &allowed
    ));
}

#[test]
fn http_request_rejects_unadmitted_https_without_authorization_before_network() {
    with_env(
        &[
            ("NIMI_REALM_URL", Some("http://localhost:3002")),
            ("NIMI_E2E_FIXTURE_PATH", None),
        ],
        || {
            run_async(async {
                let result =
                    super::defaults_and_commands::http_request(super::HttpRequestPayload {
                        url: "https://api.third-party.example/v1/data".to_string(),
                        method: Some("GET".to_string()),
                        headers: None,
                        authorization: None,
                        body: None,
                        diagnostic_session_id: None,
                        connector_auth_profile_id: None,
                        connector_auth_purpose: None,
                    })
                    .await;

                let error = result.expect_err("request should fail before network dispatch");
                assert!(
                    error.contains("Desktop shell network admission"),
                    "expected shell network admission block, got {error}"
                );
            });
        },
    );
}

#[test]
fn http_request_rejects_authorization_for_unadmitted_https_before_network() {
    with_env(
        &[
            ("NIMI_REALM_URL", Some("http://localhost:3002")),
            ("NIMI_E2E_FIXTURE_PATH", None),
        ],
        || {
            run_async(async {
                let result =
                    super::defaults_and_commands::http_request(super::HttpRequestPayload {
                        url: "https://auth.openai.com/api/accounts/deviceauth/usercode".to_string(),
                        method: Some("POST".to_string()),
                        headers: None,
                        authorization: Some("Bearer must-not-leave-renderer".to_string()),
                        body: Some(r#"{"client_id":"fixture"}"#.to_string()),
                        diagnostic_session_id: None,
                        connector_auth_profile_id: Some("openai_codex".to_string()),
                        connector_auth_purpose: Some("device_authorization".to_string()),
                    })
                    .await;

                let error = result.expect_err("request should fail before network dispatch");
                assert!(
                    error.contains("DESKTOP_HTTP_AUTH_ORIGIN_BLOCKED"),
                    "expected structured auth-origin block, got {error}"
                );
            });
        },
    );
}

#[test]
fn http_send_failure_error_classifies_realm_origin_as_realm_unavailable() {
    with_env(
        &[
            ("NIMI_REALM_URL", Some("http://localhost:3002")),
            ("NIMI_E2E_FIXTURE_PATH", None),
        ],
        || {
            let error = super::env_http::http_send_failure_error(
                "http://127.0.0.1:3002",
                "Realm service is unavailable: connection refused",
            );
            let payload: Value = serde_json::from_str(&error).expect("structured bridge error");
            assert_eq!(payload["reasonCode"], "REALM_UNAVAILABLE");
            assert_eq!(payload["actionHint"], "check_realm_service_status");
            assert_eq!(payload["retryable"], true);
        },
    );
}

#[test]
fn normalize_http_method_returns_structured_error_code() {
    let error = normalize_http_method(Some("TRACE".to_string()))
        .err()
        .expect("invalid method error");
    let payload: Value = serde_json::from_str(error.as_str()).expect("structured error json");
    assert_eq!(
        payload.get("reasonCode").and_then(Value::as_str),
        Some("DESKTOP_HTTP_METHOD_INVALID"),
    );
}

#[test]
fn dotenv_loader_preserves_explicit_runtime_bridge_mode() {
    let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("test-runtime-bridge.env");
    fs::write(
        &fixture_path,
        "NIMI_RUNTIME_BRIDGE_MODE=RUNTIME\nNIMI_REALM_URL=http://localhost:3002\n",
    )
    .expect("write fixture env");

    with_env(
        &[
            ("NIMI_RUNTIME_BRIDGE_MODE", Some("RELEASE")),
            ("NIMI_REALM_URL", None),
        ],
        || {
            load_dotenv_file_preserve_env(&fixture_path).expect("load dotenv");
            assert_eq!(
                std::env::var("NIMI_RUNTIME_BRIDGE_MODE").ok().as_deref(),
                Some("RELEASE"),
            );
            assert_eq!(
                std::env::var("NIMI_REALM_URL").ok().as_deref(),
                Some("http://localhost:3002"),
            );
        },
    );

    fs::remove_file(&fixture_path).expect("remove fixture env");
}
