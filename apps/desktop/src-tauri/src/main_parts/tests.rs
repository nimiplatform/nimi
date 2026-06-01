use super::env_http::load_dotenv_file_preserve_env;
use super::{
    allow_http_request_origin_with_history, allowed_http_origins, is_private_lan_http_origin,
    normalize_http_method, normalize_origin, normalize_runtime_config_page_id, runtime_defaults,
    HTTP_REQUEST_RATE_LIMIT_BURST, HTTP_REQUEST_RATE_LIMIT_WINDOW,
};
use crate::test_support::with_env;
use reqwest::Url;
use serde_json::Value;
use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

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
            .contains("nimi_shell_tauri::nimi_shell_tauri_auth_oauth_runtime_bridge_handler!"),
        "Desktop must consume the Kit-owned scaffold macro for shared shell commands"
    );
    assert!(
        bootstrap_source.contains(
            "@with_runtime_defaults super::defaults_and_commands::runtime_defaults;"
        ),
        "Desktop may pass its E2E-aware runtime defaults wrapper, but command registration stays Kit-owned"
    );

    for hand_registered_shared_command in [
        "crate::auth_session_commands::auth_session_load",
        "crate::auth_session_commands::auth_session_save",
        "crate::auth_session_commands::auth_session_clear",
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
fn private_lan_http_origin_allows_common_ipv4_ranges() {
    let a = Url::parse("http://192.168.31.175/api/human/me").expect("valid url");
    let b = Url::parse("http://10.0.0.22:8080/healthz").expect("valid url");
    let c = Url::parse("http://172.16.5.9:3002/api").expect("valid url");
    let d = Url::parse("http://172.31.255.10:9000/api").expect("valid url");
    let e = Url::parse("http://172.32.0.1:3002/api").expect("valid url");
    let f = Url::parse("http://8.8.8.8:80/").expect("valid url");

    assert!(is_private_lan_http_origin(&a));
    assert!(is_private_lan_http_origin(&b));
    assert!(is_private_lan_http_origin(&c));
    assert!(is_private_lan_http_origin(&d));
    assert!(!is_private_lan_http_origin(&e));
    assert!(!is_private_lan_http_origin(&f));
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
fn runtime_config_deep_links_only_accept_known_pages() {
    assert_eq!(normalize_runtime_config_page_id(None), Some("overview"));
    assert_eq!(normalize_runtime_config_page_id(Some("")), Some("overview"));
    assert_eq!(
        normalize_runtime_config_page_id(Some("runtime")),
        Some("runtime")
    );
    assert_eq!(
        normalize_runtime_config_page_id(Some("data-management")),
        Some("data-management"),
    );
    assert_eq!(normalize_runtime_config_page_id(Some("mods")), None);
    assert_eq!(
        normalize_runtime_config_page_id(Some("mod-developer")),
        None
    );
    assert_eq!(normalize_runtime_config_page_id(Some("danger-zone")), None);
    assert_eq!(normalize_runtime_config_page_id(Some("../runtime")), None);
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
