use super::{
    compose_envelope_for_source, normalize_endpoint, project_bridge_result, rejected,
    validate_request_id,
};
use serde_json::json;

#[derive(Debug, serde::Deserialize)]
struct GoldenVectorTable {
    accepted: Option<Vec<AcceptedGoldenVector>>,
    rejected: Option<Vec<RejectedGoldenVector>>,
}

#[derive(Debug, serde::Deserialize)]
struct AcceptedGoldenVector {
    id: String,
    envelope: serde_json::Value,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RejectedGoldenVector {
    id: String,
    reason_code: String,
}

#[test]
fn endpoint_accepts_exact_loopback_origins_only() {
    assert_eq!(
        normalize_endpoint("http://127.0.0.1:4500").expect("loopback"),
        "http://127.0.0.1:4500",
    );
    assert_eq!(
        normalize_endpoint("http://[::1]:4500").expect("ipv6 loopback"),
        "http://[::1]:4500",
    );
    assert!(normalize_endpoint("http://localhost:4500").is_err());
    assert!(normalize_endpoint("http://0.0.0.0:4500").is_err());
    assert!(normalize_endpoint("http://127.0.0.1:4500/v1/open-intent").is_err());
    assert!(normalize_endpoint("http://user:pass@127.0.0.1:4500").is_err()); // pragma: allowlist secret -- rejected placeholder credentials
    assert!(normalize_endpoint("http://user:pass@[::1]:4500").is_err()); // pragma: allowlist secret -- rejected placeholder credentials
}

#[test]
fn request_id_requires_desktop_open_prefix() {
    assert_eq!(
        validate_request_id("desktop-open-tauri-test").expect("request id"),
        "desktop-open-tauri-test",
    );
    assert!(validate_request_id("tauri-test").is_err());
    assert!(validate_request_id("desktop-open--tauri-test").is_err());
}

#[test]
fn renderer_request_rejects_invalid_intent_before_descriptor_io() {
    let result = compose_envelope_for_source(
        "nimi.tauri",
        json!({
            "intent": {
                "kind": "open-explore",
                "section": "worlds",
                "productIntent": "select-partner"
            }
        }),
    );

    assert!(result.is_err());
}

#[test]
fn renderer_request_preserves_unsupported_target_reason_code_before_descriptor_io() {
    let result = compose_envelope_for_source(
        "nimi.tauri",
        json!({
            "intent": {
                "kind": "open-explore",
                "section": "worlds",
                "productIntent": "select-partner"
            }
        }),
    );

    let error = result.expect_err("unsupported target must reject before descriptor IO");
    assert_eq!(error.reason_code(), "desktop-open-target-unsupported");
}

#[test]
fn source_app_and_app_id_use_canonical_nimi_app_id_grammar() {
    let accepted = compose_envelope_for_source(
        "1P.NIMI9",
        json!({
            "intent": {
                "kind": "open-apps",
                "appId": "9app.plugin-2"
            }
        }),
    )
    .expect("canonical app ids should parse");
    assert_eq!(accepted["sourceApp"], "1p.nimi9");
    assert_eq!(accepted["intent"]["appId"], "9app.plugin-2");

    assert!(
        compose_envelope_for_source("nimi.bad-", json!({ "intent": { "kind": "open-apps" } }),)
            .is_err()
    );
    assert!(compose_envelope_for_source(
        "nimi.tauri",
        json!({ "intent": { "kind": "open-apps", "appId": "nimi..bad" } }),
    )
    .is_err());
}

#[test]
fn tauri_identifier_maps_to_canonical_source_app() {
    let accepted = compose_envelope_for_source(
        "ai.nimi.apps.nimi.desktop",
        json!({
            "intent": {
                "kind": "open-apps"
            }
        }),
    )
    .expect("tauri identifier should resolve to canonical app id");

    assert_eq!(accepted["sourceApp"], "nimi.desktop");
}

#[test]
fn query_length_counts_unicode_scalar_values() {
    let admitted_query = "😀".repeat(160);
    let accepted = compose_envelope_for_source(
        "nimi.tauri",
        json!({
            "intent": {
                "kind": "open-explore",
                "section": "personas",
                "query": admitted_query,
            }
        }),
    )
    .expect("160 Unicode scalar values should parse");
    assert_eq!(accepted["intent"]["kind"], "open-explore");

    let error = compose_envelope_for_source(
        "nimi.tauri",
        json!({
            "intent": {
                "kind": "open-explore",
                "section": "personas",
                "query": "😀".repeat(161),
            }
        }),
    )
    .expect_err("161 Unicode scalar values must fail closed");
    assert_eq!(error.reason_code(), "desktop-open-intent-invalid");
}

#[test]
fn standard_desktop_open_golden_vectors_match_platform_table() {
    let vectors = read_golden_vectors();

    for vector in vectors.accepted.unwrap_or_default() {
        let envelope = vector
            .envelope
            .as_object()
            .unwrap_or_else(|| panic!("{} accepted vector envelope must be an object", vector.id));
        let payload = json!({
            "requestId": envelope.get("requestId").cloned().unwrap_or_else(|| {
                panic!("{} accepted vector missing requestId", vector.id)
            }),
            "intent": envelope.get("intent").cloned().unwrap_or_else(|| {
                panic!("{} accepted vector missing intent", vector.id)
            }),
        });
        let parsed = compose_envelope_for_source("ai.nimi.apps.nimi.tauri", payload)
            .unwrap_or_else(|error| panic!("{} should parse but failed: {:?}", vector.id, error));
        assert_eq!(parsed["sourceApp"], "nimi.tauri", "{}", vector.id);
        assert_eq!(
            parsed["intent"],
            envelope.get("intent").expect("accepted intent").clone(),
            "{}",
            vector.id,
        );
    }

    for vector in vectors.rejected.unwrap_or_default() {
        let (source_app, payload) = rejected_golden_case(&vector.id)
            .unwrap_or_else(|| panic!("{} has executable Tauri coverage", vector.id));
        let error = compose_envelope_for_source(source_app, payload)
            .expect_err("rejected vector must fail closed");
        assert_eq!(
            error.reason_code(),
            vector.reason_code,
            "{} rejected with stable reason code",
            vector.id,
        );
    }
}

#[test]
fn standard_desktop_open_apps_section_requires_an_app_and_exact_section() {
    let missing_app = compose_envelope_for_source(
        "nimi.tauri",
        json!({ "intent": { "kind": "open-apps", "section": "ai-models" } }),
    )
    .expect_err("an Apps section without appId must fail closed");
    assert_eq!(missing_app.reason_code(), "desktop-open-intent-invalid");

    let unsupported_section = compose_envelope_for_source(
        "nimi.tauri",
        json!({
            "intent": {
                "kind": "open-apps",
                "appId": "nimi.example",
                "section": "access",
            }
        }),
    )
    .expect_err("only the AI models Apps section is admitted");
    assert_eq!(
        unsupported_section.reason_code(),
        "desktop-open-target-unsupported"
    );
}

fn read_golden_vectors() -> GoldenVectorTable {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../scripts/testdata/desktop-open-intent-golden-vectors.yaml");
    serde_yaml::from_str(
        &std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display())),
    )
    .unwrap_or_else(|error| panic!("failed to parse {}: {error}", path.display()))
}

fn rejected_golden_case(id: &str) -> Option<(&'static str, serde_json::Value)> {
    Some(match id {
        "source-app-missing" => (
            "",
            json!({ "intent": { "kind": "open-settings", "section": "profile" } }),
        ),
        "unknown-field-authorization" => (
            "nimi.tauri",
            json!({
                "authorization": "secret",
                "intent": { "kind": "open-settings", "section": "profile" },
            }),
        ),
        "unknown-target" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-developer-tools" } }),
        ),
        "invalid-runtime-action-page-pair" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-runtime-config", "page": "cloud", "action": "install-model" } }),
        ),
        "invalid-explore-worlds-select-partner-pair" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-explore", "section": "worlds", "productIntent": "select-partner" } }),
        ),
        "invalid-explore-activity-discover-personas-pair" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-explore", "section": "activity", "productIntent": "discover-personas" } }),
        ),
        "invalid-source-host" => (
            "nimi.tauri",
            json!({
                "sourceHost": "unknown-shell",
                "intent": { "kind": "open-settings", "section": "profile" },
            }),
        ),
        "invalid-request-id" => (
            "nimi.tauri",
            json!({
                "requestId": "desktop-open--reject-7b",
                "intent": { "kind": "open-settings", "section": "profile" },
            }),
        ),
        "invalid-app-id" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-apps", "appId": "Nimi.Bad" } }),
        ),
        "invalid-query-too-long" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-explore", "section": "personas", "query": "x".repeat(161) } }),
        ),
        "developer-tools-settings-target-v1" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-settings", "section": "developer-tools" } }),
        ),
        "agent-center-target-v1" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-agents", "view": "agent-center" } }),
        ),
        "agent-center-local-agent-ref-v1" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-agents", "view": "agent-center", "localAgentRef": "agent-local-1" } }),
        ),
        "runtime-profiles-manage-profile-v1" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-runtime-config", "page": "profiles", "action": "manage-profile" } }),
        ),
        "runtime-advanced-inspect-runtime-v1" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-runtime-config", "page": "advanced", "action": "inspect-runtime" } }),
        ),
        "os-scheme-url" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-url", "url": format!("{}{}", "nimi-desktop", "://runtime-config/cloud") } }),
        ),
        "raw-url-payload" => (
            "nimi.tauri",
            json!({ "url": "http://127.0.0.1:1/v1/open-intent" }),
        ),
        "renderer-provided-source-app" => (
            "nimi.tauri",
            json!({ "sourceApp": "nimi.spoof", "intent": { "kind": "open-apps" } }),
        ),
        "provider-model-credential-fields" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-runtime-config", "page": "models", "action": "install-model", "providerApiKey": "secret" } }),
        ),
        _ => return None,
    })
}

#[test]
fn result_mapping_rejects_malformed_accepted_result() {
    assert_eq!(
        project_bridge_result(
            json!({
                "status": "accepted",
                "confirmation": "desktop-accepted",
                "bridgeId": "desktop-open-bridge-test",
                "requestId": "desktop-open-request-test",
                "appliedTarget": "open-apps",
                "extra": true
            }),
            "desktop-open-bridge-test",
            "desktop-open-request-test",
            "open-apps",
        ),
        rejected("desktop-open-intent-invalid", "fix_desktop_open_intent"),
    );
}

#[test]
fn result_mapping_rejects_accepted_result_mismatched_to_request() {
    assert_eq!(
        project_bridge_result(
            json!({
                "status": "accepted",
                "confirmation": "desktop-accepted",
                "bridgeId": "desktop-open-bridge-test",
                "requestId": "desktop-open-other-request",
                "appliedTarget": "open-apps"
            }),
            "desktop-open-bridge-test",
            "desktop-open-request-test",
            "open-apps",
        ),
        rejected("desktop-open-intent-invalid", "fix_desktop_open_intent"),
    );
    assert_eq!(
        project_bridge_result(
            json!({
                "status": "accepted",
                "confirmation": "desktop-accepted",
                "bridgeId": "desktop-open-bridge-test",
                "requestId": "desktop-open-request-test",
                "appliedTarget": "open-settings"
            }),
            "desktop-open-bridge-test",
            "desktop-open-request-test",
            "open-apps",
        ),
        rejected("desktop-open-intent-invalid", "fix_desktop_open_intent"),
    );
}

#[test]
fn result_mapping_rejects_unknown_reason_codes() {
    assert_eq!(
        project_bridge_result(
            json!({
                "status": "rejected",
                "bridgeId": "desktop-open-bridge-test",
                "reasonCode": "desktop-open-bridge-unavailable",
                "actionHint": "check_desktop_runtime_bridge"
            }),
            "desktop-open-bridge-test",
            "desktop-open-request-test",
            "open-apps",
        ),
        rejected("desktop-open-intent-invalid", "fix_desktop_open_intent"),
    );
}

#[test]
fn result_mapping_strips_bridge_id_from_valid_rejected_result() {
    assert_eq!(
        project_bridge_result(
            json!({
                "status": "rejected",
                "bridgeId": "desktop-open-bridge-test",
                "reasonCode": "desktop-open-desktop-not-ready",
                "actionHint": "wait_for_desktop_ready"
            }),
            "desktop-open-bridge-test",
            "desktop-open-request-test",
            "open-apps",
        ),
        json!({
            "status": "rejected",
            "reasonCode": "desktop-open-desktop-not-ready",
            "actionHint": "wait_for_desktop_ready"
        }),
    );
}
