use super::{
    allow_http_request_origin_with_history, allowed_http_origins, is_private_lan_http_origin,
    normalize_http_method, normalize_origin, normalize_runtime_config_page_id, runtime_defaults,
    validate_external_url, HTTP_REQUEST_RATE_LIMIT_BURST, HTTP_REQUEST_RATE_LIMIT_WINDOW,
};
use crate::test_support::with_env;
use reqwest::Url;
use serde_json::Value;
use std::collections::VecDeque;
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
fn allowed_http_origins_contains_runtime_defaults() {
    with_env(
        &[
            ("NIMI_REALM_URL", Some("https://gateway.nimi.xyz/v1")),
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
            assert!(origins.contains("https://gateway.nimi.xyz:443"));
            assert!(origins.contains("http://127.0.0.1:1234"));
            assert!(origins.contains("http://localhost:1234"));
        },
    );
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
                "http://localhost:3002/api/auth/revocation"
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
                Some("http://localhost/api/auth/revocation"),
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
                "http://localhost:3002/api/auth/revocation"
            );
            assert_eq!(defaults.realm.jwt_issuer, "http://localhost:3002");
        },
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
    assert_eq!(
        normalize_runtime_config_page_id(Some("mod-developer")),
        Some("mod-developer"),
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
fn validate_external_url_returns_structured_error_code() {
    let url = Url::parse("ftp://example.com/asset").expect("valid ftp url");
    let error = validate_external_url(&url)
        .err()
        .expect("invalid external url error");
    let payload: Value = serde_json::from_str(error.as_str()).expect("structured error json");
    assert_eq!(
        payload.get("reasonCode").and_then(Value::as_str),
        Some("DESKTOP_HTTP_URL_SCHEME_INVALID"),
    );
}
